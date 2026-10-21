"""LLM wrapper: data-retention routing, strict JSON, retries and a log without prompt text."""
import json
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from src.llm import JSON_ATTEMPTS, LLMClient, LLMError, Prompt, strict_schema

PROMPT = Prompt(version="test_v1", text="You extract things.")
SECRET = "Buyer contact: Jane Doe, jane@example.gov"


class Item(BaseModel):
    ref: str
    mandatory: bool


class Items(BaseModel):
    items: list[Item]
    note: str | None


def reply(content: str, model: str = "anthropic/claude-test") -> SimpleNamespace:
    return SimpleNamespace(
        model=model, provider="Anthropic",
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=100, completion_tokens=20, cost=0.0004))


class FakeCreate:
    def __init__(self, *replies: str):
        self.replies, self.calls = list(replies), []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return reply(self.replies.pop(0))


GOOD = json.dumps({"items": [{"ref": "IV.A.1", "mandatory": True}], "note": None})


def client(tmp_path, *replies: str) -> tuple[LLMClient, FakeCreate]:
    fake = FakeCreate(*replies)
    return LLMClient(create=fake, log_path=tmp_path / "calls.jsonl"), fake


def call(c: LLMClient):
    return c.complete_json(purpose="test", model="anthropic/claude-test", prompt=PROMPT,
                           user=SECRET, schema=Items)


def test_every_call_requires_zero_data_retention(tmp_path) -> None:
    c, fake = client(tmp_path, GOOD)
    call(c)
    provider = fake.calls[0]["extra_body"]["provider"]
    assert provider["data_collection"] == "deny"
    assert provider["zdr"] is True
    assert provider["require_parameters"] is True


def test_strict_json_schema_is_sent(tmp_path) -> None:
    c, fake = client(tmp_path, GOOD)
    call(c)
    fmt = fake.calls[0]["response_format"]
    assert fmt["type"] == "json_schema" and fmt["json_schema"]["strict"] is True
    assert "temperature" not in fake.calls[0], "only sent when asked for"


def test_temperature_sent_when_given(tmp_path) -> None:
    c, fake = client(tmp_path, GOOD)
    c.complete_json(purpose="test", model="m", prompt=PROMPT, user="x", schema=Items, temperature=0)
    assert fake.calls[0]["temperature"] == 0


def test_strict_schema_requires_every_field() -> None:
    schema = strict_schema(Items)
    assert schema["required"] == ["items", "note"] and schema["additionalProperties"] is False
    item = schema["$defs"]["Item"]
    assert item["required"] == ["ref", "mandatory"] and item["additionalProperties"] is False


def test_fields_named_like_schema_keywords_are_kept() -> None:
    class Meta(BaseModel):
        title: str
        default: str | None

    schema = strict_schema(Meta)
    assert set(schema["properties"]) == {"title", "default"}
    assert schema["required"] == ["title", "default"]
    assert "title" not in schema["properties"]["title"], "the keyword is still stripped inside fields"


def test_result_is_typed_and_traceable(tmp_path) -> None:
    c, _ = client(tmp_path, GOOD)
    result = call(c)
    assert result.data.items[0].ref == "IV.A.1"
    assert (result.model, result.prompt_version, result.attempts) == ("anthropic/claude-test", "test_v1", 1)
    assert result.cost_usd == 0.0004


def test_invalid_json_is_retried(tmp_path) -> None:
    c, fake = client(tmp_path, "not json", '{"items": "wrong"}', GOOD)
    assert call(c).attempts == 3 and len(fake.calls) == 3


def test_gives_up_after_max_attempts(tmp_path) -> None:
    c, _ = client(tmp_path, *["not json"] * JSON_ATTEMPTS)
    with pytest.raises(LLMError, match="no valid JSON"):
        call(c)


def test_log_records_each_attempt_without_prompt_text(tmp_path) -> None:
    c, _ = client(tmp_path, "not json", GOOD)
    call(c)
    log = (tmp_path / "calls.jsonl").read_text(encoding="utf-8")
    entries = [json.loads(line) for line in log.splitlines()]
    assert [e["ok"] for e in entries] == [False, True]
    assert entries[1]["prompt_version"] == "test_v1" and entries[1]["provider"] == "Anthropic"
    assert "jane@example.gov" not in log and PROMPT.text not in log


def test_max_tokens_is_always_sent(tmp_path) -> None:
    c, fake = client(tmp_path, GOOD)
    call(c)
    assert fake.calls[0]["max_tokens"] > 0


def test_cut_off_reply_is_an_error_not_a_retry(tmp_path) -> None:
    def create(**kwargs):
        r = reply('{"items": [')
        r.choices[0].finish_reason = "length"
        return r
    c = LLMClient(create=create, log_path=tmp_path / "calls.jsonl")
    with pytest.raises(LLMError, match="cut off at max_tokens"):
        call(c)


def test_cache_reuses_a_paid_reply_and_misses_on_any_change(tmp_path) -> None:
    fake = FakeCreate(GOOD, GOOD)
    c = LLMClient(create=fake, log_path=tmp_path / "calls.jsonl", cache_dir=tmp_path / "cache")
    first, second = call(c), call(c)
    assert len(fake.calls) == 1 and second.data == first.data and second.cost_usd == 0.0
    c.complete_json(purpose="test", model="anthropic/claude-test", prompt=PROMPT, user=SECRET + " v2",
                    schema=Items)
    assert len(fake.calls) == 2, "different input must call the model again"


def test_missing_api_key_is_a_clear_error(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setattr("src.llm.load_dotenv", lambda *a, **k: None)
    with pytest.raises(LLMError, match="OPENROUTER_API_KEY is not set"):
        LLMClient()
