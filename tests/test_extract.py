"""Extraction: windows of whole blocks, dedupe, and saving rows created by AI with a trace."""
import json
from types import SimpleNamespace

import psycopg
import pytest

from src.extract.extract import (EXTRACT_PROMPT, Extraction, ExtractedRow, RfpMeta, dedupe, extract,
                                 format_window, save, windows)
from src.llm import LLMClient
from src.parse.sections import Block, ParsedDocument


def block(ref: str, chars: int = 100, page: int = 1) -> Block:
    return Block(ref=ref, heading="SCOPE", text="x" * chars, page=page, page_end=page)


def row(ref: str = "IV.A.1", text: str = "Centralize all interactions.", mandatory: str = "yes") -> ExtractedRow:
    return ExtractedRow(rfp_section=ref, text=text, type="Functional", mandatory=mandatory, page=4)


def test_windows_keep_blocks_whole_and_in_order() -> None:
    blocks = [block("A", 5000), block("B", 5000), block("C", 5000), block("D", 20000), block("E", 10)]
    groups = windows(blocks, max_chars=12000)
    assert [[b.ref for b in g] for g in groups] == [["A", "B"], ["C"], ["D"], ["E"]]


def test_window_text_shows_reference_and_page() -> None:
    text = format_window([Block("IV.A.1", "SCOPE", "1. The CRM must...", 4, 4)])
    assert text.startswith("[IV.A.1] (page 4)\n1. The CRM must")


def test_dedupe_ignores_case_and_punctuation() -> None:
    rows = [row(text="Encrypt data at rest."), row(text="encrypt data at rest"), row(ref="IV.A.2")]
    assert len(dedupe(rows)) == 2


class FakeCreate:
    """Answers extraction calls with one row per bracketed block, and meta calls with fixed metadata."""
    def __call__(self, **kwargs):
        user, schema = kwargs["messages"][1]["content"], kwargs["response_format"]["json_schema"]["name"]
        if schema == "RfpMeta":
            body = {"buyer": "City of Testville", "title": "RFP 1 Test", "due_date": "2026-09-17T17:00"}
        else:
            refs = [line[1:line.index("]")] for line in user.splitlines() if line.startswith("[")]
            body = {"rows": [{"rfp_section": r, "text": f"Requirement {r}", "type": "Functional",
                              "mandatory": "yes", "page": 1} for r in refs]}
        return SimpleNamespace(model="fake/model", provider="Fake",
                               choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(body)))],
                               usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, cost=0.01))


def test_extract_covers_every_window(tmp_path) -> None:
    doc = ParsedDocument("test.pdf", 3, [block(f"S.{n}", 5000) for n in range(1, 8)])
    result = extract(doc, LLMClient(create=FakeCreate(), log_path=tmp_path / "log.jsonl"), "fake/model")
    assert [r.rfp_section for r in result.rows] == [f"S.{n}" for n in range(1, 8)]
    assert result.meta.buyer == "City of Testville" and result.prompt_version == EXTRACT_PROMPT
    assert result.unknown_refs == 0 and result.cost_usd == pytest.approx(0.01 * 5)


def test_save_creates_rfp_and_ai_rows_with_trace(db: psycopg.Connection) -> None:
    doc = ParsedDocument("test.pdf", 1, [])
    result = Extraction(meta=RfpMeta(buyer="City of Testville", title="RFP 1", due_date="2026-09-17T17:00"),
                        rows=[row(), row(ref="IX", text="Stay within budget.", mandatory="scored")],
                        model="fake/model", prompt_version="extract_v1", unknown_refs=0, cost_usd=0)
    rfp_id = save(db, doc, result)

    trace = db.execute("select extract_model, extract_prompt_version, extracted_at is not null from rfp"
                       " where id = %s", (rfp_id,)).fetchone()
    assert trace == ("fake/model", "extract_v1", True)
    rows = db.execute("select req_ref, mandatory, scored, created_by from requirement where rfp_id = %s"
                      " order by req_ref", (rfp_id,)).fetchall()
    assert rows == [("R-001", True, False, "ai"), ("R-002", False, True, "ai")]


def test_extraction_trace_must_be_complete(db: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation, match="extraction_is_traceable"):
        db.execute("insert into rfp (buyer, title, source_file, extract_model) values ('b', 't', 'f', 'm')")
