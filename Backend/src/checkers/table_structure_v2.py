"""
Table structure checker v2 — uses the PDF's own black-fill rectangles
as the real cell boundaries, instead of inferring label/value/row
structure from text color and spacing.

PATCHED: extract_table_rows() and check_table_rows_v2() now accept
optional extra_lines (from Doc Intelligence gap-fill) so vector-
outlined labels — confirmed missing from PyMuPDF's text layer on the
summary/metadata table (Vendor Job No., Barcode Information, etc.) —
can still be found and attached to their row. Rectangle detection
(the reliable, geometry-based part) is completely unchanged; extra_lines
only feeds the label-text lookup step, and only for text PyMuPDF had
zero record of to begin with (see di_gapfill.py's overlap check), so
this cannot duplicate or override anything PyMuPDF already found.
"""

import re
import sys
import os
import fitz
import numpy as np
from difflib import SequenceMatcher
from scipy.optimize import linear_sum_assignment

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from src.utils import POSITION_SHIFT_THRESHOLD

MAX_LABEL_CELL_AREA = 5000  # points^2 — excludes large panel backgrounds
MAX_VALUE_WIDTH = 250       # points — cap value region width when no next column exists


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _find_label_rects(pdf_path: str, page_number: int = 0):
    doc = fitz.open(pdf_path)
    page = doc[page_number]
    drawings = page.get_drawings()
    rects = [
        d["rect"] for d in drawings
        if d.get("fill") == (0.0, 0.0, 0.0)
        and d.get("type") == "f"
        and d["rect"].width * d["rect"].height < MAX_LABEL_CELL_AREA
    ]
    return page, rects


def _column_groups(rects, x_tolerance=5.0):
    """Groups rectangles into columns by left-edge (x0) proximity."""
    sorted_rects = sorted(rects, key=lambda r: r.x0)
    columns = []
    for r in sorted_rects:
        placed = False
        for col in columns:
            if abs(col[0].x0 - r.x0) <= x_tolerance:
                col.append(r)
                placed = True
                break
        if not placed:
            columns.append([r])
    return columns


def extract_table_rows(pdf_path: str, page_number: int = 0, extra_lines: list = None) -> list:
    """Returns a list of {label, value, label_bbox, value_bbox} for
    every label:value cell pair found on the page.

    extra_lines: optional list of {"text":, "bbox":, "page": (optional)}
    from Doc Intelligence gap-fill (di_gapfill.augment_lines_with_di) —
    used ONLY to help find label text for vector-outlined labels that
    PyMuPDF's text layer has no record of at all. Rectangle detection
    (the reliable, geometry-based part) is unaffected by this.
    """
    page, label_rects = _find_label_rects(pdf_path, page_number)
    if not label_rects:
        return []

    columns = _column_groups(label_rects)
    columns.sort(key=lambda col: col[0].x0)  # left to right

    page_dict = page.get_text("dict")
    all_lines = []
    for block in page_dict["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            text = "".join(sp["text"] for sp in line["spans"]).strip()
            if text:
                all_lines.append({"text": text, "bbox": fitz.Rect(line["bbox"]), "source": "pymupdf"})

    # Merge in DI gap-fill lines for this page — these are ONLY text
    # PyMuPDF had zero record of, so this can't duplicate anything
    # already in all_lines above.
    if extra_lines:
        for l in extra_lines:
            if l.get("page", page_number) != page_number:
                continue
            all_lines.append({"text": l["text"], "bbox": fitz.Rect(l["bbox"]), "source": "doc_intelligence"})

    rows = []
    for col_idx, col in enumerate(columns):
        col_sorted = sorted(col, key=lambda r: r.y0)

        for r in col_sorted:
            label_lines = [l for l in all_lines if fitz.Rect(l["bbox"]).intersects(r)]
            if not label_lines:
                continue
            label_text = normalize_whitespace(" ".join(l["text"] for l in label_lines))

            # Next-column boundary: only consider OTHER columns' rects that
            # share this row's y-range (real row neighbor), not any column
            # anywhere on the page.
            same_row_next_x0 = None
            for other_col_idx, other_col in enumerate(columns):
                if other_col_idx <= col_idx:
                    continue
                for other_r in other_col:
                    if other_r.y0 < r.y1 and other_r.y1 > r.y0:  # y-overlap = same row
                        if same_row_next_x0 is None or other_r.x0 < same_row_next_x0:
                            same_row_next_x0 = other_r.x0
                break  # only need the nearest column's check

            # Confirmed real case: when Master and Sample use DIFFERENT row
            # layouts (a cell moved to a different column between versions —
            # "Keyline/Drawing No." changed columns entirely), the check
            # above finds no same-row rect in the next column — there isn't
            # one anymore at this exact y. Falling back to a generous
            # +MAX_VALUE_WIDTH guess then sweeps in whatever text happens to
            # sit in that wide window: another row's ENTIRE label+value,
            # including plain value text with no protecting rectangle (the
            # other_label_rects check below only catches labels, not this).
            # Fix: when no same-row neighbor exists, cap at the next
            # column's OVERALL position — its leftmost rect across ALL its
            # rows — instead of guessing a width. A hard structural
            # boundary that holds even when row layout differs between files.
            if same_row_next_x0 is None and col_idx + 1 < len(columns):
                same_row_next_x0 = columns[col_idx + 1][0].x0

            value_x0 = r.x1
            value_x1 = same_row_next_x0 if same_row_next_x0 is not None else r.x1 + MAX_VALUE_WIDTH
            value_region = fitz.Rect(value_x0, r.y0, value_x1, r.y1)

            # A text line's LEFT edge alone isn't a reliable boundary check —
            # confirmed real case: "Artwork Proof No." label text starts at
            # x0=291.7, before TrackWise's value_region.x1=317.7, so it slid
            # through an x0-only check even though it's genuinely a DIFFERENT
            # row's label. Fix: exclude any line that intersects ANY other
            # row's label rectangle on the page, regardless of its left edge —
            # if it's already claimed as another cell's label, it can't also
            # be this row's value.
            other_label_rects = [rr for c in columns for rr in c if rr != r]

            value_lines = [
                l for l in all_lines
                if l["bbox"].y0 >= value_region.y0 - 1 and l["bbox"].y1 <= value_region.y1 + 1
                and l["bbox"].x0 >= value_region.x0 - 1 and l["bbox"].x0 < value_region.x1
                and not any(l["bbox"].intersects(rr) for rr in other_label_rects)
            ]
            value_lines.sort(key=lambda l: l["bbox"].x0)
            value_text = normalize_whitespace(" ".join(l["text"] for l in value_lines))
            value_bbox = (
                min((l["bbox"].x0 for l in value_lines), default=value_x0),
                min((l["bbox"].y0 for l in value_lines), default=r.y0),
                max((l["bbox"].x1 for l in value_lines), default=value_x0),
                max((l["bbox"].y1 for l in value_lines), default=r.y1),
            )

            row_source = "doc_intelligence" if (
                any(l.get("source") == "doc_intelligence" for l in label_lines)
                or any(l.get("source") == "doc_intelligence" for l in value_lines)
            ) else "pymupdf"

            rows.append({
                "label": label_text,
                "value": value_text,
                "value_lines": [normalize_whitespace(l["text"]) for l in value_lines],
                "value_line_bboxes": [tuple(l["bbox"]) for l in value_lines],
                "label_bbox": (r.x0, r.y0, r.x1, r.y1),
                "value_bbox": value_bbox,
                "page": page_number,
                "source": row_source,
            })

    return rows


def _match_rows(master_rows, sample_rows, match_score_threshold=0.5):
    n, m = len(master_rows), len(sample_rows)
    if n == 0 or m == 0:
        return [], master_rows, sample_rows

    cost = np.ones((n, m))
    for i in range(n):
        for j in range(m):
            sim = SequenceMatcher(None, master_rows[i]["label"], sample_rows[j]["label"]).ratio()
            cost[i, j] = 1 - sim

    row_ind, col_ind = linear_sum_assignment(cost)
    matched, matched_m, matched_s = [], set(), set()
    for i, j in zip(row_ind, col_ind):
        score = 1 - cost[i, j]
        if score < match_score_threshold:
            continue
        matched_m.add(i)
        matched_s.add(j)
        matched.append((master_rows[i], sample_rows[j]))

    unmatched_master = [master_rows[i] for i in range(n) if i not in matched_m]
    unmatched_sample = [sample_rows[j] for j in range(m) if j not in matched_s]
    return matched, unmatched_master, unmatched_sample


def _diff_cell_value(m_row, s_row, enabled_types: list = None) -> list:
    """
    Compares a matched label pair's value. If the cell has MULTIPLE
    sub-lines on both sides, diffs them individually by position order.
    Falls back to whole-value comparison when line counts don't match
    or when there's only one line.

    enabled_types: optional list of finding types to produce (e.g.
    ["Change", "Deletion", "Insertion", "Location"]). Finding types not
    in the list are skipped entirely. When None, all types are produced.
    """
    if enabled_types is None:
        enabled_types = ["Change", "Deletion", "Insertion", "Location"]

    def _type_enabled(f_type: str) -> bool:
        return f_type in enabled_types

    m_lines, s_lines = m_row["value_lines"], s_row["value_lines"]
    m_bboxes, s_bboxes = m_row["value_line_bboxes"], s_row["value_line_bboxes"]

    row_source = "doc_intelligence" if (
        m_row.get("source") == "doc_intelligence" or s_row.get("source") == "doc_intelligence"
    ) else "pymupdf"

    findings = []

    if len(m_lines) > 1 and len(m_lines) == len(s_lines):
        for m_text, m_bbox, s_text, s_bbox in zip(m_lines, m_bboxes, s_lines, s_bboxes):
            if m_text == s_text:
                if _type_enabled("Location") and (
                    abs(m_bbox[0] - s_bbox[0]) > POSITION_SHIFT_THRESHOLD or abs(m_bbox[1] - s_bbox[1]) > POSITION_SHIFT_THRESHOLD
                ):
                    findings.append({
                        "page": m_row["page"], "master": m_text, "sample": s_text,
                        "master_bbox": m_bbox, "sample_bbox": s_bbox,
                        "comment": f"Location: text unchanged, but position shifted from {m_bbox} to {s_bbox}",
                        "type": "Location", "source": row_source,
                    })
            elif _type_enabled("Change"):
                findings.append({
                    "page": m_row["page"], "master": m_text, "sample": s_text,
                    "master_bbox": m_bbox, "sample_bbox": s_bbox,
                    "comment": f'Change: "{s_text}" should be "{m_text}" as in the original (row: {m_row["label"]})',
                    "type": "Change", "source": row_source,
                })
        return findings

    m_words = m_row["value"].split()
    s_words = s_row["value"].split()

    if m_words != s_words:
        matcher = SequenceMatcher(None, m_words, s_words)
        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == "equal":
                continue
            m_text = " ".join(m_words[i1:i2])
            s_text = " ".join(s_words[j1:j2])
            if op == "replace":
                if _type_enabled("Change"):
                    findings.append({
                        "page": m_row["page"], "master": m_text, "sample": s_text,
                        "master_bbox": m_row["value_bbox"], "sample_bbox": s_row["value_bbox"],
                        "comment": f'Change: "{s_text}" should be "{m_text}" as in the original (row: {m_row["label"]})',
                        "type": "Change", "source": row_source,
                    })
            elif op == "delete":
                if _type_enabled("Deletion"):
                    findings.append({
                        "page": m_row["page"], "master": m_text, "sample": "",
                        "master_bbox": m_row["value_bbox"], "sample_bbox": None,
                        "comment": "Missing in sample", "type": "Deletion", "source": row_source,
                    })
            elif op == "insert":
                if _type_enabled("Insertion"):
                    findings.append({
                        "page": m_row["page"], "master": "", "sample": s_text,
                        "master_bbox": None, "sample_bbox": s_row["value_bbox"],
                        "comment": "Extra text in sample", "type": "Insertion", "source": row_source,
                    })
        return findings

    mb, sb = m_row["value_bbox"], s_row["value_bbox"]
    if _type_enabled("Location") and (
        abs(mb[0] - sb[0]) > POSITION_SHIFT_THRESHOLD or abs(mb[1] - sb[1]) > POSITION_SHIFT_THRESHOLD
    ):
        findings.append({
            "page": m_row["page"], "master": m_row["value"], "sample": s_row["value"],
            "master_bbox": mb, "sample_bbox": sb,
            "comment": f"Location: text unchanged, but position shifted from {mb} to {sb}",
            "type": "Location", "source": row_source,
        })
    return findings


def check_table_rows_v2(
    master_pdf_path: str,
    sample_pdf_path: str,
    page_number: int = 0,
    master_extra_lines: list = None,
    sample_extra_lines: list = None,
    enabled_types: list = None,
) -> list:
    """
    master_extra_lines / sample_extra_lines: optional Doc Intelligence
    gap-fill lines (see di_gapfill.augment_lines_with_di), passed through
    to extract_table_rows so vector-outlined labels can still be found.

    enabled_types: optional list of finding types to produce. When None,
    all types are produced. Disabled types are skipped at every emission
    point (value diff, label location, unmatched rows) so the table
    checker never produces findings the user filtered out.
    """
    master_rows = extract_table_rows(master_pdf_path, page_number, extra_lines=master_extra_lines)
    sample_rows = extract_table_rows(sample_pdf_path, page_number, extra_lines=sample_extra_lines)

    if enabled_types is None:
        enabled_types = ["Change", "Deletion", "Insertion", "Location"]

    def _type_enabled(f_type: str) -> bool:
        return f_type in enabled_types

    matched, unmatched_master, unmatched_sample = _match_rows(master_rows, sample_rows)
    findings = []

    for m_row, s_row in matched:
        findings += _diff_cell_value(m_row, s_row, enabled_types=enabled_types)

        # Also check the LABEL's own position — separate from the value
        # check above. Matched rows were paired by label text similarity,
        # so the label text is identical (or near-identical) by
        # construction; if its position differs, that's a real move worth
        # reporting on its own. Confirmed real case: "Keyline/Drawing No."
        # moved to a completely different column between Master and
        # Sample (a genuine layout redesign) — the VALUE's move was
        # already caught, but the LABEL's move had no check at all before
        # this, so it silently had no finding of its own.
        if m_row["label"] == s_row["label"] and _type_enabled("Location"):
            lmb, lsb = m_row["label_bbox"], s_row["label_bbox"]
            if abs(lmb[0] - lsb[0]) > POSITION_SHIFT_THRESHOLD or abs(lmb[1] - lsb[1]) > POSITION_SHIFT_THRESHOLD:
                row_source = "doc_intelligence" if (
                    m_row.get("source") == "doc_intelligence" or s_row.get("source") == "doc_intelligence"
                ) else "pymupdf"
                findings.append({
                    "page": m_row["page"], "master": m_row["label"], "sample": s_row["label"],
                    "master_bbox": lmb, "sample_bbox": lsb,
                    "comment": f"Location: text unchanged, but position shifted from {lmb} to {lsb}",
                    "type": "Location", "source": row_source,
                })

    if _type_enabled("Deletion"):
        for row in unmatched_master:
            findings.append({
                "page": row["page"], "master": f"{row['label']} {row['value']}", "sample": "",
                "master_bbox": row["label_bbox"], "sample_bbox": None,
                "comment": "Missing row in sample", "type": "Deletion",
                "source": row.get("source", "pymupdf"),
            })

    if _type_enabled("Insertion"):
        for row in unmatched_sample:
            findings.append({
                "page": row["page"], "master": "", "sample": f"{row['label']} {row['value']}",
                "master_bbox": None, "sample_bbox": row["label_bbox"],
                "comment": "Extra row in sample", "type": "Insertion",
                "source": row.get("source", "pymupdf"),
            })

    return findings
