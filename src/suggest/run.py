"""Suggest a Yes / No / Maybe for an RFP's line items and save them for the review screens.

    python -m src.suggest.run --rfp 171 [--today YYYY-MM-DD] [--all]

Items that already have a suggestion from the current prompt are skipped unless --all is given.
"""
import argparse
import os
from collections import Counter
from datetime import date

import psycopg
from dotenv import load_dotenv

from src.config import ROOT
from src.library.load import read_library
from src.llm import CACHE_DIR, LLMClient
from src.suggest.suggest import SUGGEST_PROMPT, load_items, save, suggest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rfp", type=int, required=True, help="rfp id")
    parser.add_argument("--today", type=date.fromisoformat, default=date.today(),
                        help="date used to decide which library answers are stale (default: today)")
    parser.add_argument("--all", action="store_true", help="suggest again for items that already have one")
    parser.add_argument("--parallel", type=int, default=2, help="model calls at a time (default 2)")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    model = os.environ.get("OPENROUTER_SUGGEST_MODEL") or os.environ.get("OPENROUTER_DRAFT_MODEL")
    url = os.environ.get("DATABASE_URL")
    if not model or not url:
        raise SystemExit("Set OPENROUTER_DRAFT_MODEL (or OPENROUTER_SUGGEST_MODEL) and DATABASE_URL in .env.")

    with psycopg.connect(url) as conn:       # fail on a bad DATABASE_URL before paying for model calls
        items = load_items(conn, args.rfp, skip_prompt=None if args.all else SUGGEST_PROMPT)
        if not items:
            print(f"rfp {args.rfp}: nothing to suggest (every item already has a {SUGGEST_PROMPT} suggestion)")
            return
        result = suggest(items, read_library(), LLMClient(cache_dir=CACHE_DIR), model, args.today,
                         parallel=args.parallel)
        saved = save(conn, result)

    answers = Counter(s.answer or "no source" for s in result.suggestions)
    flags = Counter(f.split(":")[0] if ":" in f else f for s in result.suggestions for f in s.flags)
    print(f"Saved {saved} suggestions for rfp {args.rfp} with {result.model} ({result.prompt_version}), "
          f"cost ${result.cost_usd:.3f}")
    print("  answers: " + ", ".join(f"{k} {v}" for k, v in answers.most_common()))
    if flags:
        print("  flags: " + ", ".join(f"{k} {v}" for k, v in flags.most_common()))
    if result.missing:
        print(f"  warning: the model skipped {len(result.missing)} items: {', '.join(result.missing)}")
    if result.unknown_ids:
        print(f"  warning: dropped {result.unknown_ids} cited IDs that are not in the library")


if __name__ == "__main__":
    main()
