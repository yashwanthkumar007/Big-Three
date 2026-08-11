"""
Position checker — Location.

Fires when a matched pair has IDENTICAL text but its position shifted
beyond POSITION_SHIFT_THRESHOLD. Text-identical is required — if the
text also changed, that's Change's job, not this checker's; a pair can
still get both findings if both are true (text changed AND moved), but
this checker only reports the position half.

Only meaningful when both sides have real page geometry — see
matcher.py's has_real_position fallback. If either side lacks it,
"shifted" is meaningless (there's no real position to shift from), so
this checker skips that pair rather than reporting a false Location.
"""

import re
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from src.utils import POSITION_SHIFT_THRESHOLD


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _position_shifted(m_bbox, s_bbox, threshold: float) -> bool:
    mx0, my0 = m_bbox[0], m_bbox[1]
    sx0, sy0 = s_bbox[0], s_bbox[1]
    return abs(mx0 - sx0) > threshold or abs(my0 - sy0) > threshold


def check_location(matched_pairs: list, threshold: float = None) -> list:
    if threshold is None:
        threshold = POSITION_SHIFT_THRESHOLD

    findings = []
    for pair in matched_pairs:
        m_row, s_row = pair["master_row"], pair["sample_row"]

        if not (m_row.get("has_real_position", True) and s_row.get("has_real_position", True)):
            continue  # no real geometry on one side — "shifted" is meaningless here

        m_text = normalize_whitespace(m_row["text"])
        s_text = normalize_whitespace(s_row["text"])
        if m_text != s_text:
            continue  # text differs too — Change's job, this checker only covers pure position shift

        if _position_shifted(m_row["bbox"], s_row["bbox"], threshold):
            findings.append({
                "page": m_row["page"],
                "master": m_row["text"],
                "sample": s_row["text"],
                "master_bbox": m_row["bbox"],
                "sample_bbox": s_row["bbox"],
                "comment": (
                    f"Location: text unchanged, but position shifted from "
                    f"{m_row['bbox']} to {s_row['bbox']}"
                ),
                "type": "Location",
            })

    return findings