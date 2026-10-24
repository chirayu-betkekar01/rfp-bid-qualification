"""Sections: every line item lands in one top-level part, in document order."""
import psycopg

from src.extract.extract import Extraction, ExtractedRow, RfpMeta, save
from src.extract.sections import plan_sections, top_part
from src.parse.sections import Block, ParsedDocument


def block(ref: str, heading: str) -> Block:
    return Block(ref=ref, heading=heading, text="x", page=1, page_end=1)


DOC = ParsedDocument("test.pdf", 3, [
    block("Cover", ""), block("p.2", ""),
    block("IV", "SCOPE OF WORK"), block("IV.A.1", "SCOPE OF WORK"),
    block("Section 2.1", "SECTION 2 - NOTICE TO PROPOSER"),
    block("Exhibit B", "EXHIBIT B"), block("Exhibit B.6.A.1", "EXHIBIT B"),
    block("X", "GENERAL TERMS"),
])


def test_top_part() -> None:
    assert top_part("IV.A.1") == "IV"
    assert top_part("Exhibit B.6.A.1") == "Exhibit B"
    assert top_part("Section 2.1") == "Section 2"
    assert top_part("Appendix One.2.1.13") == "Appendix One"
    assert top_part("Respondent Information Sheet") == "Respondent Information Sheet"
    assert top_part("p.3") == top_part("Cover") == top_part(None) == "Cover"


def test_sections_follow_the_document_and_only_include_used_parts() -> None:
    plans = plan_sections(DOC, ["Exhibit B.6.A.1", "IV.A.1", "Section 2.1", "IV.B"])
    assert [(p.ref, p.title, p.position) for p in plans] == [
        ("IV", "SCOPE OF WORK", 1), ("Section 2", "SECTION 2 - NOTICE TO PROPOSER", 2), ("Exhibit B", "EXHIBIT B", 3),
    ]


def test_parts_the_parser_never_saw_get_their_own_section_last() -> None:
    plans = plan_sections(DOC, ["X.K", "Respondent Information Sheet", "p.2"])
    assert [(p.ref, p.title) for p in plans] == [
        ("Cover", "Cover and front matter"), ("X", "GENERAL TERMS"),
        ("Respondent Information Sheet", "Respondent Information Sheet"),
    ]


def test_save_puts_every_row_in_a_section(db: psycopg.Connection) -> None:
    rows = [ExtractedRow(rfp_section=ref, text=f"Row {ref}", type="Legal", mandatory="yes", page=1)
            for ref in ["IV.A.1", "Exhibit B.6.A.1", "Exhibit B.2", "Checklist"]]
    result = Extraction(meta=RfpMeta(buyer="b", title="t", due_date=None), rows=rows,
                        model="fake/model", prompt_version="extract_v4", unknown_refs=1, cost_usd=0)
    rfp_id = save(db, DOC, result)
    found = db.execute(
        "select q.rfp_section, s.ref, s.position from requirement q join rfp_section s on s.id = q.section_id"
        " where q.rfp_id = %s order by q.id", (rfp_id,)).fetchall()
    assert found == [("IV.A.1", "IV", 1), ("Exhibit B.6.A.1", "Exhibit B", 2), ("Exhibit B.2", "Exhibit B", 2),
                     ("Checklist", "Checklist", 3)]
