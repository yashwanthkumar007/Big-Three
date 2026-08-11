"""
Formatting checkers — Bold, Color.

These operate on span-level data (not the flat block text), since a
finding must say "the formatting differs on THIS portion of otherwise-
identical text," not just "something in this block is bold somewhere."

Method: reconstruct each block's full text from its spans (so text and
attribute arrays stay perfectly aligned), align Master's and Sample's
reconstructed text via SequenceMatcher (same technique as the Change
Grid), and for every character range where the TEXT matches, check
whether the attribute (bold / color) also matches. A mismatch there is
a real formatting-only difference — text ranges that don't match at all
are Content's job (Change/Insertion/Deletion), not this checker's.
"""

from difflib import SequenceMatcher


def _reconstruct(spans: list, attr: str):
    """
    Rebuilds the block's text from its spans, plus a parallel per-character
    attribute array. Reconstructing from spans (rather than trusting the
    block's stored `text` field) guarantees the two arrays line up exactly.
    """
    text = ""
    attr_per_char = []
    for span in spans:
        span_text = span["text"]
        text += span_text
        attr_per_char.extend([span[attr]] * len(span_text))
    return text, attr_per_char


def _check_attribute(matched_pairs: list, attr: str, finding_type: str) -> list:
    findings = []

    for pair in matched_pairs:
        m_row, s_row = pair["master_row"], pair["sample_row"]
        m_spans, s_spans = m_row.get("spans", []), s_row.get("spans", [])
        if not m_spans or not s_spans:
            continue

        m_text, m_attrs = _reconstruct(m_spans, attr)
        s_text, s_attrs = _reconstruct(s_spans, attr)

        matcher = SequenceMatcher(None, m_text, s_text)
        diff_found = False
        diff_detail = []

        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op != "equal":
                continue  # text itself differs here — Content checkers' job, not this one
            for k in range(i2 - i1):
                m_val = m_attrs[i1 + k]
                s_val = s_attrs[j1 + k]
                if m_val != s_val:
                    diff_found = True
                    diff_detail.append({"char": m_text[i1 + k], "master": m_val, "sample": s_val})

        if diff_found:
            findings.append({
                "page": m_row["page"],
                "master": m_row["text"],
                "sample": s_row["text"],
                "master_bbox": m_row["bbox"],
                "sample_bbox": s_row["bbox"],
                "comment": f"{finding_type}: differs on {len(diff_detail)} character(s) of otherwise-matching text",
                "type": finding_type,
                "detail": diff_detail,
            })

    return findings


def check_bold(matched_pairs: list) -> list:
    return _check_attribute(matched_pairs, attr="bold", finding_type="Bold")


def check_color(matched_pairs: list) -> list:
    return _check_attribute(matched_pairs, attr="color", finding_type="Color")