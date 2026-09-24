"""
PDF text extraction — block-level text plus per-span formatting metadata
(font, size, color, bold/italic, rotation, underline).

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


def _expand_bbox(bbox, margin=1.5):
    """
    Expand a bounding box slightly.
    """
    if not bbox or len(bbox) != 4:
        return None
    x0, y0, x1, y1 = bbox
    return (
        float(x0) - margin,
        float(y0) - margin,
        float(x1) + margin,
        float(y1) + margin,
    )


def _drawing_is_line_like(drawing) -> bool:
    """
    Determine whether a PyMuPDF drawing looks like a line or
    very thin rectangle.

    These are the common drawing representations of PDF underlines.
    """
    bbox = drawing.get("rect")
    if bbox is None:
        bbox = drawing.get("bbox")
    if bbox is None:
        return False

    try:
        x0 = float(bbox.x0)
        y0 = float(bbox.y0)
        x1 = float(bbox.x1)
        y1 = float(bbox.y1)
    except Exception:
        try:
            x0, y0, x1, y1 = bbox
        except Exception:
            return False

    width = abs(x1 - x0)
    height = abs(y1 - y0)

    # Horizontal line.
    if width >= 2.0 and height <= 3.0:
        return True

    # Very thin rectangle.
    if width >= 2.0 and height <= 4.0:
        return True

    return False


def _drawing_bbox(drawing):
    """
    Safely obtain a drawing's bbox.
    """
    rect = drawing.get("rect")
    if rect is not None:
        return (
            float(rect.x0),
            float(rect.y0),
            float(rect.x1),
            float(rect.y1),
        )

    bbox = drawing.get("bbox")
    if bbox is not None:
        return (
            float(bbox[0]),
            float(bbox[1]),
            float(bbox[2]),
            float(bbox[3]),
        )

    return None


def _line_near_text(drawing_bbox, text_bbox) -> bool:
    """
    Determine whether a drawing is plausibly an underline for a
    particular text span.
    """
    if not drawing_bbox or not text_bbox:
        return False

    dx0, dy0, dx1, dy1 = drawing_bbox
    tx0, ty0, tx1, ty1 = text_bbox

    text_height = max(1.0, ty1 - ty0)
    text_width = max(1.0, tx1 - tx0)

    # ------------------------------------------------------------
    # Horizontal overlap
    # ------------------------------------------------------------
    overlap_x = max(0.0, min(dx1, tx1) - max(dx0, tx0))
    if overlap_x <= 0:
        return False

    overlap_ratio = overlap_x / text_width
    if overlap_ratio < 0.35:
        return False

    # ------------------------------------------------------------
    # Underline should be near the bottom of text.
    # ------------------------------------------------------------
    line_y = (dy0 + dy1) / 2.0
    distance_from_bottom = abs(line_y - ty1)
    tolerance = max(2.5, text_height * 0.35)
    if distance_from_bottom > tolerance:
        return False

    # ------------------------------------------------------------
    # Underline should be thin.
    # ------------------------------------------------------------
    drawing_height = abs(dy1 - dy0)
    if drawing_height > max(4.0, text_height * 0.30):
        return False

    # ------------------------------------------------------------
    # Don't associate a much wider page/table separator with text.
    # ------------------------------------------------------------
    if dx0 < tx0 - text_height or dx1 > tx1 + text_height:
        return False

    return True


# Underline look-up uses a coarse y-axis spatial index. Underlines sit just
# below a span's baseline, so instead of testing EVERY line-like drawing
# against every span (O(spans x drawings) — artboards with summary tables and
# keyline boxes have hundreds of thin rects/separators), drawings are bucketed
# by their vertical midpoint and each span only checks buckets near its
# baseline. BUCKET tighter than the tolerance window => no missed matches.
_UNDERLINE_BUCKET_SIZE = 6.0


def _extract_page_drawings(page):
    """
    Extract drawing objects for one PDF page into a y-bucketed spatial index.

    Only line-like objects are retained because arbitrary artwork contains
    many unrelated vector drawings. Returns {bucket_id: [drawing, ...]} where
    bucket_id indexes the drawing's vertical midpoint in coarse bands.
    """
    bucket_index = {}

    try:
        page_drawings = page.get_drawings()
    except Exception:
        page_drawings = []

    for drawing in page_drawings:
        if not _drawing_is_line_like(drawing):
            continue

        bbox = _drawing_bbox(drawing)
        if bbox is None:
            continue

        mid_y = (bbox[1] + bbox[3]) / 2.0
        bucket = int(math.floor(mid_y / _UNDERLINE_BUCKET_SIZE))

        bucket_index.setdefault(bucket, []).append({
            "bbox": bbox,
            "type": drawing.get("type"),
            "width": drawing.get("width"),
            "items": drawing.get("items", []),
        })

    return bucket_index


def _span_is_underlined(span_bbox, drawings_index) -> bool:
    """
    Determine whether a span has a nearby underline drawing.

    Uses the y-bucketed drawing index so only drawings whose vertical band
    sits within the underline tolerance of the span's baseline are tested,
    instead of scanning every line-like drawing on the page per span.
    """
    if not span_bbox:
        return False

    expanded_bbox = _expand_bbox(span_bbox, margin=1.5)
    if not expanded_bbox:
        return False

    _, ty0, _, ty1 = expanded_bbox
    text_height = max(1.0, ty1 - ty0)

    # _line_near_text allows the drawing's midline to be up to
    # max(2.5, text_height*0.35) from the baseline, and the drawing is thin.
    # Search a radius around the baseline generous enough to cover any
    # candidate whose bucket straddles that window.
    search_radius = max(6.0, text_height * 0.35 + 6.0)
    lo_bucket = int(math.floor((ty1 - search_radius) / _UNDERLINE_BUCKET_SIZE))
    hi_bucket = int(math.floor((ty1 + search_radius) / _UNDERLINE_BUCKET_SIZE))

    for bucket in range(lo_bucket, hi_bucket + 1):
        for drawing in drawings_index.get(bucket, ()):
            drawing_bbox = drawing.get("bbox")
            if _line_near_text(drawing_bbox, expanded_bbox):
                return True

    return False


def _build_span_metadata(span, page_drawings):
    """
    Build the complete formatting metadata for one PyMuPDF span.
    """
    font_name = span.get("font", "")
    text = span.get("text", "")
    bbox = span.get("bbox")
    flags = span.get("flags", 0)
    color = span.get("color", 0)

    return {
        "text": text,
        "font": font_name,
        "size": span.get("size"),
        "bold": _is_bold(flags, font_name),
        "italic": _is_italic(flags, font_name),
        "color": _color_int_to_rgb(color),
        "underline": _span_is_underlined(bbox, page_drawings),
        "bbox": bbox,
    }


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

            page_drawings = _extract_page_drawings(page)
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
                        if span.get("size") is not None:
                            sizes.append(span["size"])

                        spans_meta.append(_build_span_metadata(span, page_drawings))

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
            page_drawings = _extract_page_drawings(page)
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
                        if span.get("size") is not None:
                            sizes.append(span["size"])

                        spans_meta.append(_build_span_metadata(span, page_drawings))
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