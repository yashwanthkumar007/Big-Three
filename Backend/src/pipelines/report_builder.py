"""
Report builder — the bridge between the pipeline's findings (in PDF
point coordinates) and a web frontend (which needs pixel-space
coordinates matching a rendered image).

PATCHED: passes through the "source" field (pymupdf / doc_intelligence /
ocr_fallback) on every finding, so the web app and CSV can show which
engine detected each piece of text.
"""

import os
import fitz

REPORT_DPI = 150


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


def build_report(master_path: str, sample_path: str, result: dict, output_dir: str, dpi: int = REPORT_DPI) -> dict:
    os.makedirs(output_dir, exist_ok=True)

    master_doc = fitz.open(master_path)
    sample_doc = fitz.open(sample_path)
    num_pages = max(len(master_doc), len(sample_doc))

    pages = []
    for page_num in range(num_pages):
        page_info = {"page": page_num}
        if page_num < len(master_doc):
            m_img_path = os.path.join(output_dir, f"master_p{page_num}.png")
            w, h = render_page(master_path, page_num, m_img_path, dpi)
            page_info["master_image"] = m_img_path
            page_info["master_width"] = w
            page_info["master_height"] = h
        if page_num < len(sample_doc):
            s_img_path = os.path.join(output_dir, f"sample_p{page_num}.png")
            w, h = render_page(sample_path, page_num, s_img_path, dpi)
            page_info["sample_image"] = s_img_path
            page_info["sample_width"] = w
            page_info["sample_height"] = h
        pages.append(page_info)

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