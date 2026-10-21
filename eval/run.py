"""Score the latest system run for a test RFP and log it.

    python -m eval.run --rfp tulsa [--today YYYY-MM-DD]

Reads the newest run for that RFP from DATABASE_URL. With no database or no
run yet, it scores an empty run. Prints a scorecard and appends a row to
eval/runs.csv.
"""
import argparse
import csv
import os
import subprocess
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from eval.answer_key import KeyRow, load_answer_key
from eval.predictions import PredictedRow, load_predictions, load_recommendation
from eval.scorecard import Scorecard, score_run
from src.config import ROOT
from src.library.load import read_library

RUNS_CSV = ROOT / "eval" / "runs.csv"
RUN_COLUMNS = ["run_at", "rfp", "git_commit", "models", "prompt_versions", "predicted_rows",
               "matched", "recall", "precision", "status_match", "citation_overlap",
               "unflagged_traps", "needs_decision_ok", "high_risk_ok", "go_no_go", "passed", "note"]


@dataclass(frozen=True)
class TestRfp:
    source_file: str
    expected_go_no_go: str | None   # "bid" | "no_bid"; None when not applicable
    answer_key: Path | None = None


TEST_RFPS = {
    "tulsa": TestRfp("tulsa_rfp_26-901.pdf", "no_bid", ROOT / "data" / "tulsa_matrix.csv"),
    "asheville": TestRfp("asheville_service_request.pdf", "bid"),
    "utep": TestRfp("utep_rfp_724-2605.pdf", "no_bid"),
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rfp", required=True, choices=sorted(TEST_RFPS))
    parser.add_argument("--today", type=date.fromisoformat, default=date.today(),
                        help="date used for stale checks (default: today)")
    args = parser.parse_args()

    test = TEST_RFPS[args.rfp]
    key = load_answer_key(test.answer_key) if test.answer_key else None
    predicted, recommendation, note = _load_run(test)
    go_no_go = (recommendation, test.expected_go_no_go) if test.expected_go_no_go else None

    card = score_run(key, predicted, read_library(), args.today, go_no_go)
    print_scorecard(args.rfp, card, key, predicted, note)
    append_run(RUNS_CSV, args.rfp, card, predicted, note)
    print(f"\nLogged to {RUNS_CSV.relative_to(ROOT)}")


def _load_run(test: TestRfp) -> tuple[list[PredictedRow], str | None, str]:
    load_dotenv(ROOT / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        return [], None, "empty run: DATABASE_URL not set"
    with psycopg.connect(url) as conn:
        predicted = load_predictions(conn, test.source_file)
        if predicted is None:
            return [], None, f"empty run: no rfp with source_file {test.source_file}"
        return predicted, load_recommendation(conn, test.source_file), ""


def print_scorecard(name: str, card: Scorecard, key: list[KeyRow] | None,
                    predicted: list[PredictedRow], note: str) -> None:
    title = f"Eval: {name}   {card.predicted_rows} extracted rows, {card.matched} matched"
    if key:
        title += f" of {len(key)} key rows"
    print(title + (f"   ({note})" if note else ""))
    print(f"\n  {'Measure':<38} {'Value':>11}  {'Target':>8}  Result")
    for m in card.measures():
        print(f"  {m.name:<38} {m.value:>11}  {m.target:>8}  {m.result}")
    print(f"\n  Overall: {'PASS' if card.passed else 'FAIL'}")

    if card.match and card.match.borderline and key:
        print("\n  Borderline pairs (check by hand):")
        for p in card.match.borderline:
            k, pr = key[p.key_index], predicted[p.pred_index]
            print(f"    {p.score:.2f}  {k.req_id} [{k.rfp_section}] {k.requirement[:45]!r}")
            print(f"          <-> [{pr.ref}] {pr.text[:45]!r}")


def append_run(path: Path, name: str, card: Scorecard, predicted: list[PredictedRow],
               note: str) -> None:
    new_file = not path.exists()
    with path.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=RUN_COLUMNS)
        if new_file:
            writer.writeheader()
        go = card.go_no_go
        writer.writerow({
            "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "rfp": name,
            "git_commit": _git_commit(),
            "models": ";".join(sorted({p.model for p in predicted if p.model})),
            "prompt_versions": ";".join(sorted({p.prompt_version for p in predicted if p.prompt_version})),
            "predicted_rows": card.predicted_rows,
            "matched": card.matched,
            "recall": _num(card.recall),
            "precision": _num(card.precision),
            "status_match": _num(card.status_match),
            "citation_overlap": _num(card.citation_overlap),
            "unflagged_traps": card.unflagged_traps,
            "needs_decision_ok": _frac(card.needs_decision_ok),
            "high_risk_ok": _frac(card.high_risk_ok),
            "go_no_go": "" if go is None else f"{go[0] or 'not scored'}/{go[1]}",
            "passed": card.passed,
            "note": note,
        })


def _git_commit() -> str:
    def git(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    commit = git("rev-parse", "--short", "HEAD")
    return f"{commit}-dirty" if commit and git("status", "--porcelain") else commit


def _num(x: float | None) -> str:
    return "" if x is None else f"{x:.4f}"


def _frac(x: tuple[int, int] | None) -> str:
    return "" if x is None else f"{x[0]}/{x[1]}"


if __name__ == "__main__":
    main()
