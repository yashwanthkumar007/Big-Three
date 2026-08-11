"""
Text comparison — matches Master blocks to Sample blocks using combined
text-similarity + position scoring, resolved via the Hungarian algorithm
(globally optimal assignment, not greedy matching — greedy matching was
proven to cause incorrect pairings during testing).

Whitespace is normalized before comparison to avoid false positives from
formatting-only differences (tabs vs. spaces) — confirmed as a real issue
during leaflet testing.

Also detects Location changes: cases where text content is identical
between Master and Sample, but the block's position shifted beyond
POSITION_SHIFT_THRESHOLD — previously a silent gap, confirmed missing
during real testing.
"""

import sys
import os
import re
import numpy as np
import pandas as pd
from difflib import SequenceMatcher
from scipy.optimize import linear_sum_assignment

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from src.exception import ComparisonError
from src.logger import logger
from src.utils import (
    TEXT_WEIGHT,
    POSITION_WEIGHT,
    POSITION_MAX_DISTANCE,
    MATCH_SCORE_THRESHOLD,
    POSITION_SHIFT_THRESHOLD,
)


def normalize_whitespace(text: str) -> str:
    """Collapses tabs and multiple spaces into a single space, strips ends."""
    return re.sub(r"\s+", " ", text).strip()


def combined_score(m_text, m_bbox, s_text, s_bbox) -> float:
    """
    Combines text similarity (normalized) and position proximity into
    a single match score. Text similarity dominates (weighted 0.7) so
    that rotated/shifted text still matches correctly; position acts
    as a tiebreaker to disambiguate repeated identical text.
    """
    text_sim = SequenceMatcher(
        None,
        normalize_whitespace(m_text),
        normalize_whitespace(s_text),
    ).ratio()

    mx0, my0 = m_bbox[0], m_bbox[1]
    sx0, sy0 = s_bbox[0], s_bbox[1]
    dist = ((mx0 - sx0) ** 2 + (my0 - sy0) ** 2) ** 0.5
    pos_sim = max(0, 1 - (dist / POSITION_MAX_DISTANCE))

    return (TEXT_WEIGHT * text_sim) + (POSITION_WEIGHT * pos_sim)


def _position_shifted(m_bbox, s_bbox, threshold: float = POSITION_SHIFT_THRESHOLD) -> bool:
    """Returns True if the block's top-left corner moved beyond threshold in x or y."""
    mx0, my0 = m_bbox[0], m_bbox[1]
    sx0, sy0 = s_bbox[0], s_bbox[1]
    return abs(mx0 - sx0) > threshold or abs(my0 - sy0) > threshold


def compare_blocks(master_df: pd.DataFrame, sample_df: pd.DataFrame) -> pd.DataFrame:
    """
    Compares Master and Sample block-level extractions, page by page,
    using optimal (Hungarian algorithm) assignment.

    Returns a DataFrame of findings with columns:
        page, master, sample, master_bbox, sample_bbox, comment, type

    Finding types:
        Change    — text content differs between matched blocks
        Location  — text is identical, but position shifted beyond threshold
        Deletion  — a Master block has no corresponding Sample block
        Insertion — a Sample block has no corresponding Master block
    """
    try:
        issues = []

        for page in master_df["page"].unique():
            m_page = master_df[master_df["page"] == page].reset_index(drop=True)
            s_page = sample_df[sample_df["page"] == page].reset_index(drop=True)

            n, m = len(m_page), len(s_page)
            if n == 0 or m == 0:
                continue

            cost_matrix = np.ones((n, m))
            for i in range(n):
                for j in range(m):
                    score = combined_score(
                        m_page.iloc[i]["text"], m_page.iloc[i]["bbox"],
                        s_page.iloc[j]["text"], s_page.iloc[j]["bbox"],
                    )
                    cost_matrix[i, j] = 1 - score

            row_ind, col_ind = linear_sum_assignment(cost_matrix)
            matched_master, matched_sample = set(), set()

            for i, j in zip(row_ind, col_ind):
                score = 1 - cost_matrix[i, j]
                if score < MATCH_SCORE_THRESHOLD:
                    continue

                m_row, s_row = m_page.iloc[i], s_page.iloc[j]
                matched_master.add(i)
                matched_sample.add(j)

                text_changed = (
                    normalize_whitespace(m_row["text"]) != normalize_whitespace(s_row["text"])
                )

                if text_changed:
                    issues.append({
                        "page": page,
                        "master": m_row["text"],
                        "sample": s_row["text"],
                        "master_bbox": m_row["bbox"],
                        "sample_bbox": s_row["bbox"],
                        "comment": f'Change: "{s_row["text"]}" should be "{m_row["text"]}" as in the original',
                        "type": "Change",
                    })
                elif _position_shifted(m_row["bbox"], s_row["bbox"]):
                    issues.append({
                        "page": page,
                        "master": m_row["text"],
                        "sample": s_row["text"],
                        "master_bbox": m_row["bbox"],
                        "sample_bbox": s_row["bbox"],
                        "comment": (
                            f"Text unchanged, but position shifted from "
                            f"{m_row['bbox']} to {s_row['bbox']}"
                        ),
                        "type": "Location",
                    })

            for i in range(n):
                if i not in matched_master:
                    m_row = m_page.iloc[i]
                    issues.append({
                        "page": page,
                        "master": m_row["text"],
                        "sample": "",
                        "master_bbox": m_row["bbox"],
                        "sample_bbox": None,
                        "comment": "Missing in sample",
                        "type": "Deletion",
                    })

            for j in range(m):
                if j not in matched_sample:
                    s_row = s_page.iloc[j]
                    issues.append({
                        "page": page,
                        "master": "",
                        "sample": s_row["text"],
                        "master_bbox": None,
                        "sample_bbox": s_row["bbox"],
                        "comment": "Extra text in sample",
                        "type": "Insertion",
                    })

        result_df = pd.DataFrame(issues)
        logger.info(f"Comparison complete — {len(result_df)} finding(s)")
        return result_df

    except Exception as e:
        raise ComparisonError(f"Comparison failed: {str(e)}", sys)