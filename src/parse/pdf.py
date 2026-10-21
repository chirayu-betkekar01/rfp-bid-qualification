"""Parse a PDF into text blocks with section references and page numbers."""
from pathlib import Path

import pdfplumber

from src.parse.sections import ParsedDocument, split_sections


def parse_pdf(path: Path) -> ParsedDocument:
    with pdfplumber.open(path) as pdf:
        pages = [(page.extract_text() or "").splitlines() for page in pdf.pages]
    return split_sections(pages, source_file=path.name)
