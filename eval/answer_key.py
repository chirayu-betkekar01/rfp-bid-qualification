"""Load an answer key such as data/tulsa_matrix.csv."""
import csv
from dataclasses import dataclass
from pathlib import Path

COLUMNS = ["req_id", "rfp_section", "requirement", "type", "mandatory", "expected_status",
           "library_sources", "reviewer_guidance", "risk", "owner"]
STATUSES = {"Fully compliant", "Partially compliant", "Via integration", "Not compliant",
            "Needs decision", "Admin"}
RISKS = {"Low", "Medium", "High"}
MANDATORY = {"Yes", "No", "No (scored)"}


@dataclass(frozen=True)
class KeyRow:
    req_id: str
    rfp_section: str
    requirement: str
    type: str
    mandatory: str                  # Yes | No | No (scored)
    expected_status: str
    library_sources: tuple[str, ...]  # empty when the key says None
    risk: str


def load_answer_key(path: Path) -> list[KeyRow]:
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != COLUMNS:
            raise ValueError(f"{path.name}: expected columns {COLUMNS}, got {reader.fieldnames}")
        rows = [_parse(row, line, path.name) for line, row in enumerate(reader, start=2)]
    if len({r.req_id for r in rows}) != len(rows):
        raise ValueError(f"{path.name}: duplicate req_id")
    return rows


def _parse(row: dict[str, str], line: int, name: str) -> KeyRow:
    where = f"{name} line {line} ({row['req_id']})"
    for col, allowed in (("expected_status", STATUSES), ("risk", RISKS), ("mandatory", MANDATORY)):
        if row[col] not in allowed:
            raise ValueError(f"{where}: {col} {row[col]!r} not in {sorted(allowed)}")
    sources = row["library_sources"].strip()
    return KeyRow(
        req_id=row["req_id"],
        rfp_section=row["rfp_section"].strip(),
        requirement=row["requirement"].strip(),
        type=row["type"],
        mandatory=row["mandatory"],
        expected_status=row["expected_status"],
        library_sources=() if sources == "None" else tuple(s.strip() for s in sources.split(",")),
        risk=row["risk"],
    )
