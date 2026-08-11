"""
Table structure checker v2 — uses the PDF's own black-fill rectangles
as the real cell boundaries, instead of inferring label/value/row
structure from text color and spacing (which had residual bugs: white
decorative text on the carton graphic got misclassified as "label",
and row boundaries were sometimes guessed wrong).

Why this is more reliable: the label cells in this table literally ARE
drawn as small black rectangles in the PDF (page.get_drawings()) — using
that geometry directly to define "this is a label cell, here is its
exact boundary" is grounded in the actual document structure, not a
heuristic guess. This eliminates the two bugs found in v1 that reused
color-only classification.

Approach:
1. Get every small black-fill rectangle on the page (candidate label
   cells) — exclude large ones (full-panel backgrounds, not cells).
2. For each rectangle, find the text line(s) it contains -> the label.
3. Group rectangles into columns by x0. Within each column, sort by y0
   to get row order.
4. For each label, the value region is: same y-range as its rectangle,
   x from the rectangle's right edge to the next column's left edge (or
   a max width if last column). ALL text lines inside that region
   (regardless of color) are concatenated as the value — this
   correctly handles wrapped multi-line values without the earlier
   wrap-merge bugs, since the boundary comes from real geometry, not
   inferred row height.
5. Match labels Master-to-Sample by text (labels rarely change).
   Compare matched labels' values for Change/Location; unmatched
   labels are Deletion/Insertion (whole row).
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


def extract_table_rows(pdf_path: str, page_number: int = 0) -> list:
    """Returns a list of {label, value, label_bbox, value_bbox} for
    every label:value cell pair found on the page."""
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
                all_lines.append({"text": text, "bbox": fitz.Rect(line["bbox"])})

    rows = []
    for col_idx, col in enumerate(columns):
        col_sorted = sorted(col, key=lambda r: r.y0)
        next_col_x0 = columns[col_idx + 1][0].x0 if col_idx + 1 < len(columns) else None

        for r in col_sorted:
            label_lines = [l for l in all_lines if fitz.Rect(l["bbox"]).intersects(r)]
            if not label_lines:
                continue
            label_text = normalize_whitespace(" ".join(l["text"] for l in label_lines))

            value_x0 = r.x1
            value_x1 = next_col_x0 if next_col_x0 is not None else r.x1 + MAX_VALUE_WIDTH
            value_region = fitz.Rect(value_x0, r.y0, value_x1, r.y1)

            value_lines = [
                l for l in all_lines
                if l["bbox"].y0 >= value_region.y0 - 1 and l["bbox"].y1 <= value_region.y1 + 1
                and l["bbox"].x0 >= value_region.x0 - 1 and l["bbox"].x0 < value_region.x1
            ]
            value_lines.sort(key=lambda l: l["bbox"].x0)
            value_text = normalize_whitespace(" ".join(l["text"] for l in value_lines))
            value_bbox = (
                min((l["bbox"].x0 for l in value_lines), default=value_x0),
                min((l["bbox"].y0 for l in value_lines), default=r.y0),
                max((l["bbox"].x1 for l in value_lines), default=value_x0),
                max((l["bbox"].y1 for l in value_lines), default=r.y1),
            )

            rows.append({
                "label": label_text,
                "value": value_text,
                "label_bbox": (r.x0, r.y0, r.x1, r.y1),
                "value_bbox": value_bbox,
                "page": page_number,
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


def check_table_rows_v2(master_pdf_path: str, sample_pdf_path: str, page_number: int = 0) -> list:
    master_rows = extract_table_rows(master_pdf_path, page_number)
    sample_rows = extract_table_rows(sample_pdf_path, page_number)

    matched, unmatched_master, unmatched_sample = _match_rows(master_rows, sample_rows)
    findings = []

    for m_row, s_row in matched:
        if m_row["value"] == s_row["value"]:
            mb, sb = m_row["value_bbox"], s_row["value_bbox"]
            if abs(mb[0] - sb[0]) > POSITION_SHIFT_THRESHOLD or abs(mb[1] - sb[1]) > POSITION_SHIFT_THRESHOLD:
                findings.append({
                    "page": m_row["page"], "master": m_row["value"], "sample": s_row["value"],
                    "master_bbox": mb, "sample_bbox": sb,
                    "comment": f"Location: text unchanged, but position shifted from {mb} to {sb}",
                    "type": "Location",
                })
        else:
            findings.append({
                "page": m_row["page"], "master": m_row["value"], "sample": s_row["value"],
                "master_bbox": m_row["value_bbox"], "sample_bbox": s_row["value_bbox"],
                "comment": f'Change: "{s_row["value"]}" should be "{m_row["value"]}" as in the original (row: {m_row["label"]})',
                "type": "Change",
            })

    for row in unmatched_master:
        findings.append({
            "page": row["page"], "master": f"{row['label']} {row['value']}", "sample": "",
            "master_bbox": row["label_bbox"], "sample_bbox": None,
            "comment": "Missing row in sample", "type": "Deletion",
        })

    for row in unmatched_sample:
        findings.append({
            "page": row["page"], "master": "", "sample": f"{row['label']} {row['value']}",
            "master_bbox": None, "sample_bbox": row["label_bbox"],
            "comment": "Extra row in sample", "type": "Insertion",
        })

    return findings