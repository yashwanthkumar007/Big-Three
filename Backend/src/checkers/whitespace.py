"""
Whitespace/character-pattern checkers — Case, Hyphen, Space.

Each of these detects a NARROW, specific difference pattern, not a
general content change — that's Change's (content.py) job. Case is
deliberately exclusive with Change (see check_case docstring) so a
pure case-only difference isn't reported twice.

Line Break (Space) is NOT implemented here — it requires per-line
spacing info that block-level extraction discards when joining lines
into one block string. Deferred; flagged as a known gap.
"""

import re


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def check_case(matched_pairs: list) -> list:
    """
    Fires ONLY when Master and Sample match case-insensitively but not
    case-sensitively — a pure case difference, nothing else changed.
    If any other character differs too, this correctly stays silent
    (lower() forms won't match either) and Change picks it up instead.
    """
    findings = []
    for pair in matched_pairs:
        m_row, s_row = pair["master_row"], pair["sample_row"]
        m_text = normalize_whitespace(m_row["text"])
        s_text = normalize_whitespace(s_row["text"])

        if m_text != s_text and m_text.lower() == s_text.lower():
            findings.append({
                "page": m_row["page"],
                "master": m_row["text"],
                "sample": s_row["text"],
                "master_bbox": m_row["bbox"],
                "sample_bbox": s_row["bbox"],
                "comment": f'Case: "{s_row["text"]}" differs in case from "{m_row["text"]}"',
                "type": "Case",
            })
    return findings


def check_hyphen(matched_pairs: list) -> list:
    """
    Fires when Master and Sample match once ALL hyphens are stripped,
    but not before — an added or missing hyphen, nothing else changed.
    """
    findings = []
    for pair in matched_pairs:
        m_row, s_row = pair["master_row"], pair["sample_row"]
        m_text = normalize_whitespace(m_row["text"])
        s_text = normalize_whitespace(s_row["text"])

        if m_text == s_text:
            continue  # identical, nothing to report

        m_no_hyphen = normalize_whitespace(m_text.replace("-", ""))
        s_no_hyphen = normalize_whitespace(s_text.replace("-", ""))

        if m_no_hyphen == s_no_hyphen:
            findings.append({
                "page": m_row["page"],
                "master": m_row["text"],
                "sample": s_row["text"],
                "master_bbox": m_row["bbox"],
                "sample_bbox": s_row["bbox"],
                "comment": f'Hyphen: "{s_row["text"]}" has a hyphen difference from "{m_row["text"]}"',
                "type": "Hyphen",
            })
    return findings


def check_space(matched_pairs: list) -> list:
    """
    Fires when a new space appears in the MIDDLE of a word in Sample —
    i.e. Master and Sample match once ALL whitespace is stripped
    entirely (not just collapsed), but not before.
    """
    findings = []
    for pair in matched_pairs:
        m_row, s_row = pair["master_row"], pair["sample_row"]
        m_text = normalize_whitespace(m_row["text"])
        s_text = normalize_whitespace(s_row["text"])

        if m_text == s_text:
            continue

        m_no_space = re.sub(r"\s+", "", m_text)
        s_no_space = re.sub(r"\s+", "", s_text)

        if m_no_space == s_no_space:
            findings.append({
                "page": m_row["page"],
                "master": m_row["text"],
                "sample": s_row["text"],
                "master_bbox": m_row["bbox"],
                "sample_bbox": s_row["bbox"],
                "comment": f'Space: "{s_row["text"]}" has a spacing difference from "{m_row["text"]}"',
                "type": "Space",
            })
    return findings