"""Build the fictional demo RFPs in data/mock_rfps/ from their plain-text sources.

    python -m eval.build_mock_rfps

The buyers are invented, so these PDFs (unlike data/test_rfps/) hold no real contact details
and are committed. Each source is written in the layout the parser reads well: Roman-numeral
headings in capitals, then A. / 1. / a. items, exhibits as "EXHIBIT A - TITLE".

Source format, one file per RFP (<name>.txt -> <name>.pdf):
    % Line          cover title line (large, centred)
    ===PAGE===      page break
    I. HEADING      section heading (also EXHIBIT A - TITLE)
    blank line      ends a paragraph; other lines join into the current paragraph
"""
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

MOCK_RFPS = Path(__file__).resolve().parent.parent / "data" / "mock_rfps"

HEADING = re.compile(r"^([IVX]+\.\s+[A-Z][A-Z0-9 &,/'()\-]*|EXHIBIT [A-Z]\b.*)$")
INDENTS = [(re.compile(r"^[A-Z]\.\s"), 0.25), (re.compile(r"^\d{1,2}\.\s"), 0.5), (re.compile(r"^[a-z]\.\s"), 0.75)]

_base = getSampleStyleSheet()
STYLES = {
    "cover": ParagraphStyle("cover", parent=_base["Title"], fontSize=20, leading=26, alignment=TA_CENTER, spaceAfter=6),
    "heading": ParagraphStyle("heading", parent=_base["Heading2"], fontSize=13, spaceBefore=14, spaceAfter=6),
    "body": ParagraphStyle("body", parent=_base["BodyText"], fontSize=10.5, leading=14, spaceAfter=6),
    "note": ParagraphStyle("note", parent=_base["Italic"], fontSize=9, leading=12, alignment=TA_CENTER, spaceBefore=18),
}


def flowables(source: str) -> list:
    story, paragraph = [], []

    def flush() -> None:
        if not paragraph:
            return
        text = " ".join(paragraph)
        indent = next((inches for pattern, inches in INDENTS if pattern.match(text)), 0)
        style = STYLES["note"] if text.startswith("Fictional") else STYLES["body"]
        story.append(Paragraph(escape(text), ParagraphStyle(f"p{indent}", parent=style, leftIndent=indent * inch)))
        paragraph.clear()

    for raw in source.splitlines():
        line = raw.strip()
        if line == "===PAGE===":
            flush()
            story.append(PageBreak())
        elif line.startswith("% "):
            flush()
            story.append(Paragraph(escape(line[2:]), STYLES["cover"]))
        elif HEADING.match(line):
            flush()
            story.append(Paragraph(f"<b>{escape(line)}</b>", STYLES["heading"]))
        elif not line:
            flush()
        else:
            paragraph.append(line)
    flush()
    return story


def page_number(canvas, doc) -> None:
    """Only a bare number at the foot of each page, which the parser drops."""
    canvas.saveState()
    canvas.setFont("Helvetica", 9)
    canvas.drawCentredString(LETTER[0] / 2, 0.5 * inch, str(doc.page))
    canvas.restoreState()


def build(source: Path) -> Path:
    target = source.with_suffix(".pdf")
    doc = SimpleDocTemplate(str(target), pagesize=LETTER, title=source.stem, author="Fictional demo RFP",
                            leftMargin=inch, rightMargin=inch, topMargin=0.9 * inch, bottomMargin=0.9 * inch)
    story = flowables(source.read_text(encoding="utf-8"))
    doc.build([Spacer(1, 0.4 * inch), *story], onFirstPage=page_number, onLaterPages=page_number)
    return target


def main() -> None:
    for source in sorted(MOCK_RFPS.glob("*.txt")):
        print(f"{build(source).relative_to(MOCK_RFPS.parent.parent)}")


if __name__ == "__main__":
    main()
