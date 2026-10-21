"""Extract the requirement list from a parsed RFP.

The document is sent in windows of whole blocks, so every row can point to a
block reference the parser produced. Rows are saved as `requirement` records
created by "ai"; the reviewer confirms them at Checkpoint A.
"""
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import psycopg
from pydantic import BaseModel

from src.llm import LLMClient, load_prompt
from src.parse.sections import Block, ParsedDocument

WINDOW_CHARS = 12_000           # about 3,000 tokens of RFP text per call
META_CHARS = 8_000              # opening text sent for buyer, title and due date
PARALLEL_CALLS = 4
EXTRACT_PROMPT = "extract_v1"
META_PROMPT = "extract_meta_v1"

RowType = Literal["Functional", "Integration", "Security", "Legal", "Commercial",
                  "Implementation", "Support", "Submission", "Response question"]


class ExtractedRow(BaseModel):
    rfp_section: str
    text: str
    type: RowType
    mandatory: Literal["yes", "no", "scored"]
    page: int


class ExtractedRows(BaseModel):
    rows: list[ExtractedRow]


class RfpMeta(BaseModel):
    buyer: str
    title: str
    due_date: str | None


@dataclass(frozen=True)
class Extraction:
    meta: RfpMeta
    rows: list[ExtractedRow]
    model: str
    prompt_version: str
    unknown_refs: int            # rows whose rfp_section is not a parser reference
    cost_usd: float


def windows(blocks: list[Block], max_chars: int = WINDOW_CHARS) -> list[list[Block]]:
    """Group consecutive blocks into windows of at most max_chars (a longer block goes alone)."""
    groups: list[list[Block]] = [[]]
    size = 0
    for block in blocks:
        if groups[-1] and size + len(block.text) > max_chars:
            groups.append([])
            size = 0
        groups[-1].append(block)
        size += len(block.text)
    return [g for g in groups if g]


def format_window(blocks: list[Block]) -> str:
    return "\n\n".join(f"[{b.ref}] (page {b.page}){' (continued)' if b.continued else ''}\n{b.text}"
                       for b in blocks)


def extract(doc: ParsedDocument, client: LLMClient, model: str) -> Extraction:
    prompt, meta_prompt = load_prompt(EXTRACT_PROMPT), load_prompt(META_PROMPT)
    groups = windows(doc.blocks)

    def run(group: list[Block]):
        return client.complete_json(purpose="extract", model=model, prompt=prompt,
                                    user=format_window(group), schema=ExtractedRows)

    opening = format_window(doc.blocks)[:META_CHARS]
    with ThreadPoolExecutor(max_workers=PARALLEL_CALLS) as pool:
        meta_future = pool.submit(client.complete_json, purpose="extract_meta", model=model,
                                  prompt=meta_prompt, user=opening, schema=RfpMeta)
        results = list(pool.map(run, groups))
        meta = meta_future.result()

    rows = dedupe([row for r in results for row in r.data.rows])
    known = doc.refs()
    return Extraction(
        meta=meta.data,
        rows=rows,
        model=results[0].model if results else model,
        prompt_version=prompt.version,
        unknown_refs=sum(row.rfp_section not in known for row in rows),
        cost_usd=sum(r.cost_usd or 0 for r in [*results, meta]),
    )


def dedupe(rows: list[ExtractedRow]) -> list[ExtractedRow]:
    seen: set[tuple[str, str]] = set()
    unique = []
    for row in rows:
        key = (row.rfp_section, re.sub(r"\W+", " ", row.text.lower()).strip())
        if key not in seen:
            seen.add(key)
            unique.append(row)
    return unique


def save(conn: psycopg.Connection, doc: ParsedDocument, result: Extraction) -> int:
    """Create the rfp record and its AI-created requirement rows. Returns the rfp id."""
    due = _parse_due(result.meta.due_date)
    with conn.transaction():
        rfp_id = conn.execute(
            "insert into rfp (buyer, title, source_file, due_date, extract_model,"
            " extract_prompt_version, extracted_at) values (%s, %s, %s, %s, %s, %s, now()) returning id",
            (result.meta.buyer, result.meta.title, doc.source_file, due, result.model,
             result.prompt_version),
        ).fetchone()[0]
        with conn.cursor() as cur:
            cur.executemany(
                "insert into requirement (rfp_id, req_ref, rfp_section, text, type, mandatory, scored,"
                " page, created_by) values (%s, %s, %s, %s, %s, %s, %s, %s, 'ai')",
                [(rfp_id, f"R-{n:03d}", row.rfp_section, row.text, row.type,
                  row.mandatory == "yes", row.mandatory == "scored", row.page)
                 for n, row in enumerate(result.rows, start=1)],
            )
    return rfp_id


def _parse_due(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None
