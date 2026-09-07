"""Build the downloadable PDF from website/guide.html (the only content source).

Requires reportlab. On Windows, Microsoft YaHei is used and subset-embedded.
Override fonts with --font / --bold-font when building on another platform.
"""

import argparse
from dataclasses import dataclass, field
from html import escape
from html.parser import HTMLParser
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "website"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


@dataclass
class Element:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)


class GuideParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Element(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.stack[-1].tag != tag:
            raise ValueError(f"Unbalanced HTML: closing {tag} inside {self.stack[-1].tag}")
        self.stack.pop()

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def walk(node):
    if isinstance(node, Element):
        yield node
        for child in node.children:
            yield from walk(child)


def inline(node):
    if isinstance(node, str):
        return escape(node)
    content = "".join(inline(child) for child in node.children)
    if node.tag == "strong":
        return f"<b>{content}</b>"
    if node.tag == "code":
        return f'<font color="#17684e">{content}</font>'
    if node.tag == "a":
        href = node.attrs.get("href", "")
        if not href.startswith("https://"):
            raise ValueError(f"PDF links must be absolute HTTPS URLs: {href}")
        return f'<link href="{escape(href, quote=True)}" color="#17684e"><u>{content}</u></link>'
    if node.tag == "br":
        return "<br/>"
    return content


def build(output, regular_font, bold_font):
    pdfmetrics.registerFont(TTFont("Guide", str(regular_font)))
    pdfmetrics.registerFont(TTFont("GuideBold", str(bold_font)))
    pdfmetrics.registerFontFamily("Guide", normal="Guide", bold="GuideBold", italic="Guide", boldItalic="GuideBold")
    parser = GuideParser()
    parser.feed((SITE / "guide.html").read_text(encoding="utf-8"))
    parser.close()
    assert len(parser.stack) == 1, "HTML contains unclosed tags"
    article = next(node for node in walk(parser.root) if node.attrs.get("id") == "guide-content")
    base = ParagraphStyle("body", fontName="Guide", fontSize=9.6, leading=16,
                          textColor=colors.HexColor("#273b32"), spaceAfter=8,
                          wordWrap="CJK", alignment=TA_LEFT)
    styles = {
        "body": base,
        "h1": ParagraphStyle("title", parent=base, fontName="GuideBold", fontSize=28, leading=36, spaceAfter=12),
        "h2": ParagraphStyle("section", parent=base, fontName="GuideBold", fontSize=16, leading=24, spaceBefore=12, spaceAfter=12, keepWithNext=True),
        "h3": ParagraphStyle("heading", parent=base, fontName="GuideBold", fontSize=11, leading=18, spaceBefore=10, spaceAfter=6, keepWithNext=True),
        "meta": ParagraphStyle("meta", parent=base, fontSize=8, leading=13, textColor=colors.HexColor("#52685d")),
        "list": ParagraphStyle("list", parent=base, leftIndent=14, firstLineIndent=-14),
        "code": ParagraphStyle("code", parent=base, backColor=colors.HexColor("#f0f5f2"), borderPadding=10, spaceBefore=10, spaceAfter=16),
        "callout": ParagraphStyle("callout", parent=base, backColor=colors.HexColor("#f0f5f2"), borderColor=colors.HexColor("#bfd9cb"), borderWidth=.5, borderPadding=10, spaceBefore=12, spaceAfter=14),
    }
    story = []

    def emit(node, section_id=None):
        if isinstance(node, str) or "data-pdf-skip" in node.attrs:
            return
        if "data-pdf-page" in node.attrs:
            story.append(PageBreak())
        section_id = node.attrs.get("id", section_id)
        if node.tag in {"h1", "h2", "h3", "p", "figcaption", "pre"}:
            css = node.attrs.get("class", "")
            style = node.tag if node.tag in styles else "body"
            if node.tag == "pre":
                style = "code"
            elif css in {"guide-meta", "guide-label"} or node.tag == "figcaption":
                style = "meta"
            elif css == "guide-callout":
                style = "callout"
            paragraph = Paragraph(inline(node), styles[style])
            if node.tag == "h2":
                paragraph.guide_bookmark = section_id
            story.append(paragraph)
        elif node.tag in {"ol", "ul"}:
            items = [child for child in node.children if isinstance(child, Element) and child.tag == "li"]
            for index, item in enumerate(items, 1):
                prefix = f"{index}. " if node.tag == "ol" else "• "
                story.append(Paragraph(prefix + inline(item), styles["list"]))
        elif node.tag == "img":
            path = (SITE / node.attrs["src"]).resolve()
            if not path.is_relative_to(SITE.resolve()):
                raise ValueError("Image must be inside website/")
            image = Image(str(path))
            ratio = min(1, 491 / image.imageWidth, 245 / image.imageHeight)
            image.drawWidth = image.imageWidth * ratio
            image.drawHeight = image.imageHeight * ratio
            image.spaceAfter = 8
            image.hAlign = "LEFT"
            story.append(image)
        else:
            for child in node.children:
                emit(child, section_id)

    emit(article)

    class GuideDocument(SimpleDocTemplate):
        def afterFlowable(self, flowable):
            key = getattr(flowable, "guide_bookmark", None)
            if key:
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(flowable.getPlainText(), key, level=0)

    def page_chrome(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#d5e0d9"))
        canvas.line(46, 40, A4[0] - 46, 40)
        canvas.setFont("Guide", 8)
        canvas.setFillColor(colors.HexColor("#52685d"))
        canvas.drawString(46, 26, "Termexo 使用说明 | V0.8.1")
        canvas.drawRightString(A4[0] - 46, 26, f"www.termexo.com  /  {doc.page}")
        canvas.restoreState()

    output.parent.mkdir(parents=True, exist_ok=True)
    document = GuideDocument(str(output), pagesize=A4, rightMargin=46, leftMargin=46,
                             topMargin=38, bottomMargin=58, title="Termexo 使用说明 V0.8.1",
                             author="Termexo", subject="安装、Agent 会话、模型配置与远程访问")
    document.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
    print(f"Built {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--output", type=Path, default=SITE / "downloads" / "termexo-user-guide.pdf")
    args.add_argument("--font", type=Path, default=Path("C:/Windows/Fonts/msyh.ttc"))
    args.add_argument("--bold-font", type=Path, default=Path("C:/Windows/Fonts/msyhbd.ttc"))
    options = args.parse_args()
    build(options.output, options.font, options.bold_font)
