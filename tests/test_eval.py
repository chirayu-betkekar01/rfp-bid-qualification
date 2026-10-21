"""Eval harness: answer key checks, empty run, oracle run, matching and trap flags."""
import csv
from collections import Counter
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest

from eval.answer_key import load_answer_key
from eval.match import match_rows, ref_score, text_score
from eval.predictions import PredictedRow
from eval.run import RUN_COLUMNS, append_run
from eval.scorecard import score_run
from src.library.load import is_stale, read_library

ROOT = Path(__file__).resolve().parent.parent
TODAY = date(2026, 10, 17)


@pytest.fixture(scope="module")
def key():
    return load_answer_key(ROOT / "data" / "tulsa_matrix.csv")


@pytest.fixture(scope="module")
def library():
    return read_library()


def oracle(key, library) -> list[PredictedRow]:
    """The answer key restated as system output, with the flags the rules require."""
    by_id = {a.id: a for a in library}
    rows = []
    for k in key:
        flags = set()
        for cid in k.library_sources:
            if is_stale(by_id[cid], TODAY):
                flags.add("stale_source")
            if by_id[cid].unprofiled:
                flags.add("unprofiled_source")
        rows.append(PredictedRow(
            ref=k.rfp_section, text=k.requirement, mandatory=k.mandatory == "Yes",
            status=k.expected_status, cited_ids=k.library_sources, flags=tuple(sorted(flags)),
            risk_tier=k.risk,
            answer_text="" if k.expected_status == "Needs decision" else "Drafted answer.",
            model="oracle", prompt_version="oracle"))
    return rows


# The answer key itself ---------------------------------------------------------

def test_key_has_94_rows_and_22_high_risk(key) -> None:
    assert len(key) == 94
    assert sum(k.risk == "High" for k in key) == 22


def test_key_status_counts(key) -> None:
    assert Counter(k.expected_status for k in key) == {
        "Fully compliant": 52, "Partially compliant": 15, "Via integration": 2,
        "Not compliant": 2, "Needs decision": 12, "Admin": 11,
    }


def test_every_key_source_exists_in_library(key, library) -> None:
    ids = {a.id for a in library}
    cited = {cid for k in key for cid in k.library_sources}
    assert cited and cited - ids == set()


# Whole runs ---------------------------------------------------------------------

def test_empty_run_scores_zero(key, library) -> None:
    card = score_run(key, [], library, TODAY, go_no_go=(None, "no_bid"))
    assert card.recall == 0 and card.precision is None and card.status_match is None
    assert card.needs_decision_ok == (0, 12) and card.high_risk_ok == (0, 22)
    results = {m.name: m.result for m in card.measures()}
    assert results["Recall"] == "FAIL" and results["Go/no-go"] == "NOT RUN"
    assert not card.passed


def test_oracle_run_scores_perfectly(key, library) -> None:
    card = score_run(key, oracle(key, library), library, TODAY, go_no_go=("no_bid", "no_bid"))
    assert card.recall == card.precision == card.status_match == card.citation_overlap == 1.0
    assert card.needs_decision_ok == (12, 12) and card.high_risk_ok == (22, 22)
    assert card.unflagged_traps == 0 and card.unknown_citations == 0
    assert card.passed


def test_wrong_status_and_missing_flag_are_caught(key, library) -> None:
    rows = oracle(key, library)
    # T-057 cites SUP-004 (stale): drop its flag. Flip the first Fully compliant row.
    t057 = next(i for i, k in enumerate(key) if k.req_id == "T-057")
    rows[t057] = replace(rows[t057], flags=())
    first_full = next(i for i, k in enumerate(key) if k.expected_status == "Fully compliant")
    rows[first_full] = replace(rows[first_full], status="Not compliant")

    card = score_run(key, rows, library, TODAY)
    assert card.unflagged_traps == 1
    assert card.status_match == pytest.approx(93 / 94)


def test_needs_decision_row_with_an_answer_fails(key, library) -> None:
    rows = oracle(key, library)
    i = next(i for i, k in enumerate(key) if k.expected_status == "Needs decision")
    rows[i] = replace(rows[i], answer_text="Invented answer.")
    assert score_run(key, rows, library, TODAY).needs_decision_ok == (11, 12)


def test_no_key_still_checks_trap_flags(library) -> None:
    rows = [PredictedRow(ref="1.1", text="Pricing", cited_ids=("PRC-006",))]
    card = score_run(None, rows, library, TODAY, go_no_go=("bid", "bid"))
    assert card.unflagged_traps == 1 and card.recall is None


# Matching -----------------------------------------------------------------------

def test_ref_and_text_scores() -> None:
    assert ref_score("IV.A.1", "iv.a.1") == 1.0
    assert ref_score("IV.A", "IV.A.1") == 0.5
    assert ref_score("IV.A", "IV.AB") == 0.0
    assert text_score("Provide secure user authentication", "Provide secure user authentication") == 1.0
    assert text_score("Uptime must be 99.9%", "Insurance limits") == 0.0


def test_verbatim_extraction_matches_paraphrased_key(key) -> None:
    t002 = next(k for k in key if k.req_id == "T-002")
    extracted = PredictedRow(
        ref="IV.B", text="B. Implement a cloud-based CRM system that enables centralized tracking, "
                         "monitoring, and reporting of constituent inquiries and requests for 1-25 users")
    result = match_rows([t002], [extracted])
    assert len(result.matched) == 1


def test_matching_is_one_to_one(key) -> None:
    t002 = next(k for k in key if k.req_id == "T-002")
    copy = PredictedRow(ref=t002.rfp_section, text=t002.requirement)
    result = match_rows([t002], [copy, copy])
    assert len(result.matched) == 1


def test_unrelated_row_does_not_match(key) -> None:
    t002 = next(k for k in key if k.req_id == "T-002")
    other = PredictedRow(ref="X.K", text="Provide proof of general liability insurance coverage")
    assert match_rows([t002], [other]).matched == []


# Run log ------------------------------------------------------------------------

def test_append_run_writes_header_once(tmp_path, key, library) -> None:
    path = tmp_path / "runs.csv"
    card = score_run(key, [], library, TODAY)
    append_run(path, "tulsa", card, [], "empty run")
    append_run(path, "tulsa", card, [], "empty run")
    with path.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 2 and list(rows[0]) == RUN_COLUMNS
    assert rows[0]["recall"] == "0.0000" and rows[0]["passed"] == "False"
