"""
Formatting checkers.

Supported inspections:
    - Font Type
    - Mixed Font
    - Bold
    - Italic
    - Underline
    - Color

These checkers operate on span-level formatting metadata produced
by the PDF extractor.

Master is treated as the source of truth.

Formatting is checked only against Master/Sample text that can be
aligned successfully.
"""

from difflib import SequenceMatcher

# ================================================================
# GENERAL HELPERS
# ================================================================

def _safe_text(value):
    """Convert a value to a safe string."""
    if value is None:
        return ""

    return str(value)

def _normalize_text(text):
    """Normalize whitespace for similarity comparison."""
    return " ".join(
        _safe_text(text).split()
    )

def _text_similarity(master_text, sample_text):
    """Calculate text similarity from 0.0 to 1.0."""

    master_text = _normalize_text(master_text)
    sample_text = _normalize_text(sample_text)

    if not master_text or not sample_text:
        return 0.0

    return SequenceMatcher(
        None,
        master_text.lower(),
        sample_text.lower(),
    ).ratio()

# ================================================================
# RECONSTRUCT TEXT + ATTRIBUTE
# ================================================================

def _reconstruct(spans: list, attr: str):
    """
    Reconstruct complete text from spans and create a
    character-level attribute array.
    """

    text = ""
    attr_per_char = []

    for span in spans:

        span_text = _safe_text(
            span.get("text", "")
        )

        span_attr = span.get(attr)

        text += span_text

        attr_per_char.extend(
            [span_attr] * len(span_text)
        )

    return text, attr_per_char

def _reconstruct_multi(spans: list, attrs: list):
    """
    Reconstruct the full text and per-character attribute arrays for
    SEVERAL span attributes in ONE pass over the spans (instead of calling
    _reconstruct once per attribute).

    Returns (text, {attr_name: [per_char_value, ...]}). Each attr array is
    the same length as `text`.

    NOTE: the text must always be rebuilt from spans even when `attrs` is
    empty (e.g. Mixed Font is enabled on its own, which needs no per-char
    attribute array). A previous version short-circuited to `("", {})`
    whenever `attrs` was empty, which silently produced an empty row text
    for that case and caused every pair to be skipped downstream. Do not
    reintroduce that early-return.
    """
    text = ""
    per_attr = {a: [] for a in attrs}

    for span in spans:
        span_text = _safe_text(span.get("text", ""))
        text += span_text
        n = len(span_text)
        for a in attrs:
            per_attr[a].extend([span.get(a)] * n)

    return text, per_attr

# ================================================================
# FONT PROFILE
# ================================================================

def _font_profile(spans):
    """
    Return unique fonts used by the text element.
    """

    fonts = []

    for span in spans:

        font = span.get("font")

        if not font:
            continue

        if font not in fonts:
            fonts.append(font)

    return fonts
# ================================================================
# FONT TYPE
# ================================================================

def _group_font_details(font_details: list) -> list:
    """
    Group consecutive characters having the same
    Master/Sample font combination.
    """

    if not font_details:
        return []

    grouped = []

    current = None
    previous = None

    for detail in font_details:

        master_font = detail["master_font"]
        sample_font = detail["sample_font"]

        same_combination = (
            current is not None
            and current["master_font"] == master_font
            and current["sample_font"] == sample_font
        )

        consecutive = (
            previous is not None
            and detail["master_index"]
            == previous["master_index"] + 1
            and detail["sample_index"]
            == previous["sample_index"] + 1
        )

        if same_combination and consecutive:

            current["text"] += detail["char"]

        else:

            if current is not None:
                grouped.append(current)

            current = {
                "text": detail["char"],
                "master_font": master_font,
                "sample_font": sample_font,
            }

        previous = detail

    if current is not None:
        grouped.append(current)

    return grouped

def _check_font_type(matched_pairs: list) -> list:
    """
    Compare Font Type between Master and Sample.

    Rules:
        - Master is the reference.
        - Only sufficiently similar text is checked.
        - Unrelated matcher pairs are ignored.
        - Content differences themselves are not reported.
        - Only identical/aligned characters are compared.
        - Consecutive font differences are grouped.
    """

    findings = []

    for pair in matched_pairs:

        m_row = pair["master_row"]
        s_row = pair["sample_row"]

        m_spans = m_row.get("spans", [])
        s_spans = s_row.get("spans", [])

        if not m_spans or not s_spans:
            continue

        m_text, m_fonts = _reconstruct(
            m_spans,
            "font",
        )

        s_text, s_fonts = _reconstruct(
            s_spans,
            "font",
        )

        if not m_text.strip() or not s_text.strip():
            continue

        similarity = _text_similarity(
            m_text,
            s_text,
        )

        if similarity < 0.60:
            continue

        matcher = SequenceMatcher(
            None,
            m_text,
            s_text,
        )

        font_details = []

        for op, i1, i2, j1, j2 in matcher.get_opcodes():

            if op != "equal":
                continue

            length = min(
                i2 - i1,
                j2 - j1,
            )

            for offset in range(length):

                master_index = i1 + offset
                sample_index = j1 + offset

                master_char = m_text[master_index]
                sample_char = s_text[sample_index]

                if master_char != sample_char:
                    continue

                master_font = m_fonts[master_index]
                sample_font = s_fonts[sample_index]

                if master_font == sample_font:
                    continue

                font_details.append({
                    "char": master_char,
                    "master_font": master_font,
                    "sample_font": sample_font,
                    "master_index": master_index,
                    "sample_index": sample_index,
                })

        if not font_details:
            continue

        grouped_details = _group_font_details(
            font_details
        )

        summary_parts = []

        for detail in grouped_details:

            summary_parts.append(
                f'Text "{detail["text"]}" | '
                f'Master Font: "{detail["master_font"]}" | '
                f'Sample Font: "{detail["sample_font"]}"'
            )

        comment = (
            "Font Type Error: "
            + " || ".join(summary_parts)
        )

        findings.append({
            "page": int(m_row["page"]),
            "master": m_row["text"],
            "sample": s_row["text"],
            "master_bbox": m_row["bbox"],
            "sample_bbox": s_row["bbox"],
            "comment": comment,
            "type": "Font Type",
            "detail": font_details,
            "source": "pymupdf",
        })

    return findings

def check_font_type(matched_pairs: list) -> list:
    """
    Public Font Type checker.
    """

    return _check_font_type(
        matched_pairs
    )
# ================================================================
# MIXED FONT
# ================================================================

def _check_mixed_font(matched_pairs: list) -> list:
    """
    Detect differences in the font composition of a text element.
    """

    findings = []

    for pair in matched_pairs:

        m_row = pair["master_row"]
        s_row = pair["sample_row"]

        m_spans = m_row.get("spans", [])
        s_spans = s_row.get("spans", [])

        if not m_spans or not s_spans:
            continue

        m_text = _safe_text(
            m_row.get("text", "")
        )

        s_text = _safe_text(
            s_row.get("text", "")
        )

        if not m_text.strip() or not s_text.strip():
            continue

        similarity = _text_similarity(
            m_text,
            s_text,
        )

        if similarity < 0.60:
            continue

        master_fonts = _font_profile(
            m_spans
        )

        sample_fonts = _font_profile(
            s_spans
        )

        master_mixed = len(master_fonts) > 1
        sample_mixed = len(sample_fonts) > 1

        if not master_mixed and not sample_mixed:
            continue

        if (
            master_fonts == sample_fonts
            and master_mixed == sample_mixed
        ):
            continue

        expected = (
            ", ".join(master_fonts)
            if master_fonts
            else "Unknown"
        )

        actual = (
            ", ".join(sample_fonts)
            if sample_fonts
            else "Unknown"
        )

        findings.append({
            "page": int(m_row["page"]),
            "master": m_row["text"],
            "sample": s_row["text"],
            "master_bbox": m_row["bbox"],
            "sample_bbox": s_row["bbox"],
            "comment": (
                "Mixed Font: "
                f"Master Font(s): {expected} | "
                f"Sample Font(s): {actual}"
            ),
            "type": "Mixed Font",
            "detail": {
                "master_fonts": master_fonts,
                "sample_fonts": sample_fonts,
            },
            "source": "pymupdf",
        })

    return findings

def check_mixed_font(matched_pairs: list) -> list:
    """
    Public Mixed Font checker.
    """

    return _check_mixed_font(
        matched_pairs
    )
# ================================================================
# GENERIC ATTRIBUTE CHECKER
# ================================================================

def _check_attribute(
    matched_pairs: list,
    attr: str,
    finding_type: str,
) -> list:
    """
    Generic character-level formatting checker.

    Supported:
        bold
        italic
        color
        font
    """

    if attr == "font":
        return _check_font_type(
            matched_pairs
        )

    findings = []

    for pair in matched_pairs:

        m_row = pair["master_row"]
        s_row = pair["sample_row"]

        m_spans = m_row.get("spans", [])
        s_spans = s_row.get("spans", [])

        if not m_spans or not s_spans:
            continue

        m_text, m_attrs = _reconstruct(
            m_spans,
            attr,
        )

        s_text, s_attrs = _reconstruct(
            s_spans,
            attr,
        )

        if not m_text or not s_text:
            continue

        matcher = SequenceMatcher(
            None,
            m_text,
            s_text,
        )

        diff_detail = []

        for op, i1, i2, j1, j2 in matcher.get_opcodes():

            if op != "equal":
                continue

            length = min(
                i2 - i1,
                j2 - j1,
            )

            for offset in range(length):

                master_index = i1 + offset
                sample_index = j1 + offset

                master_value = m_attrs[
                    master_index
                ]

                sample_value = s_attrs[
                    sample_index
                ]

                if master_value != sample_value:

                    diff_detail.append({
                        "char": m_text[
                            master_index
                        ],
                        "master": master_value,
                        "sample": sample_value,
                    })

        if not diff_detail:
            continue

        findings.append({
            "page": int(m_row["page"]),
            "master": m_row["text"],
            "sample": s_row["text"],
            "master_bbox": m_row["bbox"],
            "sample_bbox": s_row["bbox"],
            "comment": (
                f"{finding_type}: differs on "
                f"{len(diff_detail)} character(s) "
                "of otherwise-matching text"
            ),
            "type": finding_type,
            "detail": diff_detail,
            "source": "pymupdf",
        })

    return findings

# ================================================================
# BOLD
# ================================================================

def check_bold(matched_pairs: list) -> list:
    """
    Detect Bold formatting differences.
    """

    return _check_attribute(
        matched_pairs,
        attr="bold",
        finding_type="Bold",
    )

# ================================================================
# ITALIC
# ================================================================

def check_italic(matched_pairs: list) -> list:
    """
    Detect Italic formatting differences.
    """

    return _check_attribute(
        matched_pairs,
        attr="italic",
        finding_type="Italic",
    )

# ================================================================
# COLOR
# ================================================================

def check_color(matched_pairs: list) -> list:
    """
    Detect Color formatting differences.
    """

    return _check_attribute(
        matched_pairs,
        attr="color",
        finding_type="Color",
    )
# ================================================================
# UNDERLINE HELPERS
# ================================================================

def _bbox_expand(bbox, margin=2.0):
    """Expand a bbox by a small amount."""

    if not bbox or len(bbox) != 4:
        return None

    x0, y0, x1, y1 = bbox

    return (
        float(x0) - margin,
        float(y0) - margin,
        float(x1) + margin,
        float(y1) + margin,
    )

def _line_near_text(drawing_bbox, text_bbox):
    """
    Determine whether a drawing object is plausibly an underline.
    """

    if not drawing_bbox or not text_bbox:
        return False

    dx0, dy0, dx1, dy1 = drawing_bbox
    tx0, ty0, tx1, ty1 = text_bbox

    text_height = max(
        1.0,
        ty1 - ty0,
    )

    text_width = max(
        1.0,
        tx1 - tx0,
    )

    overlap_x = max(
        0.0,
        min(dx1, tx1) - max(dx0, tx0),
    )

    if overlap_x <= 0:
        return False

    overlap_ratio = overlap_x / text_width

    if overlap_ratio < 0.35:
        return False

    line_y = (dy0 + dy1) / 2.0

    distance_from_bottom = abs(
        line_y - ty1
    )

    tolerance = max(
        2.5,
        text_height * 0.35,
    )

    if distance_from_bottom > tolerance:
        return False

    drawing_height = abs(
        dy1 - dy0
    )

    if drawing_height > max(
        4.0,
        text_height * 0.30,
    ):
        return False

    if (
        dx0 < tx0 - text_height
        or dx1 > tx1 + text_height
    ):
        return False

    return True

def _extract_page_drawings(pdf_path):
    """
    Extract drawing objects from a PDF using PyMuPDF.
    """

    drawings_by_page = {}

    try:
        import fitz

        doc = fitz.open(pdf_path)

        for page_number, page in enumerate(doc):

            page_drawings = []

            try:
                drawings = page.get_drawings()
            except Exception:
                drawings = []

            for drawing in drawings:

                rect = drawing.get("rect")

                if rect is None:
                    continue

                bbox = (
                    float(rect.x0),
                    float(rect.y0),
                    float(rect.x1),
                    float(rect.y1),
                )

                page_drawings.append({
                    "bbox": bbox,
                    "type": drawing.get("type"),
                    "items": drawing.get(
                        "items",
                        [],
                    ),
                    "width": drawing.get("width"),
                })

            drawings_by_page[
                page_number
            ] = page_drawings

        doc.close()

    except Exception:
        return {}

    return drawings_by_page

def _drawing_is_line_like(drawing):
    """
    Determine whether a drawing is line-like.
    """

    bbox = drawing.get("bbox")

    if not bbox:
        return False

    x0, y0, x1, y1 = bbox

    width = abs(x1 - x0)
    height = abs(y1 - y0)

    if width > 2.0 and height <= 3.0:
        return True

    if width > 2.0 and height <= 4.0:
        return True

    return False

def _span_underlined_from_drawings(
    span,
    drawings,
):
    """
    Determine whether a span is underlined using nearby
    PDF drawing objects.
    """

    span_bbox = span.get("bbox")

    if not span_bbox:
        return False

    expanded = _bbox_expand(
        span_bbox,
        margin=1.5,
    )

    for drawing in drawings:

        if not _drawing_is_line_like(
            drawing
        ):
            continue

        drawing_bbox = drawing.get(
            "bbox"
        )

        if _line_near_text(
            drawing_bbox,
            expanded,
        ):
            return True

    return False
# ================================================================
# UNDERLINE
# ================================================================

def check_underline(matched_pairs: list) -> list:
    """
    Detect Underline formatting differences.

    Uses explicit underline metadata when available.

    Otherwise, if the source PDF path is attached to the row,
    PyMuPDF drawing information is used.
    """

    findings = []

    drawings_cache = {}

    for pair in matched_pairs:

        m_row = pair["master_row"]
        s_row = pair["sample_row"]

        m_spans = m_row.get("spans", [])
        s_spans = s_row.get("spans", [])

        if not m_spans or not s_spans:
            continue

        m_text = _safe_text(
            m_row.get("text", "")
        )

        s_text = _safe_text(
            s_row.get("text", "")
        )

        if not m_text.strip() or not s_text.strip():
            continue

        similarity = _text_similarity(
            m_text,
            s_text,
        )

        if similarity < 0.60:
            continue

        # --------------------------------------------------------
        # Explicit underline metadata
        # --------------------------------------------------------

        m_has_explicit = any(
            "underline" in span
            for span in m_spans
        )

        s_has_explicit = any(
            "underline" in span
            for span in s_spans
        )

        m_underlines = None
        s_underlines = None

        if m_has_explicit:

            _, m_underlines = _reconstruct(
                m_spans,
                "underline",
            )

        if s_has_explicit:

            _, s_underlines = _reconstruct(
                s_spans,
                "underline",
            )

        # --------------------------------------------------------
        # Master drawing fallback
        # --------------------------------------------------------

        if m_underlines is None:

            master_pdf_path = m_row.get(
                "_pdf_path"
            )

            if master_pdf_path:

                if master_pdf_path not in drawings_cache:

                    drawings_cache[
                        master_pdf_path
                    ] = _extract_page_drawings(
                        master_pdf_path
                    )

                page_drawings = drawings_cache[
                    master_pdf_path
                ].get(
                    int(m_row["page"]),
                    [],
                )

                m_underlines = []

                for span in m_spans:

                    span_text = _safe_text(
                        span.get(
                            "text",
                            "",
                        )
                    )

                    is_underlined = (
                        _span_underlined_from_drawings(
                            span,
                            page_drawings,
                        )
                    )

                    m_underlines.extend(
                        [is_underlined]
                        * len(span_text)
                    )

        # --------------------------------------------------------
        # Sample drawing fallback
        # --------------------------------------------------------

        if s_underlines is None:

            sample_pdf_path = s_row.get(
                "_pdf_path"
            )

            if sample_pdf_path:

                if sample_pdf_path not in drawings_cache:

                    drawings_cache[
                        sample_pdf_path
                    ] = _extract_page_drawings(
                        sample_pdf_path
                    )

                page_drawings = drawings_cache[
                    sample_pdf_path
                ].get(
                    int(s_row["page"]),
                    [],
                )

                s_underlines = []

                for span in s_spans:

                    span_text = _safe_text(
                        span.get(
                            "text",
                            "",
                        )
                    )

                    is_underlined = (
                        _span_underlined_from_drawings(
                            span,
                            page_drawings,
                        )
                    )

                    s_underlines.extend(
                        [is_underlined]
                        * len(span_text)
                    )
        # --------------------------------------------------------
        # Cannot check underline without metadata/path.
        # --------------------------------------------------------

        if (
            m_underlines is None
            or s_underlines is None
        ):
            continue

        matcher = SequenceMatcher(
            None,
            m_text,
            s_text,
        )

        diff_detail = []

        for op, i1, i2, j1, j2 in matcher.get_opcodes():

            if op != "equal":
                continue

            length = min(
                i2 - i1,
                j2 - j1,
            )

            for offset in range(length):

                mi = i1 + offset
                si = j1 + offset

                if (
                    mi >= len(m_underlines)
                    or si >= len(s_underlines)
                ):
                    continue

                master_value = bool(
                    m_underlines[mi]
                )

                sample_value = bool(
                    s_underlines[si]
                )

                if master_value != sample_value:

                    diff_detail.append({
                        "char": m_text[mi],
                        "master": master_value,
                        "sample": sample_value,
                    })

        if not diff_detail:
            continue

        findings.append({
            "page": int(m_row["page"]),
            "master": m_row["text"],
            "sample": s_row["text"],
            "master_bbox": m_row["bbox"],
            "sample_bbox": s_row["bbox"],
            "comment": (
                "Underline: differs on "
                f"{len(diff_detail)} character(s) "
                "of otherwise-matching text"
            ),
            "type": "Underline",
            "detail": diff_detail,
            "source": "pymupdf",
        })

    return findings
# ================================================================
# COMBINED SINGLE-PASS FORMATTING CHECKER
# ================================================================
# Every individual checker above loops over matched_pairs and rebuilds the
# same span text, the same text-similarity, and the same SequenceMatcher
# alignment independently. With several formatting filters enabled that
# multiplicity multiplies the work (e.g. Font Type + Underline both compute
# similarity + a full char alignment on the exact same pair). check_formatting
# runs the loop over matched_pairs ONCE, reconstructs the span text and all
# requested per-character attribute arrays in a single pass, computes the
# text similarity once, and derives EVERY enabled finding type from A SINGLE
# character alignment (including Underline, which previously ran its own
# second, duplicate SequenceMatcher pass over the exact same text) — so
# enabling more filters no longer re-scans, and enabling Underline no longer
# doubles the alignment cost.

# Finding types produced by this combined checker.
FORMATTING_FINDING_TYPES = (
    "Font Type",
    "Mixed Font",
    "Bold",
    "Italic",
    "Underline",
    "Color",
)


def _underline_arrays(m_spans, s_spans, m_row, s_row, drawings_cache):
    """Return (m_values, s_values) per-character underline indicators.

    Prefers explicit `underline` metadata on the spans; falls back to
    PyMuPDF drawing analysis when the spans carry no underline metadata and
    the row has a source `_pdf_path`. Returns (None, None) when nothing is
    available — mirrors the original check_underline behaviour.
    """
    def compute(spans, row):
        if any("underline" in span for span in spans):
            return _reconstruct(spans, "underline")[1]

        pdf = row.get("_pdf_path")
        if not pdf:
            return None

        if pdf not in drawings_cache:
            drawings_cache[pdf] = _extract_page_drawings(pdf)
        page_drawings = drawings_cache[pdf].get(int(row.get("page", 0)), [])

        vals = []
        for span in spans:
            underlined = _span_underlined_from_drawings(span, page_drawings)
            vals.extend([underlined] * len(_safe_text(span.get("text", ""))))
        return vals

    m_vals = compute(m_spans, m_row)
    s_vals = compute(s_spans, s_row)
    if m_vals is None or s_vals is None:
        return None, None
    return m_vals, s_vals


def check_formatting(matched_pairs: list, enabled: dict = None) -> list:
    """Run every enabled formatting detection in a SINGLE pass over pairs.

    enabled: optional dict {finding_type: bool}. Only the enabled types are
        produced. When None (or missing keys), all six types are produced
        (legacy behaviour).

    IMPORTANT for callers: if this is invoked as `check_formatting(pairs)`
    without an explicit `enabled=` argument, ALL SIX checks run regardless
    of what the user actually selected on the frontend — that is the one
    place the "runs even when a filter isn't selected" symptom can come
    from, since every gate inside this function is driven entirely by the
    `enabled` dict it receives. Make sure the caller always builds and
    passes an explicit dict reflecting the frontend's selected filters
    (e.g. {"Font Type": False, "Bold": True, ...}) rather than omitting the
    argument.
    """
    if enabled is None:
        enabled = {t: True for t in FORMATTING_FINDING_TYPES}

    run_font_type = bool(enabled.get("Font Type", False))
    run_mixed = bool(enabled.get("Mixed Font", False))
    run_bold = bool(enabled.get("Bold", False))
    run_italic = bool(enabled.get("Italic", False))
    run_underline = bool(enabled.get("Underline", False))
    run_color = bool(enabled.get("Color", False))

    if not (run_font_type or run_mixed or run_bold or run_italic or run_underline or run_color):
        return []

    # Attribute arrays we need to align per character. Underline is NOT
    # included here: its per-character values come from _underline_arrays
    # (explicit metadata or drawing-based fallback), never from a plain
    # span attribute, so reconstructing an "underline" array here would
    # just be wasted work that's never read.
    aligned_attrs = []
    if run_font_type:
        aligned_attrs.append("font")
    if run_bold:
        aligned_attrs.append("bold")
    if run_italic:
        aligned_attrs.append("italic")
    if run_color:
        aligned_attrs.append("color")

    need_similarity = run_font_type or run_mixed or run_underline
    # A character-level alignment is needed for font/bold/italic/color (via
    # aligned_attrs) AND for underline (via its own value arrays) — both
    # share the exact same SequenceMatcher opcodes, computed once below.
    need_alignment = bool(aligned_attrs) or run_underline

    findings = []
    drawings_cache = {}

    for pair in matched_pairs:
        m_row = pair["master_row"]
        s_row = pair["sample_row"]
        m_spans = m_row.get("spans", [])
        s_spans = s_row.get("spans", [])

        if not m_spans or not s_spans:
            continue

        # ---- One reconstruction pass for text + all requested attrs ----
        # NOTE: text is always rebuilt correctly even when aligned_attrs is
        # empty (e.g. only Mixed Font is enabled) — see _reconstruct_multi.
        m_text, m_attrs = _reconstruct_multi(m_spans, aligned_attrs)
        s_text, s_attrs = _reconstruct_multi(s_spans, aligned_attrs)

        if not m_text.strip() or not s_text.strip():
            continue

        # ---- One similarity computation (only if any gated checker runs) --
        similarity = _text_similarity(m_text, s_text) if need_similarity else None
        high_sim = similarity is None or similarity >= 0.60

        # ---- Per-type detail collectors ----
        font_details = []
        attr_details = {"Bold": [], "Italic": [], "Color": [], "Underline": []}

        # ---- ONE character alignment feeding every char-based checker,
        # including Underline (computed here instead of via a second,
        # duplicate SequenceMatcher pass over the same m_text/s_text) ----
        if need_alignment:
            m_ul = s_ul = None
            if run_underline and high_sim:
                m_ul, s_ul = _underline_arrays(m_spans, s_spans, m_row, s_row, drawings_cache)

            matcher = SequenceMatcher(None, m_text, s_text)
            for op, i1, i2, j1, j2 in matcher.get_opcodes():
                if op != "equal":
                    continue
                length = min(i2 - i1, j2 - j1)
                for offset in range(length):
                    mi = i1 + offset
                    si = j1 + offset

                    if run_font_type and high_sim:
                        mf = m_attrs["font"][mi]
                        sf = s_attrs["font"][si]
                        if mf != sf:
                            font_details.append({
                                "char": m_text[mi],
                                "master_font": mf,
                                "sample_font": sf,
                                "master_index": mi,
                                "sample_index": si,
                            })

                    if run_bold and m_attrs["bold"][mi] != s_attrs["bold"][si]:
                        attr_details["Bold"].append({
                            "char": m_text[mi],
                            "master": m_attrs["bold"][mi],
                            "sample": s_attrs["bold"][si],
                        })

                    if run_italic and m_attrs["italic"][mi] != s_attrs["italic"][si]:
                        attr_details["Italic"].append({
                            "char": m_text[mi],
                            "master": m_attrs["italic"][mi],
                            "sample": s_attrs["italic"][si],
                        })

                    if run_color and m_attrs["color"][mi] != s_attrs["color"][si]:
                        attr_details["Color"].append({
                            "char": m_text[mi],
                            "master": m_attrs["color"][mi],
                            "sample": s_attrs["color"][si],
                        })

                    if m_ul is not None and s_ul is not None:
                        muv = bool(m_ul[mi]) if mi < len(m_ul) else False
                        suv = bool(s_ul[si]) if si < len(s_ul) else False
                        if muv != suv:
                            attr_details["Underline"].append({
                                "char": m_text[mi],
                                "master": muv,
                                "sample": suv,
                            })

        # ============================================================
        # Emit findings (Font Type, Mixed Font, Bold, Italic, Underline,
        # Color) — same relative order the pipeline used before.
        # ============================================================

        # Font Type
        if run_font_type and high_sim and font_details:
            grouped = _group_font_details(font_details)
            summary_parts = [
                f'Text "{d["text"]}" | '
                f'Master Font: "{d["master_font"]}" | '
                f'Sample Font: "{d["sample_font"]}"'
                for d in grouped
            ]
            findings.append({
                "page": int(m_row["page"]),
                "master": m_row["text"],
                "sample": s_row["text"],
                "master_bbox": m_row["bbox"],
                "sample_bbox": s_row["bbox"],
                "comment": ("Font Type Error: " + " || ".join(summary_parts)),
                "type": "Font Type",
                "detail": font_details,
                "source": "pymupdf",
            })

        # Mixed Font
        if run_mixed and high_sim:
            master_fonts = _font_profile(m_spans)
            sample_fonts = _font_profile(s_spans)
            master_mixed = len(master_fonts) > 1
            sample_mixed = len(sample_fonts) > 1
            if not (not master_mixed and not sample_mixed) \
                    and not (master_fonts == sample_fonts and master_mixed == sample_mixed):
                expected = ", ".join(master_fonts) if master_fonts else "Unknown"
                actual = ", ".join(sample_fonts) if sample_fonts else "Unknown"
                findings.append({
                    "page": int(m_row["page"]),
                    "master": m_row["text"],
                    "sample": s_row["text"],
                    "master_bbox": m_row["bbox"],
                    "sample_bbox": s_row["bbox"],
                    "comment": ("Mixed Font: "
                                f"Master Font(s): {expected} | "
                                f"Sample Font(s): {actual}"),
                    "type": "Mixed Font",
                    "detail": {"master_fonts": master_fonts, "sample_fonts": sample_fonts},
                    "source": "pymupdf",
                })

        # Bold / Italic / Underline / Color (attribute-based)
        for finding_type in ("Bold", "Italic", "Underline", "Color"):
            if not enabled.get(finding_type, False):
                continue
            diff_detail = attr_details[finding_type]
            if not diff_detail:
                continue
            findings.append({
                "page": int(m_row["page"]),
                "master": m_row["text"],
                "sample": s_row["text"],
                "master_bbox": m_row["bbox"],
                "sample_bbox": s_row["bbox"],
                "comment": (f"{finding_type}: differs on "
                            f"{len(diff_detail)} character(s) "
                            "of otherwise-matching text"),
                "type": finding_type,
                "detail": diff_detail,
                "source": "pymupdf",
            })

    return findings