"""Split document text into blocks, each with a section reference.

Format-independent: takes lines grouped by page, so the PDF, DOCX and XLSX
parsers can share it. It recognises:

- Roman section headings in capitals, in order: "IV. SCOPE OF WORK:" -> IV
- Numbered headings: "SECTION 2 - NOTICE TO PROPOSER" -> Section 2
- Named parts: "EXHIBIT B", "APPENDIX ONE - ...", or a short all-caps title at
  the top of a page ("AFFIDAVIT") -> Exhibit B, Appendix One, Affidavit
- Decimal numbering: "2.1", "11.2.1.4" -> Section 2.1, Appendix Two.11.2.1.4
- Lettered and numbered items nested under the current part:
  "A." -> IV.A, then "1." -> IV.A.1

Markers are only accepted when they continue or start a list, which is how
"V. How long have you been in business?" (item V under VIII) is told apart
from "V. DELIVERABLES:" (section V). Table-of-contents lines never count.

Two fallbacks keep the output usable on documents it does not understand:
text before any heading is referenced by page ("p.3"), and no block is longer
than MAX_BLOCK_CHARS; longer ones are split at line breaks.
"""
import re
from collections import Counter
from dataclasses import dataclass, field

MAX_BLOCK_CHARS = 6000

ROMANS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
          "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"]
WORD_NUMBERS = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
                "ELEVEN", "TWELVE"]

ROMAN_HEADING = re.compile(r"^(?P<num>[IVX]+)\.\s+(?P<title>[A-Z][A-Z0-9 &,/'’()\-–]*?):?\s*$")
NUMBERED_HEADING = re.compile(r"^(?P<kind>SECTION|ARTICLE|PART)\s+(?P<num>\d{1,2}|[IVX]+)\b\s*[-–:.]?\s*")
NAMED_PART = re.compile(
    rf"^(?P<kind>EXHIBIT|APPENDIX|ATTACHMENT)\s+(?P<id>{'|'.join(WORD_NUMBERS)}|[A-Z0-9]{{1,3}})"
    r"(?=\s*$|\s*[-–:]|\s+[A-Z][a-z])")
SCHEDULE = re.compile(r"^(RFP|PROPOSAL|SOLICITATION)\s+SCHEDULE$", re.IGNORECASE)
TOC_LINE = re.compile(r"(\.\s*){4,}\s*\d*\s*$|…{2,}")
DECIMAL = re.compile(r"^(?P<num>\d{1,2}(?:\.\d{1,2})+)\.?\s+\S")
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
    ref: str            # "IV.A.1", "Section 2.1", "Exhibit B.6", "p.3"
    heading: str        # title of the top-level part, e.g. "SCOPE OF WORK"
    text: str           # the block's own text, marker included
    page: int           # first page, 1-based
    page_end: int
    continued: bool = False   # a later piece of a block split for length


@dataclass(frozen=True)
class ParsedDocument:
    source_file: str
    page_count: int
    blocks: list[Block]

    def find(self, ref: str) -> list[Block]:
        return [b for b in self.blocks if b.ref == ref and not b.continued]

    def refs(self) -> set[str]:
        return {b.ref for b in self.blocks}


@dataclass
class _Level:
    kind: str           # "upper", "num", "lower" or "dec"
    value: int          # 1 for A / 1 / a; unused for "dec"
    label: str          # "A", "1", "a", "2.1"


@dataclass
class _State:
    part: str | None = None         # None until the first heading
    subpart: str | None = None      # "Section 2" inside an appendix
    section_num: str | None = None  # "2" when the current part or subpart is SECTION 2
    heading: str = ""
    roman_index: int = -1
    levels: list[_Level] = field(default_factory=list)
    last_decimal: tuple[int, ...] | None = None

    def enter(self, part: str | None, heading: str, *, subpart: str | None = None,
              section_num: str | None = None) -> None:
        if part is not None:
            self.part = part
        self.subpart, self.section_num, self.heading = subpart, section_num, heading
        self.levels, self.last_decimal = [], None

    def ref(self, page: int) -> str:
        if self.part is None:
            return "Cover" if page == 1 else f"p.{page}"
        labels = [lvl.label for lvl in self.levels]
        if labels and self.levels[0].kind == "dec":
            # Decimal numbers are complete on their own: "Section 2.1", not "Section 2.2.1".
            base = "Section" if self.subpart is None and self.section_num else self.part
            return ".".join([f"{base} {labels[0]}" if base == "Section" else f"{base}.{labels[0]}",
                             *labels[1:]])
        return ".".join([self.part, *([self.subpart] if self.subpart else []), *labels])


def split_sections(pages: list[list[str]], source_file: str) -> ParsedDocument:
    pages = strip_running_lines(pages)
    contents = _contents_lines(pages)
    blocks: list[Block] = []
    state = _State()
    current: dict | None = None

    def start(page: int, line: str) -> None:
        nonlocal current
        if current:
            blocks.extend(_finish(current))
        current = {"ref": state.ref(page), "heading": state.heading, "lines": [(page, line)]}

    for page_no, lines in enumerate(pages, start=1):
        for i, raw in enumerate(lines):
            line = raw.strip()
            if not line:
                continue
            if TOC_LINE.search(line) or (page_no, i) in contents:
                is_marker = False
            else:
                is_marker = (_roman_heading(line, state)
                             or _numbered_heading(line, state)
                             or _named_part(line, state, first_on_page=(i == 0))
                             or _decimal(line, state)
                             or _item(line, state))
            if is_marker or current is None:
                start(page_no, line)
            elif state.part is None and page_no != current["lines"][-1][0]:
                start(page_no, line)          # no structure yet: one block per page
            else:
                current["lines"].append((page_no, line))

    if current:
        blocks.extend(_finish(current))
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


def _contents_lines(pages: list[list[str]]) -> set[tuple[int, int]]:
    """(page, line index) of contents-list entries: 3+ part headings in a row with no text between."""
    found: set[tuple[int, int]] = set()
    for page_no, lines in enumerate(pages, start=1):
        run: list[int] = []
        for i, raw in enumerate([*lines, ""]):
            line = raw.strip()
            if line and not TOC_LINE.search(line) and (NAMED_PART.match(line) or NUMBERED_HEADING.match(line)):
                run.append(i)
                continue
            if len(run) >= 3:
                found.update((page_no, j) for j in run)
            run = []
    return found


def _roman_heading(line: str, state: _State) -> bool:
    m = ROMAN_HEADING.match(line)
    if not m or m["num"] not in ROMANS:
        return False
    index = ROMANS.index(m["num"])
    # Sections must come in order; only the first one may start anywhere (an excerpt, a skipped "I").
    if state.roman_index >= 0 and index != state.roman_index + 1:
        return False
    state.enter(m["num"], m["title"].strip())
    state.roman_index = index
    return True


def _numbered_heading(line: str, state: _State) -> bool:
    m = NUMBERED_HEADING.match(line)
    if not m:
        return False
    name = f"{m['kind'].title()} {m['num']}"
    num = m["num"] if m["kind"] == "SECTION" else None
    if state.part and state.part.split()[0] in ("Appendix", "Exhibit", "Attachment"):
        state.enter(None, line, subpart=name, section_num=num)      # a section inside an appendix
    else:
        state.enter(name, line, section_num=num)
    return True


def _named_part(line: str, state: _State, first_on_page: bool) -> bool:
    name = None
    if m := NAMED_PART.match(line):
        name = f"{m['kind'].title()} {m['id'].title()}"
    elif SCHEDULE.match(line):
        name = "Schedule"
    elif first_on_page and _is_title(line) and not ITEM.match(line):
        name = next((alias for pattern, alias in FORM_ALIASES if pattern.search(line)), line.title())
    if name is None:
        return False
    state.enter(name, line)
    return True


def _is_title(line: str) -> bool:
    letters = [c for c in line if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters) and len(line.split()) <= 8


def _decimal(line: str, state: _State) -> bool:
    """Accept "2.1"-style numbers that follow on from the previous one in this part."""
    m = DECIMAL.match(line)
    if not m:
        return False
    num = tuple(int(x) for x in m["num"].split("."))
    if state.last_decimal is not None and not _follows(state.last_decimal, num):
        return False
    state.last_decimal = num
    state.levels = [_Level("dec", 0, m["num"])]
    return True


def _follows(last: tuple[int, ...], new: tuple[int, ...]) -> bool:
    """True if `new` can come after `last`: same, first child, or a later sibling at some depth."""
    if new == last or new == last + (1,):
        return True
    for depth in range(len(last)):
        bumped = last[:depth] + (last[depth] + 1,)
        rest = new[len(bumped):]
        if new[:len(bumped)] == bumped and all(x == 1 for x in rest):
            return True
    return False


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

    # Once a part uses decimal numbering ("11.5"), "12. Miscellaneous." is the decimal 12.
    if kind == "num" and state.last_decimal is not None:
        if _follows(state.last_decimal, (value,)):
            state.last_decimal = (value,)
            state.levels = [_Level("dec", 0, label)]
            return True
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


def _finish(current: dict) -> list[Block]:
    """Turn collected lines into one block, or several if it is too long."""
    lines: list[tuple[int, str]] = current["lines"]
    chunks: list[list[tuple[int, str]]] = [[]]
    size = 0
    for page, line in lines:
        if size + len(line) > MAX_BLOCK_CHARS and chunks[-1]:
            chunks.append([])
            size = 0
        chunks[-1].append((page, line))
        size += len(line) + 1

    ref = current["ref"]
    page_based = ref == "Cover" or ref.startswith("p.")
    return [
        Block(ref=f"p.{chunk[0][0]}" if page_based and n else ref,
              heading=current["heading"],
              text="\n".join(line for _, line in chunk),
              page=chunk[0][0], page_end=chunk[-1][0], continued=n > 0)
        for n, chunk in enumerate(chunks)
    ]
