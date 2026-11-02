"""RFP facts for go/no-go: code checks the model's reading, strips contact details, and keeps a trace."""
from types import SimpleNamespace

import psycopg
import pytest

from src.extract.facts import FACTS_PROMPT, RfpFacts, check, read_facts, save_facts, scrub
from src.llm import LLMClient
from src.parse.sections import Block, ParsedDocument


def raw(**overrides) -> RfpFacts:
    data = {
        "product": {"product_sought": "constituent CRM", "category": "constituent_service_311",
                    "quote": "CRM for constituent inquiries", "page": 4},
        "buyer": {"kind": "public_sector", "quote": "City of Tulsa", "page": 1},
        "budget": {"usd_per_year": 20000, "quote": "not to exceed $20,000 for the year", "page": 10},
        "incumbent": {"value": "unknown", "quote": "something", "page": 3},
        "users": {"count": 25, "quote": "for 1-25 users", "page": 4},
        "issued": {"date": "2025-08-12", "quote": "RFP Issue Date 08/12/2025", "page": 1},
    }
    for key, value in overrides.items():
        data[key] = {**data[key], **value}
    return RfpFacts.model_validate(data)


def facts(r: RfpFacts) -> dict:
    return {f.name: f for f in check(r)}


def test_a_clean_reading_becomes_seven_facts() -> None:
    f = facts(raw())
    assert {k: v.value for k, v in f.items()} == {
        "product_sought": "constituent CRM", "category": "constituent_service_311", "buyer_kind": "public_sector",
        "budget_per_year_usd": 20000, "incumbent": "unknown", "staff_users": 25, "issued_on": "2025-08-12",
    }
    assert (f["budget_per_year_usd"].quote, f["budget_per_year_usd"].page) == ("not to exceed $20,000 for the year", 10)


def test_a_category_outside_the_vendor_list_becomes_other() -> None:
    assert facts(raw(product={"category": "Scheduling"}))["category"].value == "other"
    assert facts(raw(product={"category": " CRM "}))["category"].value == "crm"


def test_unknown_values_carry_no_quote() -> None:
    f = facts(raw(budget={"usd_per_year": None}, users={"count": 0}, issued={"date": "Feb 2026"}))
    for name in ("budget_per_year_usd", "staff_users", "issued_on"):
        assert (f[name].value, f[name].quote, f[name].page) == (None, None, None)
    assert f["incumbent"].quote is None            # "unknown" has nothing to quote


def test_quotes_never_carry_contact_details() -> None:
    quote = "Questions to Jane Roe at jroe@cityoftulsa.org or (918) 596-7777 by August 20."
    assert scrub(quote) == "Questions to Jane Roe at [email removed] or [phone removed] by August 20."


def test_read_facts_sends_the_whole_document_and_the_vendor_categories() -> None:
    seen = {}

    def create(**kwargs):
        seen["user"] = kwargs["messages"][1]["content"]
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop",
                                                        message=SimpleNamespace(content=raw().model_dump_json()))],
                               model="test-model", usage=None)

    doc = ParsedDocument(source_file="x.pdf", page_count=30, blocks=[
        Block("I", "INTRO", "City of Tulsa", 1, 1), Block("X", "PRICING", "not to exceed $20,000", 29, 29)])
    result = read_facts(doc, LLMClient(create=create, log_path=_null_log()), "test-model")
    assert seen["user"].startswith("Categories: crm, customer_service, constituent_service_311, other")
    assert "[X] (page 29)" in seen["user"]
    assert (result.model, result.prompt_version, len(result.facts)) == ("test-model", FACTS_PROMPT, 7)


def _null_log():
    import tempfile
    from pathlib import Path
    return Path(tempfile.mkdtemp()) / "calls.jsonl"


def _rfp(db: psycopg.Connection) -> int:
    return db.execute("insert into rfp (buyer, title, source_file) values ('B', 'T', 'x.pdf') returning id").fetchone()[0]


def test_saved_facts_are_traced(db: psycopg.Connection) -> None:
    from src.extract.facts import FactsResult
    rfp_id = _rfp(db)
    save_facts(db, rfp_id, FactsResult(facts=check(raw()), model="m", prompt_version=FACTS_PROMPT, cost_usd=0))
    rows = db.execute("select name, value, source, model, prompt_version from rfp_fact where rfp_id = %s order by id",
                      (rfp_id,)).fetchall()
    assert len(rows) == 7 and all(r[2:] == ("ai", "m", FACTS_PROMPT) for r in rows)
    assert dict((r[0], r[1]) for r in rows)["budget_per_year_usd"] == 20000


def test_only_a_person_answers_the_relationship_question(db: psycopg.Connection) -> None:
    rfp_id = _rfp(db)
    with pytest.raises(psycopg.errors.CheckViolation), db.transaction():
        db.execute("insert into rfp_fact (rfp_id, name, value, source, model, prompt_version)"
                   " values (%s, 'relationship', '\"none\"', 'ai', 'm', 'v')", (rfp_id,))
    db.execute("insert into rfp_fact (rfp_id, name, value, source, set_by)"
               " values (%s, 'relationship', '\"none\"', 'person', 'Morgan Lee')", (rfp_id,))


def test_a_correction_needs_a_name_and_a_reason(db: psycopg.Connection) -> None:
    rfp_id = _rfp(db)
    for set_by, reason in (("Morgan Lee", " "), ("", "Budget confirmed by phone")):
        with pytest.raises(psycopg.errors.CheckViolation), db.transaction():
            db.execute("insert into rfp_fact (rfp_id, name, value, source, set_by, reason)"
                       " values (%s, 'budget_per_year_usd', '60000', 'person', %s, %s)", (rfp_id, set_by, reason))
    db.execute("insert into rfp_fact (rfp_id, name, value, source, set_by, reason)"
               " values (%s, 'budget_per_year_usd', '60000', 'person', 'Morgan Lee', 'Addendum 2 raised it')", (rfp_id,))
