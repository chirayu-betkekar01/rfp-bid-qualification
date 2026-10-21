"""Parse an RFP, extract its requirement list and save it for Checkpoint A.

    python -m src.extract.run data/test_rfps/tulsa_rfp_26-901.pdf
"""
import argparse
import os
from collections import Counter
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from src.config import ROOT
from src.extract.extract import extract, save
from src.llm import LLMClient
from src.parse.pdf import parse_pdf


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    model, url = os.environ.get("OPENROUTER_EXTRACT_MODEL"), os.environ.get("DATABASE_URL")
    if not model or not url:
        raise SystemExit("Set OPENROUTER_EXTRACT_MODEL and DATABASE_URL in .env.")

    doc = parse_pdf(args.pdf)
    print(f"Parsed {doc.source_file}: {doc.page_count} pages, {len(doc.blocks)} blocks")
    result = extract(doc, LLMClient(), model)

    with psycopg.connect(url) as conn:
        rfp_id = save(conn, doc, result)

    types = Counter(r.type for r in result.rows)
    print(f"Extracted {len(result.rows)} rows with {result.model} ({result.prompt_version}), "
          f"cost ${result.cost_usd:.3f}")
    print(f"  rfp id {rfp_id}: {result.meta.buyer} | {result.meta.title} | due {result.meta.due_date}")
    print(f"  mandatory {sum(r.mandatory == 'yes' for r in result.rows)}, "
          f"scored {sum(r.mandatory == 'scored' for r in result.rows)}, "
          f"optional {sum(r.mandatory == 'no' for r in result.rows)}")
    print("  types: " + ", ".join(f"{t} {n}" for t, n in types.most_common()))
    if result.unknown_refs:
        print(f"  warning: {result.unknown_refs} rows cite a section the parser did not produce")


if __name__ == "__main__":
    main()
