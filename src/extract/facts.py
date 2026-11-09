"""Read the facts the go/no-go score needs from an RFP: product category, buyer kind,
budget, incumbent system, number of staff users and issue date.

The model only reads; code checks what it returns (a category from the vendor's list
or "other", real dates, positive numbers) and strips contact details from quotes.
Every fact is saved as an `rfp_fact` row with its quote, page, model and prompt
version. The proposal manager corrects facts on the report screen; corrections are
new rows, so the AI's reading is never overwritten.

    python -m src.extract.facts --rfp 171 [--pdf data/test_rfps/tulsa_rfp_26-901.pdf]
"""
import argparse
import os
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

import psycopg
from dotenv import load_dotenv
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from src.config import ROOT, vendor_config
from src.extract.extract import format_window
from src.llm import CACHE_DIR, LLMClient, load_prompt
from src.parse.pdf import parse_pdf
from src.parse.sections import ParsedDocument

FACTS_PROMPT = "rfp_facts_v1"
MAX_TOKENS = 1_500
QUOTE_CHARS = 300
RFP_FOLDERS = [ROOT / "data" / "test_rfps", ROOT / "data" / "mock_rfps"]

Incumbent = Literal["none", "legacy", "hubspot", "zendesk", "salesforce", "microsoft_dynamics", "other", "unknown"]


class ProductFact(BaseModel):
    product_sought: str
    category: str
    quote: str | None
    page: int | None


class BuyerFact(BaseModel):
    kind: Literal["public_sector", "commercial"]
    quote: str | None
    page: int | None


class BudgetFact(BaseModel):
    usd_per_year: float | None
    quote: str | None
    page: int | None


class IncumbentFact(BaseModel):
    value: Incumbent
    quote: str | None
    page: int | None


class UsersFact(BaseModel):
    count: int | None
    quote: str | None
    page: int | None


class IssuedFact(BaseModel):
    date: str | None
    quote: str | None
    page: int | None


class RfpFacts(BaseModel):
    product: ProductFact
    buyer: BuyerFact
    budget: BudgetFact
    incumbent: IncumbentFact
    users: UsersFact
    issued: IssuedFact


@dataclass(frozen=True)
class Fact:
    name: str            # an rfp_fact name
    value: Any           # None: the RFP doesn't say
    quote: str | None
    page: int | None


@dataclass(frozen=True)
class FactsResult:
    facts: list[Fact]
    model: str
    prompt_version: str
    cost_usd: float


def categories() -> list[str]:
    return list(vendor_config()["category"])


def read_facts(doc: ParsedDocument, client: LLMClient, model: str) -> FactsResult:
    """One call over the whole document: budgets and user counts are rarely on the first pages."""
    prompt = load_prompt(FACTS_PROMPT)
    user = (f"Categories: {', '.join(categories())}, other\n\n"
            f"RFP text:\n\n{format_window(doc.blocks)}")
    result = client.complete_json(purpose="rfp_facts", model=model, prompt=prompt, user=user,
                                  schema=RfpFacts, max_tokens=MAX_TOKENS)
    return FactsResult(facts=check(result.data), model=result.model, prompt_version=prompt.version,
                       cost_usd=result.cost_usd or 0.0)


def check(raw: RfpFacts) -> list[Fact]:
    """Turn the model's reading into facts, keeping only values code can stand behind."""
    p, b, budget, inc, users, issued = raw.product, raw.buyer, raw.budget, raw.incumbent, raw.users, raw.issued
    category = p.category.strip().lower()
    usd = budget.usd_per_year if budget.usd_per_year and budget.usd_per_year > 0 else None
    count = users.count if users.count and users.count > 0 else None
    when = _date(issued.date)
    return [
        Fact("product_sought", p.product_sought.strip()[:120], *_evidence(p.quote, p.page)),
        Fact("category", category if category in categories() else "other", *_evidence(p.quote, p.page)),
        Fact("buyer_kind", b.kind, *_evidence(b.quote, b.page)),
        Fact("budget_per_year_usd", round(usd, 2) if usd else None, *_evidence(budget.quote, budget.page, usd)),
        Fact("incumbent", inc.value, *_evidence(inc.quote, inc.page, None if inc.value == "unknown" else inc.value)),
        Fact("staff_users", count, *_evidence(users.quote, users.page, count)),
        Fact("issued_on", when.isoformat() if when else None, *_evidence(issued.quote, issued.page, when)),
    ]


EMAIL = re.compile(r"\S+@\S+")
PHONE = re.compile(r"(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")


def scrub(quote: str) -> str:
    """Buyer contact details never leave the RFP (rule 8), even inside a quote."""
    quote = PHONE.sub("[phone removed]", EMAIL.sub("[email removed]", quote))
    return " ".join(quote.split())[:QUOTE_CHARS]


def _evidence(quote: str | None, page: int | None, value: Any = True) -> tuple[str | None, int | None]:
    if value is None or not quote or not quote.strip():
        return None, None
    return scrub(quote), page if page and page > 0 else None


def _date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def save_facts(conn: psycopg.Connection, rfp_id: int, result: FactsResult) -> int:
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(
            "insert into rfp_fact (rfp_id, name, value, quote, page, source, model, prompt_version)"
            " values (%s, %s, %s, %s, %s, 'ai', %s, %s)",
            [(rfp_id, f.name, Jsonb(f.value), f.quote, f.page, result.model,
              result.prompt_version) for f in result.facts],
        )
    return len(result.facts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rfp", type=int, required=True, help="rfp id")
    parser.add_argument("--pdf", type=Path, help="the RFP's PDF (default: <source file> in data/test_rfps or data/mock_rfps)")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    model, url = os.environ.get("OPENROUTER_EXTRACT_MODEL"), os.environ.get("DATABASE_URL")
    if not model or not url:
        raise SystemExit("Set OPENROUTER_EXTRACT_MODEL and DATABASE_URL in .env.")

    with psycopg.connect(url) as conn:       # fail on a bad DATABASE_URL before paying for the call
        row = conn.execute("select source_file from rfp where id = %s", (args.rfp,)).fetchone()
        if not row:
            raise SystemExit(f"No rfp with id {args.rfp}.")
        pdf = args.pdf or next((d / row[0] for d in RFP_FOLDERS if (d / row[0]).exists()), RFP_FOLDERS[0] / row[0])
        doc = parse_pdf(pdf)
        result = read_facts(doc, LLMClient(cache_dir=CACHE_DIR), model)
        save_facts(conn, args.rfp, result)

    print(f"Saved {len(result.facts)} facts for rfp {args.rfp} with {result.model} "
          f"({result.prompt_version}), cost ${result.cost_usd:.3f}")
    for f in result.facts:
        print(f"  {f.name}: {f.value!r}" + (f"  (p. {f.page}) \"{f.quote}\"" if f.quote else ""))


if __name__ == "__main__":
    main()
