"""Group an RFP's line items into its top-level sections ("IV", "Exhibit B").

Sections come from the parser: each block's reference starts with the part it
belongs to, and the block's heading is the part's title. Line items whose
reference the parser never produced get a section named after that reference,
so every item lands in exactly one section.

    python -m src.extract.sections        # backfill RFPs saved before sections existed
"""
import os
import re
from dataclasses import dataclass
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from src.config import ROOT
from src.parse.pdf import parse_pdf
from src.parse.sections import ParsedDocument

TEST_RFPS = ROOT / "data" / "test_rfps"
NUMBERED_PART = re.compile(r"^((?:Section|Article|Part) [0-9IVX]+)")
PAGE_REF = re.compile(r"^p\.\d+$")
COVER = "Cover"


@dataclass(frozen=True)
class SectionPlan:
    ref: str
    title: str
    position: int


def top_part(ref: str | None) -> str:
    """The top-level part of a reference: "IV.A.1" -> "IV", "Section 2.1" -> "Section 2"."""
    if not ref or ref == COVER or PAGE_REF.match(ref):
        return COVER
    if m := NUMBERED_PART.match(ref):
        return m.group(1)
    return ref.split(".")[0].strip()


def plan_sections(doc: ParsedDocument, row_refs: list[str | None]) -> list[SectionPlan]:
    """Sections in document order, then any parts only the line items mention, in row order."""
    titles: dict[str, str] = {}
    for block in doc.blocks:
        part = top_part(block.ref)
        if part not in titles:
            titles[part] = "Cover and front matter" if part == COVER else (block.heading.strip() or part)
    used = [top_part(ref) for ref in row_refs]
    for part in used:
        titles.setdefault(part, part)
    wanted = set(used)
    ordered = [part for part in titles if part in wanted]
    return [SectionPlan(ref=part, title=titles[part], position=n) for n, part in enumerate(ordered, start=1)]


def save_sections(conn: psycopg.Connection, rfp_id: int, doc: ParsedDocument) -> int:
    """Create the RFP's sections and point every line item at its own. Returns the section count."""
    rows = conn.execute("select id, rfp_section from requirement where rfp_id = %s order by id",
                        (rfp_id,)).fetchall()
    plans = plan_sections(doc, [ref for _, ref in rows])
    with conn.transaction():
        ids: dict[str, int] = {}
        for plan in plans:
            ids[plan.ref] = conn.execute(
                "insert into rfp_section (rfp_id, ref, title, position) values (%s, %s, %s, %s)"
                " on conflict (rfp_id, ref) do update set title = excluded.title, position = excluded.position"
                " returning id",
                (rfp_id, plan.ref, plan.title, plan.position),
            ).fetchone()[0]
        with conn.cursor() as cur:
            cur.executemany("update requirement set section_id = %s where id = %s",
                            [(ids[top_part(ref)], row_id) for row_id, ref in rows])
    return len(plans)


def backfill(conn: psycopg.Connection) -> None:
    missing = conn.execute(
        "select distinct r.id, r.source_file from rfp r join requirement q on q.rfp_id = r.id"
        " where q.section_id is null order by r.id"
    ).fetchall()
    for rfp_id, source_file in missing:
        path = TEST_RFPS / Path(source_file).name
        if not path.exists():
            print(f"  rfp {rfp_id}: {path.name} not found in data/test_rfps, skipped")
            continue
        count = save_sections(conn, rfp_id, parse_pdf(path))
        print(f"  rfp {rfp_id}: {count} sections")


def main() -> None:
    load_dotenv(ROOT / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("Set DATABASE_URL in .env.")
    with psycopg.connect(url) as conn:
        backfill(conn)


if __name__ == "__main__":
    main()
