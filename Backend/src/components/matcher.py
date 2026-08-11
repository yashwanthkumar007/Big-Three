"""
Block matching — pairs Master blocks to Sample blocks using combined
text-similarity + position scoring, resolved via the Hungarian algorithm.
Always runs regardless of which diff filters are selected; every checker
consumes its output.

Position scoring degrades gracefully when either side lacks real page
geometry (has_real_position = False, e.g. a future DOCX extractor) —
falls back to text-similarity-only scoring rather than computing a
meaningless synthetic-bbox distance.

PATCHED: _is_generic_text() was defined with a docstring describing a
real confirmed mismatch case, but was never actually called anywhere —
dead code. Wired it into combined_score() now: when BOTH sides' text is
short and digit-heavy (codes, dates, IDs), text similarity is weighted
down and position is weighted up, since two unrelated digit codes can
coincidentally look textually similar. Confirmed real case this fixes:
"1134819"/"3113215" (Master) vs "1137986"/"3454894" (Sample) on a
rotated carton side-panel — the matcher was pairing them crossed
(1134819<->3454894, 3113215<->1137986) instead of by position
(1134819<->1137986, 3113215<->3454894).
"""

import sys
import os
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
)

# Weights used ONLY when both sides' text is short and digit-heavy (see
# _is_generic_text). Confirmed via debug_matcher_scores.py on the Test1
# rotated side-panel: text similarity isn't just a weak signal for
# generic digit codes — it's actively MISLEADING. Even at only 20% text
# weight, the correct pairing (position distance 33.66) lost to the
# wrong one (position distance 35.27) because the text-similarity swing
# between candidates was large enough to overcome a tiny position gap.
# Position ALONE correctly favored the right answer in both confirmed
# cases (33.70<35.81 and 33.66<35.27) — so for this content type, text
# similarity is excluded entirely rather than just down-weighted.
GENERIC_TEXT_WEIGHT = 0.0
GENERIC_POSITION_WEIGHT = 1.0


import re
from rapidfuzz import fuzz


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _is_generic_text(text: str) -> bool:
    """
    True for short, mostly-digit strings (codes, dates, IDs) — text
    similarity between two RANDOM digit strings is frequently high by
    coincidence (shared digits, similar length), which can outweigh a
    correct position match. Confirmed case: "3113215" scored HIGHER
    text similarity against the WRONG "1137986" (0.429) than against
    its correct match "3454894" (0.286), causing a real mismatch on a
    rotated carton side-panel. For this kind of text, position is the
    reliable signal — weight it much more heavily.
    """
    stripped = normalize_whitespace(text)
    if not stripped or len(stripped) > 12:
        return False
    digit_ratio = sum(c.isdigit() for c in stripped) / len(stripped)
    return digit_ratio >= 0.6


def combined_score(m_row, s_row) -> float:
    m_text = normalize_whitespace(m_row["text"])
    s_text = normalize_whitespace(s_row["text"])
    # rapidfuzz.fuzz.ratio ~100x faster than difflib.SequenceMatcher at
    # this scale (benchmarked: 9.6s -> 0.09s on a 546x549 matrix) —
    # the actual bottleneck for larger multi-page files. Score is 0-100,
    # normalized to 0-1 to match the existing scale.
    text_sim = fuzz.ratio(m_text, s_text) / 100

    m_has_pos = m_row.get("has_real_position", True)
    s_has_pos = s_row.get("has_real_position", True)

    if not (m_has_pos and s_has_pos):
        # Either side lacks real geometry — position score is meaningless,
        # fall back to text similarity only.
        return text_sim

    mx0, my0 = m_row["bbox"][0], m_row["bbox"][1]
    sx0, sy0 = s_row["bbox"][0], s_row["bbox"][1]
    dist = ((mx0 - sx0) ** 2 + (my0 - sy0) ** 2) ** 0.5
    pos_sim = max(0, 1 - (dist / POSITION_MAX_DISTANCE))

    # Generic short digit-heavy text needs position to dominate — see
    # _is_generic_text docstring and module docstring above for the
    # confirmed real mismatch this fixes.
    if _is_generic_text(m_text) and _is_generic_text(s_text):
        return (GENERIC_TEXT_WEIGHT * text_sim) + (GENERIC_POSITION_WEIGHT * pos_sim)

    return (TEXT_WEIGHT * text_sim) + (POSITION_WEIGHT * pos_sim)


def match_blocks(master_df: pd.DataFrame, sample_df: pd.DataFrame) -> dict:
    """
    Matches Master and Sample blocks page by page using optimal
    (Hungarian algorithm) assignment.

    Returns:
        {
            "matched_pairs": [{"master_row": Series, "sample_row": Series, "score": float}, ...],
            "unmatched_master": [Series, ...],
            "unmatched_sample": [Series, ...],
        }
    """
    try:
        matched_pairs, unmatched_master, unmatched_sample = [], [], []

        pages = set(master_df["page"].unique()) | set(sample_df["page"].unique())

        for page in pages:
            m_page_df = master_df[master_df["page"] == page].reset_index(drop=True)
            s_page_df = sample_df[sample_df["page"] == page].reset_index(drop=True)

            n, m = len(m_page_df), len(s_page_df)
            if n == 0 or m == 0:
                unmatched_master.extend(m_page_df.iloc[i] for i in range(n))
                unmatched_sample.extend(s_page_df.iloc[j] for j in range(m))
                continue

            # Convert once to plain dicts — repeated .iloc[] inside an
            # O(n*m) loop (300k+ calls on larger files) has real pandas
            # overhead; plain dict access is much cheaper per call.
            m_page = m_page_df.to_dict("records")
            s_page = s_page_df.to_dict("records")

            cost_matrix = np.ones((n, m))
            for i in range(n):
                for j in range(m):
                    cost_matrix[i, j] = 1 - combined_score(m_page[i], s_page[j])

            row_ind, col_ind = linear_sum_assignment(cost_matrix)
            matched_m, matched_s = set(), set()

            for i, j in zip(row_ind, col_ind):
                score = 1 - cost_matrix[i, j]
                if score < MATCH_SCORE_THRESHOLD:
                    continue
                matched_m.add(i)
                matched_s.add(j)
                matched_pairs.append({
                    "master_row": m_page_df.iloc[i],
                    "sample_row": s_page_df.iloc[j],
                    "score": score,
                })

            for i in range(n):
                if i not in matched_m:
                    unmatched_master.append(m_page_df.iloc[i])
            for j in range(m):
                if j not in matched_s:
                    unmatched_sample.append(s_page_df.iloc[j])

        logger.info(
            f"Matching complete — {len(matched_pairs)} matched pair(s), "
            f"{len(unmatched_master)} unmatched master, {len(unmatched_sample)} unmatched sample"
        )
        return {
            "matched_pairs": matched_pairs,
            "unmatched_master": unmatched_master,
            "unmatched_sample": unmatched_sample,
        }

    except Exception as e:
        raise ComparisonError(f"Matching failed: {str(e)}", sys)
    