"""Library load: 97 rows, correct stale and unprofiled flags, CSV never written (rule 7)."""
import hashlib
from dataclasses import replace
from datetime import date, timedelta

import psycopg
import pytest

from src.library.load import LIBRARY_CSV, read_library, status, sync_library

TODAY = date(2026, 10, 17)
EXPECTED_STALE = {"SEC-015", "HOST-007", "PRC-006", "SUP-004"}
EXPECTED_UNPROFILED = {"LEG-005", "LEG-006", "ACC-002", "ACC-003"}


@pytest.fixture(scope="module")
def answers():
    return read_library()


def test_97_rows_with_unique_ids(answers) -> None:
    assert len(answers) == 97
    assert len({a.id for a in answers}) == 97


def test_exactly_four_stale_on_reference_date(answers) -> None:
    assert {a.id for a in answers if status(a, TODAY) == "Stale"} == EXPECTED_STALE


def test_unprofiled_sources(answers) -> None:
    assert {a.id for a in answers if a.unprofiled} == EXPECTED_UNPROFILED


def test_stale_boundary_is_strictly_greater_than_cycle(answers) -> None:
    a = answers[0]
    assert status(replace(a, last_reviewed=TODAY - timedelta(days=365)), TODAY) == "Current"
    assert status(replace(a, last_reviewed=TODAY - timedelta(days=366)), TODAY) == "Stale"


def test_tags_are_split(answers) -> None:
    com001 = next(a for a in answers if a.id == "COM-001")
    assert com001.tags == ("overview", "history", "headquarters")


def test_bad_answer_type_is_rejected(tmp_path) -> None:
    text = LIBRARY_CSV.read_text(encoding="utf-8").replace(",Narrative,", ",Maybe,", 1)
    bad = tmp_path / "library.csv"
    bad.write_text(text, encoding="utf-8")
    with pytest.raises(ValueError, match="answer_type 'Maybe'"):
        read_library(bad)


def _csv_hash() -> str:
    return hashlib.sha256(LIBRARY_CSV.read_bytes()).hexdigest()


def test_sync_loads_all_rows_with_stale_status(db: psycopg.Connection, answers) -> None:
    before = _csv_hash()
    result = sync_library(db, answers, TODAY)

    assert result.loaded == 97
    assert set(result.stale) == EXPECTED_STALE
    assert db.execute("select count(*) from library_answer").fetchone()[0] == 97
    stale = {r[0] for r in db.execute("select id from library_answer where status = 'Stale'")}
    assert stale == EXPECTED_STALE
    assert _csv_hash() == before, "loading must never write data/library.csv"


def test_sync_is_idempotent_and_removes_dropped_rows(db: psycopg.Connection, answers) -> None:
    sync_library(db, answers, TODAY)
    result = sync_library(db, [a for a in answers if a.id != "REF-005"], TODAY)
    assert result.removed == ["REF-005"]
    assert db.execute("select count(*) from library_answer").fetchone()[0] == 96


def test_embedding_cleared_only_when_text_changes(db: psycopg.Connection, answers) -> None:
    sync_library(db, answers, TODAY)
    db.execute("update library_answer set embedding = '[1,2,3]', embedding_model = 'test'")

    sync_library(db, answers, TODAY)
    assert db.execute("select count(*) from library_answer where embedding is null").fetchone()[0] == 0

    edited = [replace(a, answer=a.answer + " Updated.") if a.id == "SEC-005" else a for a in answers]
    sync_library(db, edited, TODAY)
    nulls = {r[0] for r in db.execute("select id from library_answer where embedding is null")}
    assert nulls == {"SEC-005"}
