"""Load the content library from data/library.csv into library_answer.

The CSV is read-only here: owners edit the library in Google Sheets and
re-export it (rule 7). Stale status depends on the date, so `today` is always
passed in.

    python -m src.library.load [--today YYYY-MM-DD]
"""
import argparse
import csv
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from src.config import ROOT, vendor_config

LIBRARY_CSV = ROOT / "data" / "library.csv"
COLUMNS = ["id", "category", "question", "answer", "answer_type", "source_section",
           "owner", "last_reviewed", "tags"]
ANSWER_TYPES = {"Yes", "No", "Partial", "Via integration", "Narrative"}
ID_PREFIXES = {"COM", "PRD", "PUB", "INT", "SEC", "HOST", "IMP", "SUP", "PRC", "LEG", "ACC", "REF"}
UNPROFILED_SOURCE = "Not in vendor profile"


@dataclass(frozen=True)
class LibraryAnswer:
    id: str
    category: str
    question: str
    answer: str
    answer_type: str
    source_section: str
    owner: str
    last_reviewed: date
    tags: tuple[str, ...]

    @property
    def unprofiled(self) -> bool:
        """The answer is not backed by the vendor profile: drafts must flag `unprofiled_source`."""
        return self.source_section == UNPROFILED_SOURCE


def is_stale(answer: LibraryAnswer, today: date, cycle_days: int | None = None) -> bool:
    if cycle_days is None:
        cycle_days = vendor_config()["review_cycle_days"]
    return (today - answer.last_reviewed).days > cycle_days


def status(answer: LibraryAnswer, today: date, cycle_days: int | None = None) -> str:
    return "Stale" if is_stale(answer, today, cycle_days) else "Current"


def read_library(path: Path = LIBRARY_CSV) -> list[LibraryAnswer]:
    """Parse and validate the CSV. Raises ValueError naming the first bad row."""
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != COLUMNS:
            raise ValueError(f"{path.name}: expected columns {COLUMNS}, got {reader.fieldnames}")
        answers = [_parse_row(row, line) for line, row in enumerate(reader, start=2)]

    seen: set[str] = set()
    for a in answers:
        if a.id in seen:
            raise ValueError(f"{path.name}: duplicate id {a.id}")
        seen.add(a.id)
    return answers


def _parse_row(row: dict[str, str], line: int) -> LibraryAnswer:
    where = f"library.csv line {line} ({row.get('id') or 'no id'})"
    for col in COLUMNS[:-1]:
        if not (row[col] or "").strip():
            raise ValueError(f"{where}: {col} is empty")
    if row["id"].split("-")[0] not in ID_PREFIXES:
        raise ValueError(f"{where}: unknown id prefix")
    if row["answer_type"] not in ANSWER_TYPES:
        raise ValueError(f"{where}: answer_type {row['answer_type']!r} not in {sorted(ANSWER_TYPES)}")
    try:
        last_reviewed = date.fromisoformat(row["last_reviewed"])
    except ValueError:
        raise ValueError(f"{where}: last_reviewed {row['last_reviewed']!r} is not YYYY-MM-DD") from None
    return LibraryAnswer(
        id=row["id"].strip(),
        category=row["category"].strip(),
        question=row["question"].strip(),
        answer=row["answer"].strip(),
        answer_type=row["answer_type"],
        source_section=row["source_section"].strip(),
        owner=row["owner"].strip(),
        last_reviewed=last_reviewed,
        tags=tuple(t.strip() for t in (row["tags"] or "").split(",") if t.strip()),
    )


UPSERT = """
insert into library_answer
  (id, category, question, answer, answer_type, source_section, owner, last_reviewed, status, tags, synced_at)
values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
on conflict (id) do update set
  category = excluded.category,
  question = excluded.question,
  answer = excluded.answer,
  answer_type = excluded.answer_type,
  source_section = excluded.source_section,
  owner = excluded.owner,
  last_reviewed = excluded.last_reviewed,
  status = excluded.status,
  tags = excluded.tags,
  synced_at = excluded.synced_at,
  -- An embedding describes the old text; drop it when the text changes.
  embedding = case
    when (library_answer.question, library_answer.answer) is distinct from (excluded.question, excluded.answer)
    then null else library_answer.embedding end,
  embedding_model = case
    when (library_answer.question, library_answer.answer) is distinct from (excluded.question, excluded.answer)
    then null else library_answer.embedding_model end
"""


@dataclass(frozen=True)
class SyncResult:
    loaded: int
    removed: list[str]
    stale: list[str]
    unprofiled: list[str]


def sync_library(conn: psycopg.Connection, answers: list[LibraryAnswer], today: date) -> SyncResult:
    """Make library_answer match the CSV: upsert every row, delete rows no longer in it."""
    ids = [a.id for a in answers]
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(UPSERT, [
            (a.id, a.category, a.question, a.answer, a.answer_type, a.source_section, a.owner,
             a.last_reviewed, status(a, today), list(a.tags))
            for a in answers
        ])
        cur.execute("delete from library_answer where not (id = any(%s)) returning id", (ids,))
        removed = sorted(r[0] for r in cur.fetchall())
    return SyncResult(
        loaded=len(answers),
        removed=removed,
        stale=[a.id for a in answers if is_stale(a, today)],
        unprofiled=[a.id for a in answers if a.unprofiled],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--today", type=date.fromisoformat, default=date.today(),
                        help="date used for stale checks (default: today)")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set. Copy .env.example to .env and fill it in.")

    answers = read_library()
    with psycopg.connect(url) as conn:
        result = sync_library(conn, answers, args.today)

    print(f"Loaded {result.loaded} library answers (stale as of {args.today}).")
    print(f"  Stale:      {', '.join(result.stale) or 'none'}")
    print(f"  Unprofiled: {', '.join(result.unprofiled) or 'none'}")
    if result.removed:
        print(f"  Removed (no longer in the CSV): {', '.join(result.removed)}")


if __name__ == "__main__":
    main()
