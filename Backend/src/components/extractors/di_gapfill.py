"""
Doc Intelligence gap-fill extractor.

Wraps PyMuPDF's line extraction with an OPTIONAL Doc Intelligence pass
that recovers text PyMuPDF's live-text layer cannot see at all — mainly
vector-outlined labels (converted to paths so they can't be edited),
confirmed as a real case on the summary/metadata table (Vendor Job No.,
Barcode Information, etc. — see gapfill_check.py debug run).

This does NOT replace PyMuPDF and does NOT run by default (see
ENABLE_DI_GAPFILL in comparison_pipeline.py). It only ADDS rows for
DI-detected text regions that have zero overlap with anything PyMuPDF
already extracted. Added rows have no span/formatting data
(has_real_position=True, spans=[]) — Bold/Color checkers correctly skip
them, same as existing OCR-fallback rows.

Cost/latency note: calls Doc Intelligence once per page, every run. For
artwork where the gap text is static template content (labels that
never change between Master/Sample), this is a repeated network call
for what's usually the same result. Left uncached here to keep this
first version simple — revisit if latency/cost becomes a real problem
once this is validated on more files.

Failure handling: any DI failure (network, auth, timeout) on a given
page is logged and skipped — the page just runs without gap-fill rather
than crashing the whole comparison. A DI outage should never take down
Text Inspection.
"""

import os
import sys
import time
import requests
import pandas as pd
import fitz

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
from src.logger import logger

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # falls back to whatever's already in the OS environment

DEFAULT_ANALYZE_URL = (
    "https://emtech-apim-all-all-poc.azure-api.net/docintel/documentModels/"
    "prebuilt-layout:analyze?api-version=2024-11-30"
)


def _boxes_overlap(box_a, box_b) -> bool:
    ax0, ay0, ax1, ay1 = box_a
    bx0, by0, bx1, by1 = box_b
    return not (ax1 < bx0 or bx1 < ax0 or ay1 < by0 or by1 < ay0)


def _call_di(image_path: str) -> tuple:
    api_key = os.environ.get("AZURE_API_KEY")
    analyze_url = os.environ.get("ANALYZE_URL", DEFAULT_ANALYZE_URL)
    if not api_key:
        raise RuntimeError("AZURE_API_KEY not set — cannot call Doc Intelligence")

    with open(image_path, "rb") as f:
        image_bytes = f.read()

    headers = {"Ocp-Apim-Subscription-Key": api_key, "Content-Type": "application/octet-stream"}
    submit_resp = requests.post(analyze_url, headers=headers, data=image_bytes)
    submit_resp.raise_for_status()

    # Operation-Location points at the backend cognitiveservices host
    # directly, which the APIM key can't auth against (confirmed via
    # 401 during testing) — extract just the resultId and rebuild the
    # poll URL against the APIM gateway instead of following it as-is.
    operation_location = submit_resp.headers.get("Operation-Location")
    if not operation_location:
        raise RuntimeError(f"No Operation-Location header: {submit_resp.headers}")
    result_id = operation_location.split("?")[0].rstrip("/").split("/")[-1]

    base, _, query = analyze_url.partition("?")
    model_base = base.rsplit(":analyze", 1)[0]
    result_url = f"{model_base}/analyzeResults/{result_id}"
    if query:
        result_url += f"?{query}"

    poll_headers = {"Ocp-Apim-Subscription-Key": api_key}
    for _ in range(30):
        time.sleep(2)
        poll_resp = requests.get(result_url, headers=poll_headers)
        poll_resp.raise_for_status()
        result = poll_resp.json()
        if result.get("status") == "succeeded":
            break
        if result.get("status") == "failed":
            raise RuntimeError(f"Doc Intelligence failed: {result}")
    else:
        raise RuntimeError("Doc Intelligence timed out after 60s")

    words = []
    pages = result.get("analyzeResult", {}).get("pages", [])
    for page in pages:
        for word in page.get("words", []):
            content = word.get("content", "").strip()
            polygon = word.get("polygon", [])
            if not content or len(polygon) < 8:
                continue
            xs, ys = polygon[0::2], polygon[1::2]
            words.append({"text": content, "bbox_raw": (min(xs), min(ys), max(xs), max(ys))})
    return words, pages


def _is_likely_graphic_artifact(text: str) -> bool:
    """
    True for two DISTINCT patterns, both confirmed real OCR-misread cases:

    1. Same character repeated 2+ times — e.g. "III" (Mylan bar-icon
       logo misread), "||", "===".
    2. A SINGLE non-alphanumeric symbol — e.g. "®", "@", "©" — confirmed
       real case: the registered-trademark mark on a stylized logo
       (part decorative/outlined typography, not a clean text object)
       gets OCR'd as a lone "®" or misread as "@".

    Deliberately does NOT filter single alphanumeric characters (a lone
    "x" in "56 x", a lone digit) — those can be real content. Only a
    single character that is NEITHER a letter NOR a digit is treated as
    likely-decorative, since genuine body text essentially never
    consists of one bare symbol standing alone.

    Does NOT catch multi-character fragments like "COD" (a rotated-text
    OCR misread) — no safe pattern distinguishes that from genuine short
    text without risking false positives on real content. That class of
    artifact relies on the "source": "doc_intelligence" tag on the
    finding instead, so a reviewer can apply appropriate scrutiny rather
    than the tool silently guessing.

    This is a heuristic, not a certainty — every filtered item is still
    logged (see get_gap_rows_for_page), never silently dropped, so there's
    an audit trail if this needs to be reviewed or corrected later.
    """
    stripped = text.strip()
    if not stripped:
        return False
    if len(stripped) == 1:
        return not stripped.isalnum()
    return len(set(stripped)) == 1


def get_gap_rows_for_page(pdf_path: str, page_number: int, existing_lines: list, dpi: int = 200) -> list:
    """
    existing_lines: list of {"text":, "bbox":} already extracted by
    PyMuPDF for this page (PDF-point coordinates).

    Returns new row dicts (same schema as pdf_extractor.extract_lines's
    output) for DI-detected words with zero overlap against
    existing_lines — genuine gaps only, nothing already covered.
    """
    doc = fitz.open(pdf_path)
    page = doc[page_number]
    zoom = dpi / 72
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))

    tmp_img = os.path.join(os.path.dirname(pdf_path) or ".", f"_di_gapfill_tmp_p{page_number}.png")
    pix.save(tmp_img)
    try:
        words, di_pages = _call_di(tmp_img)
    finally:
        if os.path.exists(tmp_img):
            os.remove(tmp_img)

    if di_pages:
        unit_w = di_pages[0].get("width", pix.width)
        unit_h = di_pages[0].get("height", pix.height)
        scale_x = pix.width / unit_w if unit_w else 1
        scale_y = pix.height / unit_h if unit_h else 1
    else:
        scale_x = scale_y = 1

    new_rows = []
    for w in words:
        rx0, ry0, rx1, ry1 = w["bbox_raw"]
        px0, py0, px1, py1 = rx0 * scale_x, ry0 * scale_y, rx1 * scale_x, ry1 * scale_y
        pt_bbox = (px0 / zoom, py0 / zoom, px1 / zoom, py1 / zoom)

        if any(_boxes_overlap(pt_bbox, l["bbox"]) for l in existing_lines):
            continue  # already covered by PyMuPDF — not a real gap

        if _is_likely_graphic_artifact(w["text"]):
            logger.info(
                f"DI gap-fill: filtered likely graphic-icon misread "
                f"{w['text']!r} on page {page_number} of {pdf_path} — "
                f"not added as a text finding"
            )
            continue

        new_rows.append({
            "page": page_number,
            "text": w["text"],
            "bbox": pt_bbox,
            "min_size": None,
            "max_size": None,
            "rotation": 0.0,
            "has_real_position": True,
            "spans": [],  # no formatting data — Bold/Color checkers skip these rows
            "source": "doc_intelligence",
        })
    return new_rows


def augment_lines_with_di(pdf_path: str, lines_df: pd.DataFrame) -> pd.DataFrame:
    """
    Runs Doc Intelligence gap-fill across every page present in
    lines_df and returns lines_df with extra rows appended for genuine
    gaps only. Any per-page DI failure is logged and skipped — degrades
    to "no gap-fill on that page" rather than crashing the run.
    """
    doc = fitz.open(pdf_path)
    all_new_rows = []

    for page_number in range(len(doc)):
        page_lines = lines_df[lines_df["page"] == page_number][["text", "bbox"]].to_dict("records")
        try:
            new_rows = get_gap_rows_for_page(pdf_path, page_number, page_lines)
            if new_rows:
                logger.info(f"DI gap-fill: +{len(new_rows)} row(s) on page {page_number} of {pdf_path}")
            all_new_rows.extend(new_rows)
        except Exception as e:
            logger.info(f"DI gap-fill failed on page {page_number} of {pdf_path}: {e} — continuing without it")

    if not all_new_rows:
        return lines_df

    new_df = pd.DataFrame(all_new_rows, columns=lines_df.columns)
    return pd.concat([lines_df, new_df], ignore_index=True)
