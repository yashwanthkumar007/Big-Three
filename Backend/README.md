# GlobalVision Replace — Text Inspection Module

Internal artwork inspection tool, built to replicate and extend GlobalVision's Text Inspection module for pharmaceutical artwork compliance checking.

---
How Text Inspection works in GlobalVision:

You upload a master file (the approved/reference version) and a sample file (the new artwork to check).
It runs a character-by-character comparison inspecting each Unicode value between the two. 
SourceForge
It can catch up to 18 types of text errors — missing punctuation, font and color errors, inserted or deleted words, and more. 
GlobalVision
Results show up as an inspection report with a highlighted document containing red-numbered tags tied to each difference, viewable in-browser or downloadable as a PDF. 
Globalvision
Optionally it also compares embedded images, decodes/grades barcodes, and detects and translates Braille regions. 
Globalvision
It supports over 30 foreign languages with built-in dictionaries, including customizable brand dictionaries and medical dictionaries. 
GlobalVision
File types supported include Word, PDF, Excel, AI, PPTX, and more.

## Status

**Phase 1 — Text Inspection (Mode 1: Digital vs Digital)**
Core comparison engine built and validated against real Viatris artworks (carton and leaflet formats).

---

## What This Does

Compares a **Master** (approved reference) artwork PDF against a **Sample** (new/revised) artwork PDF, and flags:

- **Content changes** — text added, removed, or modified
- **Location changes** — text unchanged, but shifted position beyond a defined threshold
- **Font size compliance** — text below the minimum required size *(currently being reworked — see Known Issues)*

Output: a structured findings report (CSV), in a format comparable to GlobalVision's own Text Inspection results table.

---

## How It Works (High Level)

1. **Extract** — Pull all text, with position and font size, from both Master and Sample PDFs (PyMuPDF)
2. **Group** — Combine extracted spans into logical text blocks, to avoid false positives from line-wrapping differences between versions
3. **Match** — Find the optimal pairing between Master blocks and Sample blocks, using combined text-similarity + position scoring (Hungarian algorithm)
4. **Compare** — For each matched pair:
   - If text differs (after whitespace normalization) -> report as **Change**
   - If text is identical but position shifted beyond threshold -> report as **Location**
5. **Report** — Unmatched Master blocks are reported as **Deletion**; unmatched Sample blocks as **Insertion**

---

## Project Structure

```
GLOBAL_VISION_REPLACE/
|
|-- Data/
|   |-- Master/              # Approved reference artwork PDFs (not tracked in Git)
|   |-- Sample/               # New/revised artwork PDFs to check (not tracked in Git)
|   `-- Output/
|       |-- Reports/          # Generated CSV findings
|       |-- Annotated_PDFs/   # Reserved for future visual overlay output
|       `-- Images/           # Reserved for future rendered page images
|
|-- Notebooks/                 # Experimentation space (not tracked in Git)
|
|-- src/
|   |-- components/
|   |   |-- pdf_loader.py       # Opens and validates PDF files
|   |   |-- text_extractor.py   # Block-level text + position + font size extraction
|   |   |-- text_comparator.py  # Master vs Sample matching and comparison logic
|   |   `-- font_checker.py     # Minimum font-size compliance check (see Known Issues)
|   |
|   |-- pipelines/
|   |   `-- comparison_pipeline.py   # Orchestrates the full inspection flow
|   |
|   |-- __init__.py
|   |-- exception.py            # Custom error types
|   |-- logger.py                # Run logging (basis for future audit trail)
|   `-- utils.py                  # Shared constants/configuration
|
|-- artifacts/
|   |-- logs/                   # Timestamped run logs (not tracked in Git)
|   |-- temp/
|   `-- cache/
|
|-- application.py               # CLI entry point
|-- requirements.txt
|-- setup.py
|-- README.md                    # This file
|-- TECHNICAL_README.md           # Detailed file/function-level documentation
`-- .gitignore
```

---

## Setup

```bash
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

---

## Running a Comparison

```bash
python application.py --master "Data/Master/file.pdf" --sample "Data/Sample/file.pdf"
```

Reports are saved to `Data/Output/Reports/` by default (configurable via `--output`).

---

## Known Issues / In Progress

- **Font size checking is currently disconnected from the main pipeline.** The original approach (comparing each file against a fixed minimum threshold only) has been identified as insufficient — it does not catch cases where font size changed between Master and Sample but both remain above the minimum. A revised approach (span-level comparison within matched blocks) is planned but not yet implemented.
- **Word-level diff precision:** when a matched block changes, the full before/after block text is shown — the specific added/removed words within the block are not yet individually highlighted.
- **Position shift threshold** is currently set for testing/tuning (see `POSITION_SHIFT_THRESHOLD` in `src/utils.py`) and has not yet been validated against a representative set of real files to confirm it distinguishes genuine layout shifts from rendering-level noise.

---

## Not Yet Built (Future Phases)

- OCR-based extraction for scanned/photographed physical prints (Mode 2)
- Outlined/vector text detection and visual (SSIM-based) comparison fallback
- Visual overlay output (highlighted differences on rendered PDF)
- Layer (OCG) filtering to exclude non-print content (keyline, varnish, registration marks)
- Spot color / Pantone identification
- Case, Bold, Italic, Underline, Font Type, and Color difference detection
- Web-based reviewer interface

See `TECHNICAL_README.md` for full technical detail on each component and known limitations.

---

## Compliance Note

This module has not yet undergone formal Computer System Validation (URS, FRS, IQ/OQ/PQ). Current use is limited to internal development and evaluation — not for production compliance decisions.

python test_new_checkers.py --master "Data/Master/Test2 Master.pdf" --sample "Data/Sample/Test2 Sample.pdf"