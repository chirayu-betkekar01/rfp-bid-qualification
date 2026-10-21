"""Parse an RFP, extract its requirement list and save it for Checkpoint A.

    python -m src.extract.run data/test_rfps/tulsa_rfp_26-901.pdf
"""
import argparse
import json
import os
from collections import Counter
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from src.config import ROOT
from src.extract.extract import extract, save
from src.llm import CACHE_DIR, LLMClient
from src.parse.pdf import parse_pdf

SAVED_RUNS = ROOT / "logs" / "extractions"     # local copy, so a failed save doesn't lose a paid run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--parallel", type=int, default=2, help="model calls at a time (default 2)")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    model, url = os.environ.get("OPENROUTER_EXTRACT_MODEL"), os.environ.get("DATABASE_URL")
    if not model or not url:
        raise SystemExit("Set OPENROUTER_EXTRACT_MODEL and DATABASE_URL in .env.")

    with psycopg.connect(url) as conn:       # fail on a bad DATABASE_URL before paying for model calls
        doc = parse_pdf(args.pdf)
        print(f"Parsed {doc.source_file}: {doc.page_count} pages, {len(doc.blocks)} blocks")
        result = extract(doc, LLMClient(cache_dir=CACHE_DIR), model, parallel=args.parallel)
        saved = _keep_copy(doc.source_file, result)
        rfp_id = save(conn, doc, result)
    print(f"Saved a local copy to {saved.relative_to(ROOT)}")

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


def _keep_copy(source_file: str, result) -> Path:
    SAVED_RUNS.mkdir(parents=True, exist_ok=True)
    path = SAVED_RUNS / f"{Path(source_file).stem}_{datetime.now():%Y%m%d_%H%M%S}.json"
    data = {**asdict(result), "meta": result.meta.model_dump(),
            "rows": [row.model_dump() for row in result.rows]}
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path


if __name__ == "__main__":
    main()
