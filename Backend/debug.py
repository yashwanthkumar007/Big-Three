"""
Debug script — checks how much text PyMuPDF actually extracted from a
PDF BEFORE it reaches match_blocks(). Run this on Master and Sample
separately when a finding looks wrong, to rule out "the matcher is
buggy" vs "the extractor never saw this text in the first place."

What it checks per page:
  1. Does the page have a live text layer at all? (has_live_text)
  2. How many lines / words did PyMuPDF pull out?
  3. A rendered debug PNG with every extracted line boxed in green,
     so you can visually spot anything on the artwork that has NO
     green box around it — that's text the pipeline will never see,
     no matter how good the matcher/checkers are downstream.

Usage:
    python debug_extraction.py "Data/Master/file.pdf"
    python debug_extraction.py "Data/Master/file.pdf" --page 0 --dpi 150
"""

import sys
import os
import argparse
import fitz


def check_extraction(pdf_path: str, dpi: int = 150, out_dir: str = "debug_output", search_term: str = None, filter_exact: str = None):
    os.makedirs(out_dir, exist_ok=True)
    doc = fitz.open(pdf_path)
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]

    # Text dump — every string PyMuPDF's raw text layer and line extractor
    # found, so you can grep/search for a specific label (e.g. a table
    # heading) to confirm whether it's in the PDF's text layer at all,
    # or whether it's there but the line-grouping logic is dropping it.
    #
    # If filter_exact is set (e.g. "NA"), the dump only includes lines
    # whose extracted text matches EXACTLY — useful for checking how many
    # of a specific repeated value (like table cells all showing "NA")
    # actually made it through extraction, vs how many are visible in
    # the artwork image.
    suffix = f"_filter_{filter_exact}" if filter_exact else ""
    dump_path = os.path.join(out_dir, f"{base_name}_extracted_text{suffix}.txt")

    with open(dump_path, "w", encoding="utf-8") as f:
        for page_number, page in enumerate(doc):
            page_dict = page.get_text("dict")
            matches_on_page = []
            for block in page_dict["blocks"]:
                if "lines" not in block:
                    continue
                for line in block["lines"]:
                    text = "".join(sp["text"] for sp in line["spans"]).strip()
                    if not text:
                        continue
                    if filter_exact is not None and text != filter_exact:
                        continue
                    matches_on_page.append((text, line["bbox"]))

            if filter_exact is not None:
                f.write(f"\n===== PAGE {page_number} — {len(matches_on_page)} line(s) matching {filter_exact!r} =====\n")
                for text, bbox in matches_on_page:
                    f.write(f"{text!r}  bbox={tuple(round(v, 1) for v in bbox)}\n")
            else:
                f.write(f"\n===== PAGE {page_number} — raw get_text('text') =====\n")
                f.write(page.get_text("text"))
                f.write(f"\n===== PAGE {page_number} — line-level extraction (what the pipeline uses) =====\n")
                for text, bbox in matches_on_page:
                    f.write(text + "\n")

    print(f"\nText dump saved: {dump_path}")
    if filter_exact is not None:
        print(f"Only lines matching exactly {filter_exact!r} were included.")
        print("Compare the count above against how many you can visually count")
        print("in the artwork image (or the boxed debug PNG) — a mismatch means")
        print("some occurrences of that value were never extracted.")
    else:
        print("Open it and Ctrl+F / grep for the string you're checking.\n")

    if search_term:
        found_in_raw = any(search_term in page.get_text("text") for page in doc)
        print(f"Search term: {search_term!r}")
        print(f"Found in raw text layer (any page): {found_in_raw}")
        if not found_in_raw:
            print("  -> NOT in the PDF's text layer at all. This is likely vector-outlined")
            print("     text (converted to paths) — PyMuPDF cannot read it, and this is a")
            print("     genuine extraction gap, not a bug in the line-grouping logic.")
        else:
            print("  -> IS in the raw text layer. If it's still missing from the green-box")
            print("     debug image, the line-grouping logic is dropping it — different")
            print("     issue, not a fundamental PyMuPDF limitation.")
        print()

    print(f"\n{'=' * 90}")
    print(f"EXTRACTION CHECK: {pdf_path}")
    print(f"Pages: {len(doc)}")
    print(f"{'=' * 90}")

    for page_number, page in enumerate(doc):
        live_text = page.get_text("text").strip()
        has_live_text = len(live_text) > 0

        print(f"\n--- Page {page_number} ---")
        print(f"Has live text layer : {has_live_text}")

        if not has_live_text:
            print("  -> This page has ZERO extractable text. It will go through the")
            print("     OCR fallback path, NOT the normal PyMuPDF line extractor.")
            print("     Font/Bold/Color checks will NOT run on this page.")
            continue

        page_dict = page.get_text("dict")
        lines = []
        for block in page_dict["blocks"]:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                text = "".join(sp["text"] for sp in line["spans"]).strip()
                if text:
                    lines.append({"text": text, "bbox": line["bbox"]})

        words = page.get_text("words")

        print(f"Lines extracted     : {len(lines)}")
        print(f"Words extracted     : {len(words)}")

        if len(lines) == 0:
            print("  -> WARNING: page has a text layer per get_text('text'), but the")
            print("     dict-based line extractor found nothing. Check for weird")
            print("     block structures (e.g. text inside vector/clip groups).")

        # Render page + draw a box around every extracted line, so gaps
        # are visible at a glance.
        zoom = dpi / 72
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        out_png = os.path.join(out_dir, f"{base_name}_p{page_number}_extracted.png")
        pix.save(out_png)

        # Re-open with PyMuPDF drawing so we can overlay boxes, then re-save.
        overlay_doc = fitz.open()
        overlay_page = overlay_doc.new_page(width=pix.width, height=pix.height)
        overlay_page.insert_image(overlay_page.rect, filename=out_png)
        for line in lines:
            x0, y0, x1, y1 = line["bbox"]
            rect = fitz.Rect(x0 * zoom, y0 * zoom, x1 * zoom, y1 * zoom)
            overlay_page.draw_rect(rect, color=(0, 1, 0), width=1)
        overlay_pix = overlay_page.get_pixmap()
        overlay_pix.save(out_png)
        overlay_doc.close()

        print(f"Debug image saved   : {out_png}")
        print("  -> Open this PNG. Every extracted line has a GREEN box.")
        print("     Any visible text WITHOUT a green box was missed by extraction —")
        print("     that text will never reach the matcher or any checker.")

    doc.close()
    print(f"\n{'=' * 90}")
    print("Done. Review the PNGs in the debug_output folder before trusting")
    print("any Change/Deletion/Insertion finding on this file.")
    print(f"{'=' * 90}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check PyMuPDF text extraction completeness")
    parser.add_argument("pdf_path", help="Path to the PDF to check")
    parser.add_argument("--dpi", type=int, default=150, help="Render DPI for debug image (default 150)")
    parser.add_argument("--out", default="debug_output", help="Output folder for debug PNGs")
    parser.add_argument("--search", default=None, help="String to check for in the raw text layer, e.g. \"Date/Time of Creation\"")
    parser.add_argument("--filter", default=None, help="Only dump lines matching this exact text, e.g. NA")
    args = parser.parse_args()

    check_extraction(args.pdf_path, dpi=args.dpi, out_dir=args.out, search_term=args.search, filter_exact=args.filter)