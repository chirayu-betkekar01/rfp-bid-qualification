"""AI suggestions: code, not the model, enforces sources, stale and unprofiled flags, and gap flags."""
import json
from datetime import date
from types import SimpleNamespace

import psycopg

from src.library.load import read_library
from src.llm import LLMClient
from src.suggest.suggest import (NO_SOURCE, SUGGEST_PROMPT, LineItem, RawSuggestion, SuggestResult, check,
                                 gap_flags, load_items, save, suggest)

TODAY = date(2026, 10, 17)        # exactly SEC-015, HOST-007, PRC-006 and SUP-004 are stale
LIBRARY = {a.id: a for a in read_library()}
ITEM = LineItem(id=1, ref="R-001", rfp_section="IV.D", type="Security", priority="mandatory",
                text="Encrypt data in transit and at rest.")


def raw(answer: str = "Yes", cited: list[str] | None = None, reason: str = "SEC-005 covers it.") -> RawSuggestion:
    return RawSuggestion(item="R-001", answer=answer, cited_ids=["SEC-005"] if cited is None else cited, reason=reason)


def test_a_sourced_suggestion_is_kept() -> None:
    s, unknown = check(raw(), ITEM, LIBRARY, TODAY)
    assert (s.answer, s.cited_ids, s.flags, unknown) == ("Yes", ("SEC-005",), (), 0)


def test_ids_not_in_the_library_are_dropped_and_leave_no_answer() -> None:
    s, unknown = check(raw(cited=["SEC-999"], reason="SEC-999 says yes."), ITEM, LIBRARY, TODAY)
    assert (s.answer, s.cited_ids, s.reason, unknown) == (None, (), NO_SOURCE, 1)


def test_none_means_no_answer_and_no_citations() -> None:
    s, _ = check(raw(answer="None", cited=["SEC-005"], reason="A submission rule; nothing in the library."),
                 ITEM, LIBRARY, TODAY)
    assert (s.answer, s.cited_ids, s.reason) == (None, (), "A submission rule; nothing in the library.")


def test_citing_a_stale_entry_is_flagged() -> None:
    s, _ = check(raw(answer="Maybe", cited=["SEC-015"]), ITEM, LIBRARY, TODAY)
    assert "stale_source" in s.flags


def test_citing_an_unprofiled_entry_is_flagged() -> None:
    s, _ = check(raw(answer="Maybe", cited=["LEG-005"]), ITEM, LIBRARY, TODAY)
    assert "unprofiled_source" in s.flags


def test_gap_flags_come_from_config_keywords() -> None:
    assert gap_flags("Vendor must hold a FedRAMP Moderate authorization.") == ["hard_fail_gap:fedramp"]
    assert gap_flags("Comply with HIPAA and sign a BAA.") == ["hard_fail_gap:hipaa_baa"]
    assert gap_flags("Provide IVR for the call center.") == ["soft_gap:no_native_telephony_via_twilio"]
    assert gap_flags("Babaa encryption") == []          # keywords match whole words only


def test_long_reasons_are_cut_to_a_sentence() -> None:
    long = "SEC-005 covers encryption. " + "More detail here. " * 30
    s, _ = check(raw(reason=long), ITEM, LIBRARY, TODAY)
    assert len(s.reason) <= 240 and s.reason.endswith(".")


class FakeCreate:
    """Says Yes with SEC-005 for every item except the last in each batch, which it skips."""
    def __call__(self, **kwargs):
        user = kwargs["messages"][1]["content"]
        keys = [part.split('"')[0] for part in user.split('<item key="')[1:]]
        body = {"suggestions": [{"item": k, "answer": "Yes", "cited_ids": ["SEC-005"], "reason": "SEC-005."}
                                for k in keys[:-1]]}
        return SimpleNamespace(model="fake/model", provider="Fake",
                               choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(body)))],
                               usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, cost=0.01))


def test_suggest_batches_and_reports_skipped_items(tmp_path) -> None:
    items = [LineItem(n, f"R-{n:03d}", "IV", "Functional", "mandatory", f"Item {n}") for n in range(1, 31)]
    result = suggest(items, list(LIBRARY.values()), LLMClient(create=FakeCreate(), log_path=tmp_path / "l.jsonl"),
                     "fake/model", TODAY)
    assert result.missing == ["R-025", "R-030"]           # last of each batch of 25
    assert len(result.suggestions) == 28 and result.prompt_version == SUGGEST_PROMPT


def test_save_and_skip_already_suggested(db: psycopg.Connection) -> None:
    rfp_id = db.execute("insert into rfp (buyer, title, source_file) values ('b', 't', 'f') returning id").fetchone()[0]
    req = db.execute("insert into requirement (rfp_id, req_ref, text, type, created_by)"
                     " values (%s, 'R-001', 'Encrypt data', 'Security', 'ai') returning id", (rfp_id,)).fetchone()[0]
    items = load_items(db, rfp_id, skip_prompt=SUGGEST_PROMPT)
    assert [i.id for i in items] == [req]
    s, _ = check(raw(), items[0], LIBRARY, TODAY)
    save(db, SuggestResult([s], "fake/model", SUGGEST_PROMPT, [], 0, 0.0))
    assert load_items(db, rfp_id, skip_prompt=SUGGEST_PROMPT) == []
    row = db.execute("select answer, cited_ids, model, prompt_version from ai_suggestion where requirement_id = %s",
                     (req,)).fetchone()
    assert row == ("Yes", ["SEC-005"], "fake/model", SUGGEST_PROMPT)
