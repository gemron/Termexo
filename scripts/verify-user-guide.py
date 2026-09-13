"""Check HTML/PDF content parity, bookmarks, fonts and page bounds; optionally render.

Requires reportlab, pypdf and pymupdf. Images still need human visual review.
"""

import argparse
import re
import runpy
from pathlib import Path

import pymupdf
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
# The page count each guide is expected to come to. Pinned rather than bounded so that a layout
# that silently reflows is caught; update it deliberately when the guide's content changes.
EXPECTED_PAGES = {"zh": 7, "en": 8}
builder = runpy.run_path(str(ROOT / "scripts" / "build-user-guide.py"))
Element, GuideParser = builder["Element"], builder["GuideParser"]


# The two lines of running footer each page carries. They fall between the halves of any
# paragraph that spans a page break, where comparing the text straight through reads the footer
# as part of the paragraph and reports a corrupted block. Dropped by line rather than by pattern
# over the joined text, where a page number runs into whatever the next page opens with.
FOOTER_LINE = re.compile(r"^(?:Termexo .*\| V[\d.]+|www\.termexo\.com\s*/\s*\d+)$")


def page_body(page):
    """One page's text with the running footer removed."""
    lines = page.extract_text().splitlines()
    return "\n".join(line for line in lines if not FOOTER_LINE.match(line.strip()))


def normalize(text):
    return re.sub(r"\s+", "", text)


def plain(node):
    return node if isinstance(node, str) else "".join(plain(child) for child in node.children)


def blocks(node):
    if isinstance(node, str) or "data-pdf-skip" in node.attrs:
        return
    if node.tag in {"h1", "h2", "h3", "p", "li", "pre", "figcaption"}:
        yield plain(node)
    else:
        for child in node.children:
            yield from blocks(child)


def verify(render_dir, language="zh"):
    source = "guide.en.html" if language == "en" else "guide.html"
    filename = "termexo-user-guide-en.pdf" if language == "en" else "termexo-user-guide.pdf"
    parser = GuideParser()
    parser.feed((ROOT / "website" / source).read_text(encoding="utf-8"))
    article = next(node for node in builder["walk"](parser.root) if node.attrs.get("id") == "guide-content")
    reader = PdfReader(ROOT / "website" / "downloads" / filename)
    text = normalize("".join(page_body(page) for page in reader.pages))
    expected = list(blocks(article))
    for index, block in enumerate(expected):
        assert normalize(block) in text, f"HTML block {index} is missing or corrupted in PDF"
    assert len(reader.outline) == 8, "Each chapter needs a PDF bookmark"
    document = pymupdf.open(ROOT / "website" / "downloads" / filename)
    assert len(document) == EXPECTED_PAGES[language], (
        "Check unexpected pagination before publishing"
    )
    if render_dir:
        render_dir.mkdir(parents=True, exist_ok=True)
    for index, page in enumerate(document, 1):
        assert len(page.get_text().strip()) > 100, f"Page {index} is nearly empty"
        for font in page.get_fonts():
            # ReportLab may declare unused Helvetica; the actual Guide fonts must be embedded.
            if font[3].startswith("AAAAAA+"):
                assert document.extract_font(font[0])[3], f"Page {index} uses a non-embedded subset"
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    x0, y0, x1, y1 = span["bbox"]
                    assert x0 >= 25 and y0 >= 20 and x1 <= page.rect.width - 25 and y1 <= page.rect.height - 15, f"Text outside page margins on page {index}"
        if render_dir:
            page.get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(str(render_dir / f"page-{index:02d}.png"))
    print(f"Verified {len(expected)} HTML text blocks, 8 bookmarks, {len(document)} PDF pages and page margins.")


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--render-dir", type=Path)
    args.add_argument("--language", choices=["zh", "en"], default="zh")
    options = args.parse_args()
    verify(options.render_dir, options.language)
