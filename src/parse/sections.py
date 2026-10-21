"""Split document text into blocks, each with a section reference.

Format-independent: takes lines grouped by page, so the PDF, DOCX and XLSX
parsers can share it. It recognises:

- Roman section headings in capitals, in order: "IV. SCOPE OF WORK:" -> IV
- Named parts: "EXHIBIT B", "APPENDIX A - ...", or a short all-caps title at
  the top of a page ("AFFIDAVIT") -> Exhibit B, Appendix A, Affidavit
- Lettered and numbered items nested under the current part:
  "A." -> IV.A, then "1." -> IV.A.1

Item markers are only accepted when they continue or start a list, which is
how "V. How long have you been in business?" (item V under VIII) is told apart
from "V. DELIVERABLES:" (section V).
"""
import re
from collections import Counter
from dataclasses import dataclass, field

ROMANS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
          "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"]

ROMAN_HEADING = re.compile(r"^(?P<num>[IVX]+)\.\s+(?P<title>[A-Z][A-Z0-9 &,/'’()\-–]*?):?\s*$")
NAMED_PART = re.compile(r"^(?P<kind>EXHIBIT|APPENDIX|ATTACHMENT)\s+(?P<id>[A-Z0-9]{1,3})\b")
SCHEDULE = re.compile(r"^(RFP|PROPOSAL|SOLICITATION)\s+SCHEDULE$", re.IGNORECASE)
ITEM = re.compile(r"^(?:(?P<upper>[A-Z])|(?P<num>\d{1,2})|(?P<lower>[a-z]))(?P<dot>\.)?\s+\S")
PAGE_NUMBER = re.compile(r"^\d{1,3}$")

# Common procurement form titles, shortened to the name reviewers use.
FORM_ALIASES = [
    (re.compile(r"ADDEND(A|UM)"), "Addenda"),
    (re.compile(r"CHECKLIST"), "Checklist"),
    (re.compile(r"AFFIDAVIT"), "Affidavit"),
]


@dataclass(frozen=True)
class Block:
    ref: str            # "IV.A.1", "Exhibit B.6", "Cover"
    heading: str        # title of the top-level part, e.g. "SCOPE OF WORK"
    text: str           # the block's own text, marker included
    page: int           # first page, 1-based
    page_end: int


@dataclass(frozen=True)
class ParsedDocument:
    source_file: str
    page_count: int
    blocks: list[Block]

    def find(self, ref: str) -> list[Block]:
        return [b for b in self.blocks if b.ref == ref]

    def refs(self) -> set[str]:
        return {b.ref for b in self.blocks}


@dataclass
class _Level:
    kind: str           # "upper", "num" or "lower"
    value: int          # 1 for A / 1 / a
    label: str          # "A", "1", "a"


@dataclass
class _State:
    part: str = "Cover"
    heading: str = ""
    roman_index: int = -1
    levels: list[_Level] = field(default_factory=list)

    def ref(self) -> str:
        return ".".join([self.part, *(lvl.label for lvl in self.levels)])


def split_sections(pages: list[list[str]], source_file: str) -> ParsedDocument:
    pages = strip_running_lines(pages)
    blocks: list[Block] = []
    state = _State()
    current: dict | None = None

    def start(page: int, line: str) -> None:
        nonlocal current
        if current:
            blocks.append(_finish(current))
        current = {"ref": state.ref(), "heading": state.heading, "lines": [line],
                   "page": page, "page_end": page}

    for page_no, lines in enumerate(pages, start=1):
        for i, raw in enumerate(lines):
            line = raw.strip()
            if not line:
                continue
            if _roman_heading(line, state):
                start(page_no, line)
            elif _named_part(line, state, first_on_page=(i == 0)):
                start(page_no, line)
            elif _item(line, state):
                start(page_no, line)
            elif current is None:
                start(page_no, line)
            else:
                current["lines"].append(line)
                current["page_end"] = page_no

    if current:
        blocks.append(_finish(current))
    return ParsedDocument(source_file=source_file, page_count=len(pages), blocks=blocks)


def strip_running_lines(pages: list[list[str]]) -> list[list[str]]:
    """Drop running headers (a first line repeated on at least half the pages) and page numbers."""
    pages = [[ln for ln in page if ln.strip()] for page in pages]
    firsts = Counter(page[0].strip() for page in pages if page)
    threshold = max(3, len(pages) // 2)
    headers = {line for line, n in firsts.items() if n >= threshold}

    cleaned = []
    for page in pages:
        page = list(page)
        if page and page[0].strip() in headers:
            page = page[1:]
        if page and PAGE_NUMBER.match(page[-1].strip()):
            page = page[:-1]
        cleaned.append(page)
    return cleaned


def _roman_heading(line: str, state: _State) -> bool:
    m = ROMAN_HEADING.match(line)
    if not m:
        return False
    if m["num"] not in ROMANS:
        return False
    index = ROMANS.index(m["num"])
    # Sections must come in order; only the first one may start anywhere (an excerpt, a skipped "I").
    if state.roman_index >= 0 and index != state.roman_index + 1:
        return False
    state.part, state.heading = m["num"], m["title"].strip()
    state.roman_index, state.levels = index, []
    return True


def _named_part(line: str, state: _State, first_on_page: bool) -> bool:
    name = None
    if m := NAMED_PART.match(line):
        name = f"{m['kind'].title()} {m['id']}"
    elif SCHEDULE.match(line):
        name = "Schedule"
    elif first_on_page and _is_title(line) and not ITEM.match(line):
        name = next((alias for pattern, alias in FORM_ALIASES if pattern.search(line)), line.title())
    if name is None:
        return False
    state.part, state.heading, state.levels = name, line, []
    return True


def _is_title(line: str) -> bool:
    letters = [c for c in line if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters) and len(line.split()) <= 8


def _item(line: str, state: _State) -> bool:
    """Accept a list marker only if it continues a list or starts one; update the nesting."""
    m = ITEM.match(line)
    if not m:
        return False
    kind = next(k for k in ("upper", "num", "lower") if m[k])
    label = m[kind]
    value = int(label) if kind == "num" else ord(label.lower()) - ord("a") + 1
    has_dot = bool(m["dot"])
    if kind != "upper" and not has_dot:
        return False

    # Next item of an open list, deepest list first.
    for depth in range(len(state.levels) - 1, -1, -1):
        level = state.levels[depth]
        if level.kind == kind and value == level.value + 1:
            state.levels[depth:] = [_Level(kind, value, label)]
            return True

    # A new list starts at A / 1 / a, and needs its period.
    if value == 1 and has_dot:
        if state.levels and state.levels[-1].kind == kind:
            state.levels[-1] = _Level(kind, value, label)   # a fresh list at the same depth
        else:
            state.levels.append(_Level(kind, value, label))
        return True
    return False


def _finish(current: dict) -> Block:
    return Block(ref=current["ref"], heading=current["heading"], text="\n".join(current["lines"]),
                 page=current["page"], page_end=current["page_end"])
