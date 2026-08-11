"""
PDF text extraction — block-level text plus per-span formatting metadata
(font, size, color, bold/italic, rotation).

Upgrade over the original text_extractor.py: the old version only kept
min/max font size per block, which is enough for Change/Deletion/
Insertion/Location but not enough for the formatting checkers (Bold,
Color, Font Type, Size, Underline) — those need per-span data, not a
block-level summary. This version keeps block-level text/bbox for the
existing matcher/checkers (Change, Deletion, Insertion, Location)
unchanged, and adds a `spans` list + `rotation` + `has_real_position`
per block for everything built after it.

`has_real_position = True` always, for PDF — this flag exists so
matcher.py can fall back to text-only scoring when comparing against a
future non-PDF extractor whose blocks don't have real page coordinates
(see project structure doc, matcher.py notes).
"""

import sys
import os
import math
import pandas as pd

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from src.components.pdf_loader import load_pdf
from src.exception import ExtractionError
from src.logger import logger

# PyMuPDF span "flags" bitmask (font descriptor flags copied from the PDF).
# Not always reliable on their own (some producers set these inconsistently),
# so bold/italic detection below ALSO checks the font name as a fallback.
FLAG_SUPERSCRIPT = 1
FLAG_ITALIC = 2
FLAG_SERIFED = 4
FLAG_MONOSPACED = 8
FLAG_BOLD = 16

LINE_COLUMNS = ["page", "text", "bbox", "min_size", "max_size", "rotation", "has_real_position", "spans"]
WORD_COLUMNS = ["page", "text", "bbox", "block_no", "line_no", "word_no", "has_real_position"]


def _rotation_from_dir(dir_vector) -> float:
    """
    Converts a line's writing-direction vector (e.g. (1,0) = normal,
    (0,-1) = rotated 90°) into a rotation angle in degrees. Used so the
    report renderer can draw highlight boxes correctly oriented on
    multi-panel/folded artwork with sideways text.
    """
    dx, dy = dir_vector
    return round(math.degrees(math.atan2(dy, dx)), 1)


def _is_bold(flags: int, font_name: str) -> bool:
    return bool(flags & FLAG_BOLD) or "bold" in font_name.lower()


def _is_italic(flags: int, font_name: str) -> bool:
    return bool(flags & FLAG_ITALIC) or "italic" in font_name.lower() or "oblique" in font_name.lower()


def _color_int_to_rgb(color_int: int) -> tuple:
    """PyMuPDF packs span color as a single sRGB int — unpack to (r, g, b) 0-255."""
    r = (color_int >> 16) & 255
    g = (color_int >> 8) & 255
    b = color_int & 255
    return (r, g, b)


def extract_words(pdf_path: str) -> pd.DataFrame:
    """
    Extracts WORD-level text using PyMuPDF's native word extraction —
    one row per word, with reading-order indices (block_no, line_no,
    word_no) needed to detect which diffs are adjacent and should be
    merged into one finding.

    Why word-level exists alongside extract_lines(): line-level matching
    breaks when Master and Sample wrap the same content across a
    different number of lines (e.g. a redesign makes text too long to
    fit on one line) — an unchanged word like "56" ends up orphaned as
    a false Insertion purely because of how the line happened to wrap.
    Word-level matching + adjacency merging (see checkers/word_content.py)
    fixes this the way GVW's real product does.

    Only used for content checks (Change/Insertion/Deletion) — Bold/
    Color/Location stay on extract_lines(), since line-level already
    works correctly for those and per-word span metadata isn't needed
    for them.

    Returns: page, text, bbox, block_no, line_no, word_no, has_real_position
    """
    try:
        doc = load_pdf(pdf_path)
        rows = []

        for page_number, page in enumerate(doc):
            has_live_text = len(page.get_text("text").strip()) > 0

            if not has_live_text:
                logger.info(f"Page {page_number} of {pdf_path} has no live text — using OCR fallback")
                try:
                    from src.components.extractors.ocr_fallback import ocr_page
                    ocr_df = ocr_page(page, page_number)
                    for i, r in ocr_df.iterrows():
                        rows.append({
                            "page": page_number, "text": r["text"], "bbox": r["bbox"],
                            "block_no": 0, "line_no": 0, "word_no": i,
                            "has_real_position": True,
                        })
                except Exception as ocr_err:
                    logger.info(f"OCR fallback failed for page {page_number}: {ocr_err}")
                continue

            words = page.get_text("words")  # (x0,y0,x1,y1,text,block_no,line_no,word_no)
            for x0, y0, x1, y1, text, block_no, line_no, word_no in words:
                rows.append({
                    "page": page_number,
                    "text": text,
                    "bbox": (x0, y0, x1, y1),
                    "block_no": block_no,
                    "line_no": line_no,
                    "word_no": word_no,
                    "has_real_position": True,
                })

        df = pd.DataFrame(rows, columns=WORD_COLUMNS)
        logger.info(f"Extracted {len(df)} words from {pdf_path}")
        return df

    except Exception as e:
        raise ExtractionError(f"Failed to extract words from {pdf_path}: {str(e)}", sys)


def extract_lines(pdf_path: str) -> pd.DataFrame:
    """
    Extracts LINE-level text from a PDF — one row per line within a
    PyMuPDF text block, not one row per block. This matches GVW's actual
    comparison granularity: PyMuPDF's block grouping merges multiple
    visually-separate lines (e.g. three separate color-swatch labels,
    "P. 306 C" / "P. 7686 C" / "P. 2755 C") into one block, which then
    gets reported as one confusing blob Change instead of three clean
    ones. Line-level extraction avoids that, and also fixes the earlier
    table-matching scrambling — over-merged blocks were part of why
    position+text matching produced wrong pairings on reflowed tables.

    For pages with ZERO live text (outlined/vector text — confirmed real
    case: Test4), falls back to OCR (Tesseract) automatically. OCR
    results are treated as single-word "lines" — coarser than true
    lines, but this is a rare fallback path, not the common case.

    Returns the same schema as extract_blocks(): page, text, bbox,
    min_size, max_size, rotation, has_real_position, spans.
    Always has these columns, even when empty — callers (matcher.py)
    depend on df["page"] existing regardless of row count.
    """
    try:
        doc = load_pdf(pdf_path)
        rows = []

        for page_number, page in enumerate(doc):
            has_live_text = len(page.get_text("text").strip()) > 0

            if not has_live_text:
                logger.info(f"Page {page_number} of {pdf_path} has no live text — using OCR fallback")
                try:
                    from src.components.extractors.ocr_fallback import ocr_page
                    ocr_df = ocr_page(page, page_number)
                    for _, r in ocr_df.iterrows():
                        rows.append({
                            "page": page_number, "text": r["text"], "bbox": r["bbox"],
                            "min_size": None, "max_size": None, "rotation": 0.0,
                            "has_real_position": True, "spans": [],
                        })
                except Exception as ocr_err:
                    logger.info(f"OCR fallback failed for page {page_number}: {ocr_err}")
                continue

            page_dict = page.get_text("dict")

            for block in page_dict["blocks"]:
                if "lines" not in block:
                    continue  # skip image/vector-only blocks

                for line in block["lines"]:
                    line_text = ""
                    sizes = []
                    spans_meta = []
                    rotation = _rotation_from_dir(line.get("dir", (1.0, 0.0)))

                    for span in line["spans"]:
                        line_text += span["text"]
                        sizes.append(span["size"])

                        font_name = span["font"]
                        spans_meta.append({
                            "text": span["text"],
                            "font": font_name,
                            "size": span["size"],
                            "bold": _is_bold(span["flags"], font_name),
                            "italic": _is_italic(span["flags"], font_name),
                            "color": _color_int_to_rgb(span["color"]),
                            "bbox": span["bbox"],
                        })

                    line_text = line_text.strip()

                    if line_text and sizes:
                        rows.append({
                            "page": page_number,
                            "text": line_text,
                            "bbox": line["bbox"],
                            "min_size": min(sizes),
                            "max_size": max(sizes),
                            "rotation": rotation,
                            "has_real_position": True,
                            "spans": spans_meta,
                        })

        df = pd.DataFrame(rows, columns=LINE_COLUMNS)
        logger.info(f"Extracted {len(df)} text lines from {pdf_path}")
        return df

    except Exception as e:
        raise ExtractionError(f"Failed to extract lines from {pdf_path}: {str(e)}", sys)


def extract_blocks(pdf_path: str) -> pd.DataFrame:
    """
    Extracts block-level text from a PDF, along with position, font-size
    range, rotation, and full per-span formatting metadata.

    Returns a DataFrame with columns:
        page, text, bbox, min_size, max_size, rotation, has_real_position, spans

    `spans` is a list of dicts, one per text span in the block:
        text, font, size, bold, italic, color (r,g,b), bbox
    """
    try:
        doc = load_pdf(pdf_path)
        rows = []

        for page_number, page in enumerate(doc):
            page_dict = page.get_text("dict")

            for block in page_dict["blocks"]:
                if "lines" not in block:
                    continue  # skip image/vector-only blocks

                block_text = ""
                sizes = []
                spans_meta = []
                rotation = None

                for line in block["lines"]:
                    if rotation is None:
                        rotation = _rotation_from_dir(line.get("dir", (1.0, 0.0)))

                    for span in line["spans"]:
                        block_text += span["text"]
                        sizes.append(span["size"])

                        font_name = span["font"]
                        spans_meta.append({
                            "text": span["text"],
                            "font": font_name,
                            "size": span["size"],
                            "bold": _is_bold(span["flags"], font_name),
                            "italic": _is_italic(span["flags"], font_name),
                            "color": _color_int_to_rgb(span["color"]),
                            "bbox": span["bbox"],
                        })
                    block_text += " "

                block_text = block_text.strip()

                if block_text and sizes:
                    rows.append({
                        "page": page_number,
                        "text": block_text,
                        "bbox": block["bbox"],
                        "min_size": min(sizes),
                        "max_size": max(sizes),
                        "rotation": rotation,
                        "has_real_position": True,
                        "spans": spans_meta,
                    })

        df = pd.DataFrame(rows)
        logger.info(f"Extracted {len(df)} text blocks from {pdf_path}")
        return df

    except Exception as e:
        raise ExtractionError(f"Failed to extract blocks from {pdf_path}: {str(e)}", sys)