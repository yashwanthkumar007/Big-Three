"""
Comparison Pipeline — the single real entry point for a Text Inspection
run. Everything validated individually against real files (Test1, Test2)
gets wired together here: extraction -> matching -> checkers -> Location
grouping -> combined findings.

Enabled formatting detections:
    - Font Type
    - Mixed Font
    - Bold
    - Italic
    - Underline
    - Color

Disabled legacy text/whitespace detections:
    - Case
    - Hyphen
    - Space

Master is treated as the source of truth.

PATCHED: optional Doc Intelligence gap-fill (ENABLE_DI_GAPFILL). When
enabled, DI is called ONCE per page for each file, and the resulting
gap rows (text PyMuPDF's live-text layer has zero record of — confirmed
case: vector-outlined labels on the summary/metadata table) are reused
by BOTH the general line matcher and the table checker, so DI isn't
called twice for the same page. When disabled (default), behavior is
identical to before this patch.
"""

import sys
import os
import time
import fitz
import pandas as pd

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from src.components.extractors.pdf_extractor import extract_lines
from src.components.matcher import match_blocks
from src.checkers.content import check_change
from src.checkers.structure import check_deletions, check_insertions
from src.checkers.formatting import check_formatting
from src.checkers.whitespace import check_case, check_hyphen, check_space
from src.checkers.position import check_location
from src.checkers.table_structure_v2 import extract_table_rows, check_table_rows_v2
from src.components.cache import inspection_cache
from src.review.grouping import group_location_findings
from src.pipelines.report_builder import REPORT_DPI, _scale_bbox
from src.exception import PipelineException
from src.logger import logger

# Set True once pairing is confirmed correct against the real GVW report.
# While False: only Change/Insertion/Deletion/Location run, and the Bold/
# Case/Hyphen/Space checkers are skipped (they inherit whatever pairing the
# matcher produces — no point checking formatting on pairs that might
# still be wrong).
#
# NOTE: Color detection is deliberately NOT gated by this switch — it runs
# whenever the user's Color filter is enabled (see the color_enabled branch
# below), so ticking the Color checkbox actually detects color differences.
ENABLE_FORMATTING_CHECKERS = False

# The six formatting detections below are enabled independently and are
# NOT gated by ENABLE_FORMATTING_CHECKERS (that switch only keeps the
# legacy Case/Hyphen/Space block gated off). Each formatting checker runs
# whenever BOTH its ENABLE_*_CHECKER flag AND its Difference-Filter key
# are on.

# Font Type
ENABLE_FONT_TYPE_CHECKER = True

# Mixed Font
ENABLE_MIXED_FONT_CHECKER = True

# Bold
ENABLE_BOLD_CHECKER = True

# Italic
ENABLE_ITALIC_CHECKER = True

# Underline
ENABLE_UNDERLINE_CHECKER = True

# Color
ENABLE_COLOR_CHECKER = True

# Legacy text/whitespace detections — currently disabled (not part of the
# six-formatting set).
ENABLE_CASE_CHECKER = False
ENABLE_HYPHEN_CHECKER = False
ENABLE_SPACE_CHECKER = False

# Set True to call Doc Intelligence and fill in text PyMuPDF's live-text
# layer completely missed (vector-outlined labels). Off by default —
# adds latency (one DI call per page per file) and a network/cost
# dependency. Validate on a few real files before enabling broadly.
# See: gapfill_check.py (standalone debug tool) for how this was verified.
ENABLE_DI_GAPFILL = False

# Controls whether Location findings sharing the dominant/systematic
# shift (likely a global page realignment, not a real defect — see
# grouping.py) get suppressed from the findings list.
#
# DEFAULT IS TRUE — revised after real testing. False was tried first on
# the theory that a false negative is worse than a false positive, but
# real output showed the actual cost: 90+ individual Location findings
# for what is fundamentally ONE event (the whole page shifted as a
# block). That volume creates alert fatigue — a reviewer scrolling past
# dozens of near-identical rows is MORE likely to miss a genuine issue,
# not less. Suppressing the dominant shift is the better default, AS
# LONG AS it's fully disclosed (see the log line in run_text_inspection
# below and application.py's "LOCATION GROUPS" section) — nothing is
# silently hidden, it's summarized and logged instead.
#
#   True  (default) — dominant/systematic shifts (clusters >=
#           min_group_size in grouping.py) are excluded from findings,
#           but logged as a count + shift vector for audit purposes.
#   False — nothing suppressed. Every Location finding shown
#           individually. Use for a specific file if you need the full
#           raw picture (e.g. manually cross-checking against a GVW
#           report), not as the default for routine review.
SUPPRESS_DOMINANT_LOCATION_SHIFT = True

# Maps a backend finding type to the frontend filter key used in the
# Inspection sidebar's "Difference Filter" section. When a filter key is
# disabled, the matching checker is skipped entirely and no findings of
# that type are produced or reported.
FINDING_TYPE_TO_FILTER = {
    "Case": "case",
    "Change": "change",
    "Deletion": "deletion",
    "Hyphen": "hyphen",
    "Insertion": "insertion",
    "Location": "location",
    "Bold": "bold",
    "Color": "color",
    "Space": "space",
    "Size": "size",
    "Underline": "underline",
    "Italic": "italic",
    "Mixed Font": "mixedFont",
    "Font Type": "fontType",
}


def _filter_enabled(filters: dict, key: str, default: bool = True) -> bool:
    """Returns whether a filter key is enabled.

    When no filters dict is provided (legacy callers), everything defaults
    to enabled so behavior is unchanged.
    """
    if not filters:
        return default
    return filters.get(key, default)


def _findings_for_enabled(findings: list, filters: dict) -> list:
    """Safety net — drops any finding whose type maps to a disabled filter."""
    if not filters:
        return findings

    def _type_enabled(f: dict) -> bool:
        filter_key = FINDING_TYPE_TO_FILTER.get(f.get("type"))
        if filter_key is None:
            return True  # unknown types are never filtered
        return _filter_enabled(filters, filter_key, default=True)

    return [f for f in findings if _type_enabled(f)]


def _table_region_bboxes(pdf_path: str, extra_lines: list = None) -> tuple:
    """Returns (regions, rows).

    regions: {page_number: [(x0,y0,x1,y1), ...]} — the ACTUAL bounding
    box of every individual label/value cell found on the page (one box
    per row's label, one per row's value), NOT one big rectangle covering
    the table's overall extent.

    rows: the raw rows from extract_table_rows, returned so the caller can
    reuse them for the table checker instead of reopening/re-parsing the PDF.

    Confirmed bug this fixes: text that sits geometrically "inside" the
    table's overall area but was never claimed by any specific row (e.g.
    "Time: 11:25" — not backed by a black rectangle, and outside
    Description's value-region width cutoff) used to be silently dropped:
    excluded from general matching because it fell inside the old single
    big bounding box, but never captured by the table checker either,
    since no row claimed it. Using per-cell boxes instead means only
    text actually assigned to a real cell gets excluded — anything else
    correctly falls through to the general line matcher instead of
    vanishing.

    extra_lines: optional DI gap-fill lines, passed through to
    extract_table_rows so DI-recovered cells are excluded too."""
    regions = {}
    if extra_lines is None:
        # No DI gap-fill: table rows are cached so Crop Compare reuses the
        # same rows instead of re-parsing the PDF per crop request.
        rows = inspection_cache.get_or_extract_table_rows(
            pdf_path, 0, lambda p, pg: extract_table_rows(p, page_number=pg)
        )
    else:
        rows = extract_table_rows(pdf_path, page_number=0, extra_lines=extra_lines)  # single-page files for now
    if not rows:
        logger.info(
            f"WARNING: table_structure_v2 found ZERO rows on {pdf_path} — "
            f"this artwork's summary table may use a different template layout "
            f"than the black-rectangle-label convention this checker expects. "
            f"Content will still be checked via the general line matcher, but "
            f"WITHOUT structured row labels (row: X) on any findings from this table."
        )
        return regions, rows

    boxes = []
    for r in rows:
        lx0, ly0, lx1, ly1 = r["label_bbox"]
        boxes.append((lx0 - 1, ly0 - 1, lx1 + 1, ly1 + 1))
        vx0, vy0, vx1, vy1 = r["value_bbox"]
        if vx1 > vx0 and vy1 > vy0:  # skip empty value boxes (e.g. blank Sign-offs cell)
            boxes.append((vx0 - 1, vy0 - 1, vx1 + 1, vy1 + 1))

    regions[0] = boxes
    return regions, rows


def _boxes_overlap(box_a, box_b) -> bool:
    ax0, ay0, ax1, ay1 = box_a
    bx0, by0, bx1, by1 = box_b
    return not (ax1 < bx0 or bx1 < ax0 or ay1 < by0 or by1 < ay0)


def _exclude_table_region(df: pd.DataFrame, table_regions: dict) -> pd.DataFrame:
    """Filters out any row whose bbox overlaps a REAL table cell box —
    so the general line/word matcher never re-processes actual table
    content (avoiding duplicate findings), while text that ISN'T claimed
    by any real cell (e.g. unclaimed inline labels like "Time:") is left
    alone and flows through to general matching instead of being
    silently dropped."""
    if not table_regions or len(df) == 0:
        return df

    def _in_table(row):
        boxes = table_regions.get(row["page"])
        if not boxes:
            return False
        return any(_boxes_overlap(row["bbox"], box) for box in boxes)

    return df[~df.apply(_in_table, axis=1)].reset_index(drop=True)


def _get_di_gap_rows(pdf_path: str, lines_df: pd.DataFrame) -> tuple:
    """
    Calls Doc Intelligence gap-fill once for this file and returns:
        (augmented_lines_df, gap_rows_as_records)

    gap_rows_as_records is just the NEW rows DI added (as a list of dicts
    matching the table checker's extra_lines schema: text, bbox, page) —
    reused directly by check_table_rows_v2 so DI isn't called a second
    time for the same page.

    Any failure (network, auth, timeout) degrades gracefully — logs and
    returns the original lines_df unchanged with an empty gap list,
    rather than crashing the whole comparison run.
    """
    try:
        from src.components.extractors.di_gapfill import augment_lines_with_di
    except ImportError as e:
        logger.info(f"DI gap-fill module not available ({e}) — skipping for {pdf_path}")
        return lines_df, []

    try:
        original_len = len(lines_df)
        augmented_df = augment_lines_with_di(pdf_path, lines_df)
        gap_rows = augmented_df.iloc[original_len:].to_dict("records")
        return augmented_df, gap_rows
    except Exception as e:
        logger.info(f"DI gap-fill failed for {pdf_path}: {e} — continuing without it")
        return lines_df, []


def run_text_inspection(master_path: str, sample_path: str, filters: dict = None) -> dict:
    """
    Runs the full Text Inspection pipeline on a Master/Sample PDF pair.

    filters: optional dict of {"<filter key>": bool} matching the frontend
        Difference Filter checkboxes (case, change, deletion, hyphen,
        insertion, location, bold, italic, underline, color, fontType,
        mixedFont, space, size). Disabled checkers are SKIPPED entirely —
        no findings of that type are produced or reported. When None
        (legacy callers), all filters default to enabled and behavior is
        unchanged.

    Returns:
        {
            "findings": [...all non-Location findings, plus ungrouped Location findings...],
            "location_groups": [...grouped Location summaries...],
            "match_stats": {"matched_pairs": N, "unmatched_master": N, "unmatched_sample": N},
        }
    """
    try:
        logger.info(f"Starting Text Inspection: master={master_path}, sample={sample_path}")

        # Enabled-filter helpers — everything below consults these so the
        # user's Difference Filter selections are honored end-to-end.
        def should_run(filter_key: str, default: bool = True) -> bool:
            return _filter_enabled(filters, filter_key, default=default)

        change_enabled = should_run("change")
        deletion_enabled = should_run("deletion")
        insertion_enabled = should_run("insertion")
        location_enabled = should_run("location")
        case_enabled = should_run("case")
        hyphen_enabled = should_run("hyphen")
        space_enabled = should_run("space")
        bold_enabled = should_run("bold")
        italic_enabled = should_run("italic")
        underline_enabled = should_run("underline")
        color_enabled = should_run("color")
        font_type_enabled = should_run("fontType")
        mixed_font_enabled = should_run("mixedFont")

        enabled_types = []
        if change_enabled:
            enabled_types.append("Change")
        if deletion_enabled:
            enabled_types.append("Deletion")
        if insertion_enabled:
            enabled_types.append("Insertion")
        if location_enabled:
            enabled_types.append("Location")
        if case_enabled:
            enabled_types.append("Case")
        if hyphen_enabled:
            enabled_types.append("Hyphen")
        if space_enabled:
            enabled_types.append("Space")
        if bold_enabled:
            enabled_types.append("Bold")
        if italic_enabled:
            enabled_types.append("Italic")
        if underline_enabled:
            enabled_types.append("Underline")
        if color_enabled:
            enabled_types.append("Color")
        if font_type_enabled:
            enabled_types.append("Font Type")
        if mixed_font_enabled:
            enabled_types.append("Mixed Font")

        logger.info(
            f"Enabled finding types: {', '.join(enabled_types) if enabled_types else '(none)'}"
        )

        t0 = time.perf_counter()
        # Extraction is cached (fingerprint-validated on disk), so the full
        # inspection populates the cache and subsequent Crop Compare requests
        # reuse it instead of re-parsing the PDFs.
        master_lines = inspection_cache.get_or_extract_lines(master_path, extract_lines)
        sample_lines = inspection_cache.get_or_extract_lines(sample_path, extract_lines)
        logger.info(f"[timing] extract_lines: {time.perf_counter() - t0:.2f}s")

        # DI gap-fill (optional) — run ONCE per file here, before table
        # exclusion, so both the general matcher and the table checker
        # can use the same result without a second API call per page.
        master_di_extra, sample_di_extra = [], []
        if ENABLE_DI_GAPFILL:
            master_lines, master_di_extra = _get_di_gap_rows(master_path, master_lines)
            sample_lines, sample_di_extra = _get_di_gap_rows(sample_path, sample_lines)
            if master_di_extra:
                logger.info(f"DI gap-fill added {len(master_di_extra)} row(s) to master")
            if sample_di_extra:
                logger.info(f"DI gap-fill added {len(sample_di_extra)} row(s) to sample")

        # Table region gets its own dedicated matcher (geometry-based, label-
        # anchored) — excluded from general line/word matching below so
        # Bold/Color/Location don't also run on it and produce nonsense.
        # DI gap rows are passed through so vector-outlined labels can be
        # found without touching the reliable rectangle-detection logic.
        # The extracted rows are returned and REUSED by the table checker
        # below, so each file's get_drawings()/get_text() runs only twice
        # total (once in extract_lines, once here) instead of three times.
        t0 = time.perf_counter()
        master_table_regions, master_table_rows = _table_region_bboxes(master_path, extra_lines=master_di_extra)
        sample_table_regions, sample_table_rows = _table_region_bboxes(sample_path, extra_lines=sample_di_extra)
        table_findings = check_table_rows_v2(
            master_path, sample_path,
            master_extra_lines=master_di_extra,
            sample_extra_lines=sample_di_extra,
            enabled_types=enabled_types,
            master_rows=master_table_rows,
            sample_rows=sample_table_rows,
        )
        logger.info(f"[timing] table extraction+check: {time.perf_counter() - t0:.2f}s")
        table_location = [f for f in table_findings if f["type"] == "Location"]
        table_other = [f for f in table_findings if f["type"] != "Location"]

        master_lines = _exclude_table_region(master_lines, master_table_regions)
        sample_lines = _exclude_table_region(sample_lines, sample_table_regions)

        t0 = time.perf_counter()
        match_result = match_blocks(master_lines, sample_lines)
        matched_pairs = match_result["matched_pairs"]
        logger.info(f"[timing] match_blocks: {time.perf_counter() - t0:.2f}s")

        findings = []
        findings += table_other
        if change_enabled:
            findings += check_change(matched_pairs)
        if deletion_enabled:
            findings += check_deletions(match_result["unmatched_master"], matched_pairs=matched_pairs)
        if insertion_enabled:
            findings += check_insertions(match_result["unmatched_sample"], matched_pairs=matched_pairs)

        # The six formatting detections below run independently of the
        # legacy ENABLE_FORMATTING_CHECKERS pairing-confidence gate — each
        # checker runs whenever BOTH its ENABLE_*_CHECKER flag AND its
        # Difference-Filter key are enabled. (gapless/OCR rows with empty
        # spans are skipped inside the checkers, and _findings_for_enabled
        # below still drops any finding whose filter got turned off.)
        #
        # All enabled formatting detections are produced in a SINGLE scan
        # over matched_pairs (check_formatting) — one span reconstruction,
        # one text-similarity computation and one character alignment shared
        # by every enabled finding type, instead of each checker re-scanning
        # the pairs independently.
        t0 = time.perf_counter()
        formatting_enabled = {
            "Font Type": ENABLE_FONT_TYPE_CHECKER and font_type_enabled,
            "Mixed Font": ENABLE_MIXED_FONT_CHECKER and mixed_font_enabled,
            "Bold": ENABLE_BOLD_CHECKER and bold_enabled,
            "Italic": ENABLE_ITALIC_CHECKER and italic_enabled,
            "Underline": ENABLE_UNDERLINE_CHECKER and underline_enabled,
            "Color": ENABLE_COLOR_CHECKER and color_enabled,
        }
        findings += check_formatting(matched_pairs, formatting_enabled)
        logger.info(f"[timing] formatting checkers: {time.perf_counter() - t0:.2f}s")

        # Legacy text/whitespace checkers are NOT part of the six-formatting
        # set — they remain gated behind the master ENABLE_FORMATTING_
        # CHECKERS switch (default False, i.e. currently disabled) AND the
        # individual filter being enabled.
        if ENABLE_FORMATTING_CHECKERS and case_enabled:
            findings += check_case(matched_pairs)
        if ENABLE_FORMATTING_CHECKERS and hyphen_enabled:
            findings += check_hyphen(matched_pairs)
        if ENABLE_FORMATTING_CHECKERS and space_enabled:
            findings += check_space(matched_pairs)

        # Location findings come from both the table checker and the
        # general line matcher — group ALL of them together so shifts
        # spanning both regions still collapse sensibly.
        if location_enabled:
            general_location = check_location(matched_pairs)
        else:
            general_location = []
        all_location = table_location + general_location
        location_grouped = group_location_findings(all_location, suppress_dominant=SUPPRESS_DOMINANT_LOCATION_SHIFT)
        findings += location_grouped["ungrouped"]

        # Full audit-trail disclosure of anything suppressed — nothing
        # about this filtering is silent. If SUPPRESS_DOMINANT_LOCATION_
        # SHIFT is True, every excluded cluster is logged here with its
        # shift vector and member count, so the decision is always
        # traceable even though it isn't shown as individual findings.
        if SUPPRESS_DOMINANT_LOCATION_SHIFT and location_grouped["grouped"]:
            total_suppressed = sum(g["count"] for g in location_grouped["grouped"])
            logger.info(
                f"Location suppression active — {total_suppressed} finding(s) across "
                f"{len(location_grouped['grouped'])} cluster(s) excluded as likely global "
                f"page realignment (not reported as findings, but logged here for audit):"
            )
            for g in location_grouped["grouped"]:
                logger.info(f"  Suppressed cluster: shift={g['shift']}, {g['count']} item(s)")

        # Final safety net — drops ANY finding whose type maps to a
        # disabled filter, including anything emitted by code paths above
        # that weren't individually gated. Unknown types are never dropped.
        findings = _findings_for_enabled(findings, filters)

        logger.info(
            f"Pipeline complete — {len(findings)} finding(s), "
            f"{len(location_grouped['grouped'])} Location group(s)"
        )

        return {
            "findings": findings,
            "location_groups": location_grouped["grouped"],
            "match_stats": {
                "matched_pairs": len(matched_pairs),
                "unmatched_master": len(match_result["unmatched_master"]),
                "unmatched_sample": len(match_result["unmatched_sample"]),
            },
        }

    except Exception as e:
        raise PipelineException(f"Text Inspection pipeline failed: {str(e)}", sys)


def save_report(result: dict, output_dir: str):
    """Saves findings and location groups to CSV in the given output directory."""
    os.makedirs(output_dir, exist_ok=True)

    findings_df = pd.DataFrame(result["findings"])
    if not findings_df.empty:
        path = os.path.join(output_dir, "findings.csv")
        findings_df.to_csv(path, index=False)
        logger.info(f"Saved report: {path}")

    if result["location_groups"]:
        groups_df = pd.DataFrame([
            {"shift": g["shift"], "count": g["count"],
             "example_master": g["sample_members"][0]["master"]}
            for g in result["location_groups"]
        ])
        path = os.path.join(output_dir, "location_groups.csv")
        groups_df.to_csv(path, index=False)
        logger.info(f"Saved report: {path}")


# ============================================================================
# CROP TEXT INSPECTION PIPELINE
# ============================================================================
# Runs the SAME text inspection logic as run_text_inspection() above, but
# scoped to a user-selected region of a single page, for speed. Originally
# lived in pipelines/crop_text_inspection/crop_text_inspection_pipeline.py;
# merged here so both entry points share one file. Reuses, without
# modifying:
#   - extract_lines()                              (pdf_extractor.py)
#   - match_blocks()                                (matcher.py)
#   - check_change/deletions/insertions             (content.py, structure.py)
#   - check_location()                              (position.py)
#   - group_location_findings()                     (grouping.py)
#   - extract_table_rows() / check_table_rows_v2()  (table_structure_v2.py)
#   - report_builder's dpi<->pdf-point scaling convention (REPORT_DPI, _scale_bbox)
#
# Does NOT call run_text_inspection() — reimplements the same sequence
# at a smaller scope (filtered lines) instead of running full-page and
# filtering findings afterward, since that wastes time on far more
# matcher/checker work than needed for a small crop.

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
    """
    scale = dpi / 72
    return fitz.Rect(
        box_px["x"] / scale,
        box_px["y"] / scale,
        (box_px["x"] + box_px["width"]) / scale,
        (box_px["y"] + box_px["height"]) / scale,
    )


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

        master_lines = inspection_cache.get_or_extract_lines(master_path, extract_lines)
        sample_lines = inspection_cache.get_or_extract_lines(sample_path, extract_lines)

        master_lines = _filter_lines_to_region(master_lines, page_number, expanded_rect)
        sample_lines = _filter_lines_to_region(sample_lines, page_number, expanded_rect)

        master_page_rows = inspection_cache.get_or_extract_table_rows(
            master_path, page_number, lambda p, pg: extract_table_rows(p, page_number=pg)
        )
        sample_page_rows = inspection_cache.get_or_extract_table_rows(
            sample_path, page_number, lambda p, pg: extract_table_rows(p, page_number=pg)
        )
        master_table_rows = _filter_table_rows_to_region(master_page_rows, expanded_rect)
        sample_table_rows = _filter_table_rows_to_region(sample_page_rows, expanded_rect)

        table_findings = []
        if master_table_rows or sample_table_rows:
            all_table_findings = check_table_rows_v2(
                master_path, sample_path,
                page_number=page_number,
                master_rows=master_page_rows,
                sample_rows=sample_page_rows,
            )
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