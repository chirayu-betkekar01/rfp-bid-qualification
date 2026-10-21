"""PDF parsing: every block gets a section reference and page number."""
import csv
from pathlib import Path

import pytest

from src.parse.pdf import parse_pdf
from src.parse.sections import split_sections

ROOT = Path(__file__).resolve().parent.parent
TULSA_PDF = ROOT / "data" / "test_rfps" / "tulsa_rfp_26-901.pdf"
HEADER = "RFP 99-001 | Test RFP | Issue Date: Jan. 1, 2026"


def _refs(pages: list[list[str]]) -> list[str]:
    return [b.ref for b in split_sections(pages, "test.pdf").blocks]


# Synthetic documents: rules that don't need the real PDF ---------------------

def test_roman_heading_vs_letter_item() -> None:
    pages = [["I. OVERVIEW:", "Intro."],
             ["II. QUESTIONS", *(f"{chr(65 + i)}. Question {i}?" for i in range(22)),
              "V. How long have you been in business?"]]
    refs = _refs(pages)
    assert "II.V" in refs and "V" not in refs


def test_fresh_list_at_same_depth_and_nesting() -> None:
    pages = [["IV. SCOPE OF WORK:", "A. First duty", "B. Second duty",
              "Additional details:", "A. System Features", "1. Feature one", "2. Feature two",
              "B. Integration", "1. Integration one"]]
    assert _refs(pages) == ["IV", "IV.A", "IV.B", "IV.A", "IV.A.1", "IV.A.2", "IV.B", "IV.B.1"]


def test_missing_period_only_accepted_for_next_letter() -> None:
    pages = [["EXHIBIT B", "1. Breaches", "A. Reporting.", "B. Coordination.", "C Costs arising.",
              "I hereby acknowledge this is text."]]
    assert _refs(pages) == ["Exhibit B", "Exhibit B.1", "Exhibit B.1.A", "Exhibit B.1.B",
                            "Exhibit B.1.C"]


def test_running_header_and_page_numbers_removed() -> None:
    pages = [[HEADER, f"{r}. SECTION {r}:", "Body text.", str(n)]
             for n, r in enumerate(["I", "II", "III", "IV"], start=1)]
    doc = split_sections(pages, "test.pdf")
    assert [b.ref for b in doc.blocks] == ["I", "II", "III", "IV"]
    assert all(HEADER not in b.text and not b.text.endswith(("1", "2", "3", "4")) for b in doc.blocks)


def test_named_parts_and_form_aliases() -> None:
    pages = [["Cover text", "RFP Schedule", "Due 09/17/2025"],
             ["AFFIDAVIT", "1. I am the agent."],
             ["ACKNOWLEDGMENT OF RECEIPT OF ADDENDA/AMENDMENTS", "Sign here"],
             ["APPENDIX A – General Contract Terms", "1. Renewals."]]
    assert _refs(pages) == ["Cover", "Schedule", "Affidavit", "Affidavit.1", "Addenda",
                            "Appendix A", "Appendix A.1"]


# The real Tulsa RFP ------------------------------------------------------------

@pytest.fixture(scope="module")
def tulsa():
    if not TULSA_PDF.exists():
        pytest.skip("Tulsa PDF not downloaded (python -m eval.fetch_test_rfps)")
    return parse_pdf(TULSA_PDF)


def test_tulsa_has_23_pages(tulsa) -> None:
    assert tulsa.page_count == 23


def test_every_answer_key_section_is_found(tulsa) -> None:
    with (ROOT / "data" / "tulsa_matrix.csv").open(encoding="utf-8", newline="") as f:
        key_refs = {row["rfp_section"] for row in csv.DictReader(f)}
    assert key_refs - tulsa.refs() == set()


def test_known_sections(tulsa) -> None:
    (project_team, system_features) = tulsa.find("IV.A")
    assert "project team" in project_team.text and project_team.page == 4
    assert system_features.text.startswith("A. System Features")

    (references,) = tulsa.find("VIII.X")
    assert "three (3) client references" in references.text and references.page == 9

    (rider,) = tulsa.find("Exhibit B")
    assert "DATA RIDER" in rider.text and rider.page == 15

    (breach,) = tulsa.find("Exhibit B.6.A")
    assert "24 hours" in breach.text and breach.heading == "EXHIBIT B"


def test_letter_v_under_viii_is_not_section_v(tulsa) -> None:
    (section_v,) = tulsa.find("V")
    assert "DELIVERABLES" in section_v.text and section_v.page == 6
    (question_v,) = tulsa.find("VIII.V")
    assert "How long have you been in business" in question_v.text


def test_block_that_crosses_a_page(tulsa) -> None:
    (costs,) = tulsa.find("Exhibit B.6.C")
    assert (costs.page, costs.page_end) == (16, 17)
    assert "Issue Date" not in costs.text, "running header must be stripped"
