"""
Report builder — the bridge between the pipeline's findings (in PDF
point coordinates) and a web frontend (which needs pixel-space
coordinates matching a rendered image).

PATCHED: passes through the "source" field (pymupdf / doc_intelligence /
ocr_fallback) on every finding, so the web app and CSV can show which
engine detected each piece of text.
"""

import os
import time
from concurrent.futures import ThreadPoolExecutor

import fitz

REPORT_DPI = 150

# Page rendering is the most expensive step of report building on
# large-format artwork PDFs (full-page rasterization + PNG encode at
# 150 DPI). Pages are rendered in parallel across worker threads — each
# task opens its OWN fitz Document, which is thread-safe (PyMuPDF only
# forbids sharing one Document across threads). Results, file names,
# image format, DPI and coordinate space are all unchanged.
RENDER_WORKERS = 4


def _scale_bbox(bbox, dpi=REPORT_DPI):
    if bbox is None:
        return None
    scale = dpi / 72
    x0, y0, x1, y1 = bbox
    return {
        "x": round(float(x0) * scale, 1),
        "y": round(float(y0) * scale, 1),
        "width": round((float(x1) - float(x0)) * scale, 1),
        "height": round((float(y1) - float(y0)) * scale, 1),
    }


def render_page(pdf_path: str, page_number: int, output_path: str, dpi: int = REPORT_DPI):
    doc = fitz.open(pdf_path)
    page = doc[page_number]
    zoom = dpi / 72
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    pix.save(output_path)
    return pix.width, pix.height


def fitz_page_count(pdf_path: str) -> int:
    doc = fitz.open(pdf_path)
    n = len(doc)
    doc.close()
    return n


def _render_job(pdf_path: str, page_number: int, output_path: str, dpi: int):
    """Thread-pool worker: renders one page and returns (page_num, side, w, h)."""
    side = "master" if "master" in os.path.basename(output_path) else "sample"
    w, h = render_page(pdf_path, page_number, output_path, dpi)
    return page_number, side, w, h


def build_report(master_path: str, sample_path: str, result: dict, output_dir: str, dpi: int = REPORT_DPI) -> dict:
    os.makedirs(output_dir, exist_ok=True)
    t0 = time.perf_counter()

    master_doc = fitz.open(master_path)
    sample_doc = fitz.open(sample_path)
    num_pages = max(len(master_doc), len(sample_doc))
    master_doc.close()
    sample_doc.close()

    # Build the render job list (same page count / images as before), then
    # run all renders in parallel instead of sequentially.
    jobs = []
    for page_num in range(num_pages):
        if page_num < fitz_page_count(master_path):
            jobs.append((master_path, page_num, os.path.join(output_dir, f"master_p{page_num}.png")))
        if page_num < fitz_page_count(sample_path):
            jobs.append((sample_path, page_num, os.path.join(output_dir, f"sample_p{page_num}.png")))

    rendered = {}
    if jobs:
        with ThreadPoolExecutor(max_workers=min(RENDER_WORKERS, len(jobs))) as pool:
            futures = [pool.submit(_render_job, *job, dpi) for job in jobs]
            for fut in futures:
                page_num, side, w, h = fut.result()
                rendered[(page_num, side)] = (w, h)

    pages = []
    for page_num in range(num_pages):
        page_info = {"page": page_num}
        if (page_num, "master") in rendered:
            w, h = rendered[(page_num, "master")]
            page_info["master_image"] = os.path.join(output_dir, f"master_p{page_num}.png")
            page_info["master_width"] = w
            page_info["master_height"] = h
        if (page_num, "sample") in rendered:
            w, h = rendered[(page_num, "sample")]
            page_info["sample_image"] = os.path.join(output_dir, f"sample_p{page_num}.png")
            page_info["sample_width"] = w
            page_info["sample_height"] = h
        pages.append(page_info)

    try:
        import logging
        logging.getLogger("src.logger").info(
            "[PERF] Report page rendering (%d pages, %d images, %d workers): %.2fs",
            num_pages, len(jobs), min(RENDER_WORKERS, max(len(jobs), 1)), time.perf_counter() - t0,
        )
    except Exception:
        pass

    findings_out = []
    for i, f in enumerate(result["findings"], 1):
        findings_out.append({
            "id": i,
            "type": f["type"],
            "master": f["master"],
            "sample": f["sample"],
            "comment": f["comment"],
            "page": int(f.get("page", 0)),
            "master_box": _scale_bbox(f.get("master_bbox"), dpi),
            "sample_box": _scale_bbox(f.get("sample_bbox"), dpi),
            "source": f.get("source", "pymupdf"),
            "barcode_type": f.get("barcode_type"),
            "decoded_value": f.get("decoded_value"),
            "grade": f.get("grade"),
        })

    # NOTE: grouped/suppressed Location shifts (dominant global page
    # realignment — see grouping.py) are intentionally NOT added to
    # findings_out. GVW's own reports show zero mention of the bulk
    # shift, not even a summary line, so this matches that behavior.
    # The raw data is still returned separately below (suppressed_shifts)
    # for audit/logging purposes — visible if needed, but never rendered
    # as rows in the findings table.
    suppressed_shifts = [
        {"shift": g["shift"], "count": g["count"]}
        for g in result.get("location_groups", [])
    ]

    return {"dpi": dpi, "pages": pages, "findings": findings_out, "suppressed_shifts": suppressed_shifts}