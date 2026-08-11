"""
Structure checker — Deletion, Insertion.

Unlike the other checkers, these don't operate on matched_pairs — they
come from blocks the matcher couldn't pair at all (a Master block with
no Sample counterpart, or vice versa). Kept separate from the
checkers/__init__.py registry loop for that reason; called directly
by the pipeline against match_blocks()'s unmatched_master/unmatched_sample.

check_insertions/check_deletions optionally take matched_pairs to
SUPPRESS spurious findings caused by line-splitting differences between
Master and Sample (e.g. Master has "56 enterokapsler / ..." as one
line, Sample wraps the same content across three lines because it got
longer — the "56" fragment then has no direct match and would
otherwise be reported as a false Insertion, even though it's clearly
present in Master too). This is a narrow, safe suppression: it only
fires when the unmatched fragment's exact text is already contained
inside a matched pair's counterpart text on the same page — it does
NOT attempt full word-level re-attribution (see project notes on the
GVW granularity comparison — that's out of scope for this POC).
"""

import re


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _is_subsumed_in_matched_pairs(text: str, page: int, matched_pairs: list, source: str) -> bool:
    """
    Returns True if `text` already appears inside some matched pair's
    text on the same page — meaning it's not really new/missing content,
    just a line-splitting artifact of an already-reported Change.

    source: "master" to check unmatched Master fragments against
            matched pairs' master text; "sample" for the Sample side.
    """
    needle = normalize_whitespace(text)
    if not needle:
        return False
    key = "master_row" if source == "master" else "sample_row"
    for pair in matched_pairs:
        row = pair[key]
        if row["page"] != page:
            continue
        haystack = normalize_whitespace(row["text"])
        if needle in haystack and needle != haystack:
            return True
    return False


def check_deletions(unmatched_master: list, matched_pairs: list = None) -> list:
    findings = []
    for m_row in unmatched_master:
        if matched_pairs and _is_subsumed_in_matched_pairs(m_row["text"], m_row["page"], matched_pairs, "sample"):
            continue  # already accounted for in a Change finding — line-splitting artifact, not real
        findings.append({
            "page": m_row["page"],
            "master": m_row["text"],
            "sample": "",
            "master_bbox": m_row["bbox"],
            "sample_bbox": None,
            "comment": "Missing in sample",
            "type": "Deletion",
        })
    return findings


def check_insertions(unmatched_sample: list, matched_pairs: list = None) -> list:
    findings = []
    for s_row in unmatched_sample:
        if matched_pairs and _is_subsumed_in_matched_pairs(s_row["text"], s_row["page"], matched_pairs, "master"):
            continue  # already accounted for in a Change finding — line-splitting artifact, not real
        findings.append({
            "page": s_row["page"],
            "master": "",
            "sample": s_row["text"],
            "master_bbox": None,
            "sample_bbox": s_row["bbox"],
            "comment": "Extra text in sample",
            "type": "Insertion",
        })
    return findings