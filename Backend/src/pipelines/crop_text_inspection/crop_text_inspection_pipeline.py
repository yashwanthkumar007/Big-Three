"""
Crop Text Inspection Pipeline — runs the SAME text inspection logic as
comparison_pipeline.py, but scoped to a user-selected region of a
single page, for speed. Built as a separate pipeline so the existing
Text Inspection flow (comparison_pipeline.py) stays completely
untouched — this file only IMPORTS from existing modules, never edits
them.
 
Reuses, without modifying:
  - extract_lines()                              (pdf_extractor.py)
  - match_blocks()                                (matcher.py)
  - check_change/deletions/insertions             (content.py, structure.py)
  - check_location()                              (position.py)
  - group_location_findings()                     (grouping.py)
  - extract_table_rows() / check_table_rows_v2()  (table_structure_v2.py)
  - report_builder's dpi<->pdf-point scaling convention (REPORT_DPI, _scale_bbox)
 
Does NOT call run_text_inspection() — reimplements the same sequence
at a smaller scope (filtered lines) instead of running full-page and
filtering findings afterward, since that wastes time on far more
matcher/checker work than needed for a small crop.
"""
 
import sys
import os
import fitz
import pandas as pd
 
sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from src.components.extractors.pdf_extractor import extract_lines
from src.components.matcher import match_blocks
from src.checkers.content import check_change
from src.checkers.structure import check_deletions, check_insertions
from src.checkers.position import check_location
from src.checkers.table_structure_v2 import extract_table_rows, check_table_rows_v2
from src.review.grouping import group_location_findings
from src.pipelines.report_builder import REPORT_DPI, _scale_bbox
from src.exception import PipelineException
from src.logger import logger
 
# Padding (in PDF points) added around the user's crop box before running
# extraction/matching, so a line that's only partly inside the crop still
# finds its true counterpart on the other side instead of being reported
# as a false Deletion/Insertion at the crop edge. Findings are still
# filtered back down to the EXACT crop box before being returned — the
# margin only helps matching, it never widens what's reported.
CROP_MARGIN_POINTS = 75
 
 
def box_px_to_pdf_rect(box_px: dict, dpi: int = REPORT_DPI) -> fitz.Rect:
    """
    Inverse of report_builder._scale_bbox() — converts a pixel box (in
    the SAME DPI=150 pixel space the frontend already uses for
    master_box/sample_box) into a PDF-point fitz.Rect.
 
    Defined here (not added to report_builder.py) to avoid touching any
    existing file.
    """
    scale = dpi / 72
    return fitz.Rect(
        box_px["x"] / scale,
        box_px["y"] / scale,
        (box_px["x"] + box_px["width"]) / scale,
        (box_px["y"] + box_px["height"]) / scale,
    )
 
 
def _boxes_overlap(box_a, box_b) -> bool:
    ax0, ay0, ax1, ay1 = box_a
    bx0, by0, bx1, by1 = box_b
    return not (ax1 < bx0 or bx1 < ax0 or ay1 < by0 or by1 < ay0)
 
 
def _filter_lines_to_region(lines_df: pd.DataFrame, page_number: int, region: fitz.Rect) -> pd.DataFrame:
    if len(lines_df) == 0:
        return lines_df
    mask = (lines_df["page"] == page_number) & lines_df["bbox"].apply(
        lambda b: _boxes_overlap(tuple(b), tuple(region))
    )
    return lines_df[mask].reset_index(drop=True)
 
 
def _filter_table_rows_to_region(rows: list, region: fitz.Rect) -> list:
    return [
        r for r in rows
        if _boxes_overlap(r["label_bbox"], tuple(region)) or _boxes_overlap(r["value_bbox"], tuple(region))
    ]
 
 
def _row_in_table(row, table_rows) -> bool:
    return any(
        _boxes_overlap(tuple(row["bbox"]), r["label_bbox"]) or _boxes_overlap(tuple(row["bbox"]), r["value_bbox"])
        for r in table_rows
    )
 
 
def run_crop_text_inspection(master_path: str, sample_path: str, page_number: int, box_px: dict, dpi: int = REPORT_DPI) -> dict:
    """
    Runs Text Inspection scoped to a single page + cropped region only.
 
    Returns:
        {
            "findings": [...pixel-scaled findings, same shape as
                          report_builder.build_report()'s findings...],
            "match_stats": {"matched_pairs": N, "unmatched_master": N, "unmatched_sample": N},
            "region": {"page": ..., "box_px": ...},
        }
    """
    try:
        logger.info(
            f"Starting Crop Text Inspection: master={master_path}, sample={sample_path}, "
            f"page={page_number}, box_px={box_px}"
        )
 
        crop_rect = box_px_to_pdf_rect(box_px, dpi)
        expanded_rect = crop_rect + (-CROP_MARGIN_POINTS, -CROP_MARGIN_POINTS, CROP_MARGIN_POINTS, CROP_MARGIN_POINTS)
 
        master_lines = extract_lines(master_path)
        sample_lines = extract_lines(sample_path)
 
        master_lines = _filter_lines_to_region(master_lines, page_number, expanded_rect)
        sample_lines = _filter_lines_to_region(sample_lines, page_number, expanded_rect)
 
        master_table_rows = _filter_table_rows_to_region(
            extract_table_rows(master_path, page_number=page_number), expanded_rect
        )
        sample_table_rows = _filter_table_rows_to_region(
            extract_table_rows(sample_path, page_number=page_number), expanded_rect
        )
 
        table_findings = []
        if master_table_rows or sample_table_rows:
            all_table_findings = check_table_rows_v2(master_path, sample_path, page_number=page_number)
            table_findings = [
                f for f in all_table_findings
                if (f.get("master_bbox") and _boxes_overlap(f["master_bbox"], tuple(expanded_rect)))
                or (f.get("sample_bbox") and _boxes_overlap(f["sample_bbox"], tuple(expanded_rect)))
            ]
 
        if master_table_rows:
            master_lines = master_lines[~master_lines.apply(lambda r: _row_in_table(r, master_table_rows), axis=1)].reset_index(drop=True)
        if sample_table_rows:
            sample_lines = sample_lines[~sample_lines.apply(lambda r: _row_in_table(r, sample_table_rows), axis=1)].reset_index(drop=True)
 
        match_result = match_blocks(master_lines, sample_lines)
        matched_pairs = match_result["matched_pairs"]
 
        findings = []
        findings += [f for f in table_findings if f["type"] != "Location"]
        findings += check_change(matched_pairs)
        findings += check_deletions(match_result["unmatched_master"], matched_pairs=matched_pairs)
        findings += check_insertions(match_result["unmatched_sample"], matched_pairs=matched_pairs)
 
        general_location = check_location(matched_pairs)
        table_location = [f for f in table_findings if f["type"] == "Location"]
        all_location = table_location + general_location
 
        # Dominant-shift suppression kept ON (matches main pipeline
        # default) — DOMINANT_SHIFT_MIN_SIZE is 5, so it will only ever
        # suppress if the crop genuinely contains 5+ elements sharing the
        # same shift, which is still meaningfully "systematic" even at
        # crop scope. Small crops with <5 Location findings are
        # unaffected either way.
        location_grouped = group_location_findings(all_location, suppress_dominant=True)
        findings += location_grouped["ungrouped"]
 
        # Hard filter: only report findings whose box genuinely falls
        # inside the ORIGINAL (non-expanded) crop. The margin above was
        # only to help matching find true pairs near the edge — it must
        # never widen what's actually reported to the user.
        def _in_crop(f):
            for key in ("master_bbox", "sample_bbox"):
                box = f.get(key)
                if box and _boxes_overlap(tuple(box), tuple(crop_rect)):
                    return True
            return False
 
        findings = [f for f in findings if _in_crop(f)]
 
        findings_out = []
        for i, f in enumerate(findings, 1):
            findings_out.append({
                "id": i,
                "type": f["type"],
                "master": f["master"],
                "sample": f["sample"],
                "comment": f["comment"],
                "page": int(f.get("page", page_number)),
                "master_box": _scale_bbox(f.get("master_bbox"), dpi),
                "sample_box": _scale_bbox(f.get("sample_bbox"), dpi),
                "source": f.get("source", "pymupdf"),
            })
 
        logger.info(f"Crop Text Inspection complete — {len(findings_out)} finding(s) in region")
 
        return {
            "findings": findings_out,
            "match_stats": {
                "matched_pairs": len(matched_pairs),
                "unmatched_master": len(match_result["unmatched_master"]),
                "unmatched_sample": len(match_result["unmatched_sample"]),
            },
            "region": {"page": page_number, "box_px": box_px},
        }
 
    except Exception as e:
        raise PipelineException(f"Crop Text Inspection pipeline failed: {str(e)}", sys)