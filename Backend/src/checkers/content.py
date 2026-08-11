"""
Content checker — Change.

Detects when a matched Master/Sample pair has the SAME approximate
position/identity (that's what made the matcher pair them) but different
text content. This is the core "did the wording change" check.
"""

import re


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def check_change(matched_pairs: list) -> list:
    findings = []

    for pair in matched_pairs:
        m_row, s_row = pair["master_row"], pair["sample_row"]

        m_text = normalize_whitespace(m_row["text"])
        s_text = normalize_whitespace(s_row["text"])

        if m_text == s_text:
            continue

        if m_text.lower() == s_text.lower():
            continue  # pure case-only diff — check_case's job, not Change's

        findings.append({
            "page": m_row["page"],
            "master": m_row["text"],
            "sample": s_row["text"],
            "master_bbox": m_row["bbox"],
            "sample_bbox": s_row["bbox"],
            "comment": f'Change: "{s_row["text"]}" should be "{m_row["text"]}" as in the original',
            "type": "Change",
        })

    return findings