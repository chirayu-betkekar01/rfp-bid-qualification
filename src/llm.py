"""The one wrapper every LLM call goes through.

Handles OpenRouter auth, data-retention routing, structured JSON output,
validation with retries, and a call log. Callers pass a pydantic model for the
response shape and a versioned prompt from prompts/; the result records the
model and prompt version so drafts stay traceable (rule 6).

Prompt text never goes in the log, only sizes and IDs: prompts can contain
buyer documents.
"""
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Generic, TypeVar

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, ValidationError

from src.config import ROOT

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
PROMPTS_DIR = ROOT / "prompts"
CALL_LOG = ROOT / "logs" / "llm_calls.jsonl"

# Never route to providers that keep or train on prompts; fail rather than fall back to one.
PROVIDER_ROUTING = {"data_collection": "deny", "zdr": True, "require_parameters": True}
JSON_ATTEMPTS = 3          # re-ask when the reply is not valid JSON for the schema
DEFAULT_MAX_TOKENS = 8_000 # caps the reply; OpenRouter reserves credit for the maximum up front
HTTP_RETRIES = 3           # handled by the client for timeouts, 429 and 5xx

T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    pass


@dataclass(frozen=True)
class Prompt:
    version: str           # file stem, e.g. "extract_v1"
    text: str


@dataclass(frozen=True)
class LLMResult(Generic[T]):
    data: T
    model: str             # the model that actually answered
    prompt_version: str
    attempts: int
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None


def load_prompt(version: str) -> Prompt:
    path = PROMPTS_DIR / f"{version}.md"
    if not path.exists():
        raise LLMError(f"prompt {version!r} not found in {PROMPTS_DIR.relative_to(ROOT)}/")
    return Prompt(version=version, text=path.read_text(encoding="utf-8"))


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON schema for strict structured output: every field required, no extra fields."""
    def tighten(node: Any) -> Any:
        if isinstance(node, dict):
            # Drop the "title"/"default" keywords, but never a field that happens to be named "title".
            node = {k: ({name: tighten(field) for name, field in v.items()} if k in ("properties", "$defs")
                        else tighten(v))
                    for k, v in node.items() if k not in ("title", "default")}
            if node.get("type") == "object" and "properties" in node:
                node["required"] = list(node["properties"])
                node["additionalProperties"] = False
            return node
        if isinstance(node, list):
            return [tighten(v) for v in node]
        return node
    return tighten(model.model_json_schema())


class LLMClient:
    def __init__(self, create: Callable[..., Any] | None = None, log_path: Path = CALL_LOG):
        """`create` defaults to OpenRouter chat completions; tests pass a fake."""
        if create is None:
            load_dotenv(ROOT / ".env")
            key = os.environ.get("OPENROUTER_API_KEY")
            if not key:
                raise LLMError("OPENROUTER_API_KEY is not set. Add it to .env.")
            client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=key, max_retries=HTTP_RETRIES,
                            timeout=180)
            create = client.chat.completions.create
        self._create = create
        self._log_path = log_path

    def complete_json(self, *, purpose: str, model: str, prompt: Prompt, user: str,
                      schema: type[T], temperature: float | None = None,
                      max_tokens: int = DEFAULT_MAX_TOKENS) -> LLMResult[T]:
        """Ask `model` for JSON matching `schema`, with `prompt` as the system message.

        `temperature` is only sent when given: some models (e.g. Claude Sonnet 5.5) reject it,
        and with require_parameters an unsupported parameter rules out every provider.
        """
        messages = [{"role": "system", "content": prompt.text}, {"role": "user", "content": user}]
        response_format = {"type": "json_schema", "json_schema": {
            "name": schema.__name__, "strict": True, "schema": strict_schema(schema)}}

        options = {} if temperature is None else {"temperature": temperature}
        started = time.monotonic()
        last_error = ""
        for attempt in range(1, JSON_ATTEMPTS + 1):
            try:
                response = self._create(
                    model=model, messages=messages, response_format=response_format,
                    max_tokens=max_tokens, extra_body={"provider": PROVIDER_ROUTING, "usage": {"include": True}}, **options,
                )
            except Exception as exc:
                self._log(purpose, model, prompt, user, attempt, started, error=f"{type(exc).__name__}: {exc}")
                raise LLMError(f"{purpose}: request to {model} failed: {exc}") from exc

            choice = response.choices[0]
            if getattr(choice, "finish_reason", None) == "length":
                self._log(purpose, model, prompt, user, attempt, started, response, error="hit max_tokens")
                raise LLMError(f"{purpose}: reply from {model} was cut off at max_tokens={max_tokens}; "
                               "send less text per call or raise max_tokens")
            content = choice.message.content or ""
            try:
                data = schema.model_validate_json(content)
            except ValidationError as exc:
                last_error = str(exc).splitlines()[0]
                self._log(purpose, model, prompt, user, attempt, started, response, error=last_error)
                continue

            result = LLMResult(data=data, model=getattr(response, "model", None) or model,
                               prompt_version=prompt.version, attempts=attempt,
                               **_usage(response))
            self._log(purpose, model, prompt, user, attempt, started, response)
            return result

        raise LLMError(f"{purpose}: no valid JSON from {model} after {JSON_ATTEMPTS} attempts ({last_error})")

    def _log(self, purpose: str, model: str, prompt: Prompt, user: str, attempt: int,
             started: float, response: Any = None, error: str = "") -> None:
        entry = {
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "purpose": purpose,
            "model_requested": model,
            "model_used": getattr(response, "model", None),
            "provider": getattr(response, "provider", None),
            "prompt_version": prompt.version,
            "input_chars": len(prompt.text) + len(user),
            "attempt": attempt,
            "seconds": round(time.monotonic() - started, 2),
            **(_usage(response) if response is not None else {}),
            "ok": not error,
            "error": error,
        }
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        with self._log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")


def _usage(response: Any) -> dict[str, Any]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return {"input_tokens": None, "output_tokens": None, "cost_usd": None}
    return {"input_tokens": getattr(usage, "prompt_tokens", None),
            "output_tokens": getattr(usage, "completion_tokens", None),
            "cost_usd": getattr(usage, "cost", None)}
