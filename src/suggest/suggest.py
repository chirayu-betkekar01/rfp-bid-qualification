"""Suggest a Yes / No / Maybe for every line item, from the content library only.

Suggestions are shown beside each item and never selected for the expert. The
model only reads; code checks everything it returns:

- cited IDs must exist in the library; a suggestion left without a source has no
  answer ("No library source means no suggestion")
- citing a stale or unprofiled entry adds a visible flag
- gap flags (hard_fail_gap:<name>, soft_gap:<name>) come from keyword matches in the
  item text against config/vendor.yaml, not from the model

The whole library (97 rows, ~7.5k tokens) goes into every call, so there is no
retrieval step to get wrong.
"""
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from typing import Literal

import psycopg
from pydantic import BaseModel

from src.config import vendor_config
from src.library.load import LibraryAnswer, is_stale
from src.llm import LLMClient, load_prompt

SUGGEST_PROMPT = "suggest_v1"
BATCH_ITEMS = 25               # line items per call
MAX_TOKENS = 6_000             # ~100 tokens per suggestion, with room to spare
PARALLEL_CALLS = 2
REASON_CHARS = 240
NO_SOURCE = "Nothing in the library covers this."


class RawSuggestion(BaseModel):
    item: str
    answer: Literal["Yes", "No", "Maybe", "None"]
    cited_ids: list[str]
    reason: str


class RawSuggestions(BaseModel):
    suggestions: list[RawSuggestion]


@dataclass(frozen=True)
class LineItem:
    id: int
    ref: str                  # "R-012"
    rfp_section: str | None
    type: str
    priority: str             # mandatory | scored | optional
    text: str


@dataclass(frozen=True)
class Suggestion:
    requirement_id: int
    answer: str | None        # None: no library source
    reason: str
    cited_ids: tuple[str, ...]
    flags: tuple[str, ...]


@dataclass(frozen=True)
class SuggestResult:
    suggestions: list[Suggestion]
    model: str
    prompt_version: str
    missing: list[str]         # items the model skipped; they get no suggestion
    unknown_ids: int           # cited IDs that are not in the library, dropped
    cost_usd: float


def format_library(library: list[LibraryAnswer], today: date) -> str:
    lines = []
    for a in library:
        status = "STALE" if is_stale(a, today) else "Current"
        lines.append(f"[{a.id}] {a.category} · {a.answer_type} · {status} · source: {a.source_section}\n"
                     f"Q: {a.question}\nA: {a.answer}")
    return "\n\n".join(lines)


def format_items(items: list[LineItem]) -> str:
    return "\n".join(f'<item key="{i.ref}" section="{i.rfp_section or ""}" type="{i.type}" '
                     f'priority="{i.priority}">{i.text}</item>' for i in items)


def gap_flags(text: str) -> list[str]:
    """Hard-fail and soft gaps from config/vendor.yaml whose keywords appear in the text."""
    config = vendor_config()
    flags = []
    for kind, gaps in (("hard_fail_gap", config["hard_fail_gaps"]), ("soft_gap", config["soft_gaps"])):
        for name, keywords in gaps.items():
            if any(re.search(rf"(?<!\w){re.escape(k)}(?!\w)", text, re.IGNORECASE) for k in keywords):
                flags.append(f"{kind}:{name}")
    return flags


def check(raw: RawSuggestion, item: LineItem, library: dict[str, LibraryAnswer], today: date) -> tuple[Suggestion, int]:
    """Apply the rules to one model suggestion. Returns it and how many cited IDs were not in the library."""
    cited = tuple(dict.fromkeys(i.strip().upper() for i in raw.cited_ids if i.strip()))
    known = tuple(i for i in cited if i in library)
    unknown = len(cited) - len(known)
    if raw.answer == "None" or not known:
        answer, known = None, ()
        # A Yes/No/Maybe whose sources don't exist keeps no trace of them.
        reason = (_short(raw.reason) or NO_SOURCE) if raw.answer == "None" else NO_SOURCE
    else:
        answer, reason = raw.answer, _short(raw.reason) or NO_SOURCE

    flags = []
    if any(is_stale(library[i], today) for i in known):
        flags.append("stale_source")
    if any(library[i].unprofiled for i in known):
        flags.append("unprofiled_source")
    flags.extend(gap_flags(item.text))
    return Suggestion(item.id, answer, reason, known, tuple(flags)), unknown


def batches(items: list[LineItem], size: int = BATCH_ITEMS) -> list[list[LineItem]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def suggest(items: list[LineItem], library: list[LibraryAnswer], client: LLMClient, model: str, today: date,
            parallel: int = PARALLEL_CALLS) -> SuggestResult:
    prompt = load_prompt(SUGGEST_PROMPT)
    by_id = {a.id: a for a in library}
    library_text = format_library(library, today)

    def run(batch: list[LineItem]):
        user = f"## Library\n\n{library_text}\n\n## Line items\n\n{format_items(batch)}"
        return batch, client.complete_json(purpose="suggest", model=model, prompt=prompt, user=user,
                                           schema=RawSuggestions, max_tokens=MAX_TOKENS)

    with ThreadPoolExecutor(max_workers=parallel) as pool:
        results = list(pool.map(run, batches(items)))

    suggestions, missing, unknown = [], [], 0
    for batch, result in results:
        raw_by_key = {}
        for raw in result.data.suggestions:
            raw_by_key.setdefault(raw.item.strip(), raw)
        for item in batch:
            raw = raw_by_key.get(item.ref)
            if raw is None:
                missing.append(item.ref)
                continue
            suggestion, dropped = check(raw, item, by_id, today)
            suggestions.append(suggestion)
            unknown += dropped
    return SuggestResult(
        suggestions=suggestions,
        model=results[0][1].model if results else model,
        prompt_version=prompt.version,
        missing=missing,
        unknown_ids=unknown,
        cost_usd=sum(r.cost_usd or 0 for _, r in results),
    )


def load_items(conn: psycopg.Connection, rfp_id: int, skip_prompt: str | None = None) -> list[LineItem]:
    """The RFP's line items in document order; with skip_prompt, only those not yet suggested by it."""
    rows = conn.execute(
        """select q.id, q.req_ref, q.rfp_section, q.type,
                  case when q.mandatory then 'mandatory' when q.scored then 'scored' else 'optional' end, q.text
           from requirement q left join rfp_section s on s.id = q.section_id
           where q.rfp_id = %s
             and (%s::text is null or not exists (select 1 from ai_suggestion g
                                                 where g.requirement_id = q.id and g.prompt_version = %s))
           order by s.position nulls last, q.page nulls last, q.id""",
        (rfp_id, skip_prompt, skip_prompt),
    ).fetchall()
    return [LineItem(*row) for row in rows]


def save(conn: psycopg.Connection, result: SuggestResult) -> int:
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(
            "insert into ai_suggestion (requirement_id, answer, reason, cited_ids, flags, model, prompt_version)"
            " values (%s, %s, %s, %s, %s, %s, %s)",
            [(s.requirement_id, s.answer, s.reason, list(s.cited_ids), list(s.flags), result.model,
              result.prompt_version) for s in result.suggestions],
        )
    return len(result.suggestions)


def _short(text: str) -> str:
    text = " ".join(text.split())
    if len(text) <= REASON_CHARS:
        return text
    cut = text[:REASON_CHARS]
    end = cut.rfind(". ")
    return cut[:end + 1] if end > 80 else cut.rstrip() + "…"
