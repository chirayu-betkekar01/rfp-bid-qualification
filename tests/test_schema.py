"""The database enforces the rules it can check on its own."""
import psycopg
import pytest

TABLES = {"library_answer", "rfp", "requirement", "draft", "review_decision", "library_proposal",
          "requirement_change"}


def _rfp(db: psycopg.Connection) -> int:
    return db.execute(
        "insert into rfp (buyer, title, source_file) values ('Test buyer', 'Test RFP', 'x.pdf') returning id"
    ).fetchone()[0]


def _requirement(db: psycopg.Connection) -> int:
    return db.execute(
        "insert into requirement (rfp_id, req_ref, text, type, created_by) "
        "values (%s, 'T-001', 'Provide a CRM', 'Functional', 'ai') returning id",
        (_rfp(db),),
    ).fetchone()[0]


def _draft(db: psycopg.Connection, **overrides: object) -> None:
    row = {
        "answer_text": "Yes, Tallyhouse is a cloud CRM.",
        "retrieved_ids": ["PRD-001", "HOST-001"],
        "cited_ids": ["PRD-001"],
        "suggested_status": "Fully compliant",
        "confidence": "high",
        "risk_tier": "Low",
        "model": "test-model",
        "prompt_version": "draft_v1",
    } | overrides
    db.execute(
        "insert into draft (requirement_id, answer_text, retrieved_ids, cited_ids, suggested_status,"
        " confidence, risk_tier, model, prompt_version) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (_requirement(db), *row.values()),
    )


def test_all_tables_exist_with_rls(db: psycopg.Connection) -> None:
    rows = db.execute(
        "select relname, relrowsecurity from pg_class "
        "where relnamespace = 'public'::regnamespace and relkind = 'r'"
    ).fetchall()
    found = dict(rows)
    assert TABLES <= set(found)
    assert all(found[t] for t in TABLES), "row-level security must be on for every table"


def test_valid_draft_is_accepted(db: psycopg.Connection) -> None:
    _draft(db)


def test_cited_ids_must_be_retrieved(db: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation, match="cited_subset_of_retrieved"):
        _draft(db, cited_ids=["SEC-005"])


def test_no_source_means_no_answer(db: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation, match="no_source_no_answer"):
        _draft(db, cited_ids=[], suggested_status="Needs decision", confidence="needs_decision")


def test_needs_decision_row_left_empty_is_accepted(db: psycopg.Connection) -> None:
    _draft(db, answer_text=None, cited_ids=[], suggested_status="Needs decision",
           confidence="needs_decision")


def test_draft_requires_traceability(db: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.NotNullViolation):
        _draft(db, prompt_version=None)


def test_unknown_status_rejected(db: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        _draft(db, suggested_status="Approved")


def test_bid_decision_needs_written_reason(db: psycopg.Connection) -> None:
    rfp_id = _rfp(db)
    with pytest.raises(psycopg.errors.CheckViolation, match="decision_has_reviewer_and_reason"):
        db.execute("update rfp set decision = 'no_bid', decided_by = 'Dana', decision_reason = ' '"
                   " where id = %s", (rfp_id,))


def test_ai_cannot_be_reviewer(db: psycopg.Connection) -> None:
    req_id = _requirement(db)
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("insert into review_decision (requirement_id, reviewer, action) "
                   "values (%s, 'AI', 'approve')", (req_id,))
