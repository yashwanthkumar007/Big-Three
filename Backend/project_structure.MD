# MedInspectAI — Backend Project Structure

Scope note: this covers the **backend/pipeline only** (the part that does the
actual inspection). The UI (React/etc. rebrand of the GVW screens) is a
separate frontend project that calls this backend via `InspectionConfig`
JSON payloads — not included here.

Status key: `KEEP` (as-is) · `UPGRADE` (exists, needs changes) · `NEW` (doesn't exist yet) · `DELETE` (remove)

```
medinspectai-backend/
│
├── application.py                 UPGRADE — CLI entry point. Needs to accept
│                                   a config (JSON/CLI flags) and build an
│                                   InspectionConfig instead of running everything.
├── setup.py                       KEEP
├── requirements.txt                KEEP (add: python-barcode/pyzbar if doing
│                                   barcode decode, pytesseract only if OCR needed)
├── README.md                      KEEP — update name/usage
├── .gitignore                     KEEP — as-is, still correct
│
├── Data/
│   ├── Master/                    KEEP — input master files (gitignored)
│   ├── Sample/                    KEEP — input sample files (gitignored)
│   └── Output/
│       └── Reports/               KEEP — generated CSV/PDF reports (gitignored)
│
├── artifacts/
│   └── logs/                      KEEP — timestamped run logs (gitignored)
│
├── src/
│   ├── __init__.py
│   ├── config.py                  NEW — InspectionConfig dataclass. Single
│   │                               source of truth for every UI toggle.
│   │                               ALSO holds a nested SelectionConfig
│   │                               (crop/cross-out/underline/zones/
│   │                               table_zones/layers) — see components/
│   │                               selection.py below.
│   ├── exception.py                KEEP — as-is
│   ├── logger.py                   KEEP — as-is
│   ├── utils.py                    UPGRADE — keep existing constants
│   │                               (TEXT_WEIGHT, POSITION_*, thresholds),
│   │                               add any new ones checkers need
│   │
│   ├── components/                 Extraction + matching only. No diff logic here.
│   │   ├── __init__.py
│   │   ├── extractors/              NEW — one native parser per file format,
│   │   │   ├── __init__.py           ALL producing the same output schema:
│   │   │   │                        page, text, bbox, spans, has_real_position.
│   │   │   │                        This is the dispatch point — pick the
│   │   │   │                        right extractor by file extension.
│   │   │   ├── pdf_extractor.py      UPGRADE (was pdf_loader.py +
│   │   │   │                        text_extractor.py combined). PyMuPDF.
│   │   │   │                        has_real_position = True (real bbox).
│   │   │   │                        AI files are PDF-compatible — reuse
│   │   │   │                        this extractor for .ai too.
│   │   │   ├── docx_extractor.py     NEW — python-docx. No page geometry
│   │   │   │                        exists in the file itself, so
│   │   │   │                        has_real_position = False; bbox is a
│   │   │   │                        synthetic (paragraph_index, 0) tuple —
│   │   │   │                        document order, not real coordinates.
│   │   │   ├── xlsx_extractor.py     NEW — openpyxl. Cells DO have a fixed
│   │   │   │                        grid position, so has_real_position =
│   │   │   │                        True, bbox = (row, col) not (x, y).
│   │   │   ├── txt_extractor.py      NEW — plain text, line-based.
│   │   │   │                        has_real_position = False.
│   │   │   ├── rtf_extractor.py      NEW — has_real_position = False.
│   │   │   └── xml_extractor.py      NEW — element-order based.
│   │   │                            has_real_position = False.
│   │   │
│   │   ├── matcher.py               NEW — Hungarian assignment (matched_pairs,
│   │   │                            unmatched_master, unmatched_sample).
│   │   │                            Always runs regardless of filters selected.
│   │   │                            combined_score() now checks
│   │   │                            has_real_position on BOTH sides: if
│   │   │                            either side lacks real geometry, position
│   │   │                            weight drops to 0 and score is text
│   │   │                            similarity only — a synthetic bbox
│   │   │                            distance is meaningless, don't compute it.
│   │   ├── page_filter.py           NEW — applies Master Page(s) / Sample
│   │   │                            Page(s) selection before/after extraction.
│   │   └── selection.py             NEW — applies pre-inspection region
│   │                                masking BEFORE extraction/matching:
│   │                                • Crop — restrict extraction to one
│   │                                  bbox per page
│   │                                • Cross-out — drop spans inside these
│   │                                  bboxes from extraction entirely
│   │                                • Underline — force-include spans that
│   │                                  auto-detection would otherwise skip
│   │                                • Layers — filter by PDF OCG layer
│   │                                  name (PyMuPDF: page.get_optional_
│   │                                  content / doc.get_layers())
│   │                                Enforces the doc's own rules: Cross-out
│   │                                /Underline are mutually exclusive with
│   │                                Zones in the same file; must be applied
│   │                                before matcher.py ever sees the blocks.
│   │                                PDF-only for now (Crop/Zones assume real
│   │                                geometry) — document that limitation
│   │                                rather than pretending it works on DOCX.
│   │
│   ├── checkers/                   One function per Difference Filter checkbox.
│   │   ├── __init__.py              NEW — builds CHECKER_REGISTRY dict
│   │   │                            mapping UI label -> function. This is
│   │   │                            what enforces "only selected filters run."
│   │   ├── content.py               NEW — Change, Case
│   │   ├── whitespace.py            NEW — Space, Hyphen, Line Break (Space)
│   │   ├── formatting.py            NEW — Bold, Italic, Color, Font Type,
│   │   │                            Fonts (Mixed), Size, Sub/Super, Underline
│   │   │                            (all depend on text_extractor.py upgrade)
│   │   ├── position.py              NEW — Location (moved from old
│   │   │                            text_comparator.py, unchanged logic)
│   │   └── structure.py             NEW — Deletion, Insertion. Kept separate
│   │                                from the registry loop since these come
│   │                                from unmatched blocks, not matched pairs.
│   │
│   ├── features/                   Standalone subsystems — NOT diff filters.
│   │   ├── __init__.py              Each gated by its own top-level toggle,
│   │   │                            not the diff_filters list.
│   │   ├── template_mode.py         NEW — QRD mode. Locates official
│   │   │                            section headers in Master, compares
│   │   │                            header-to-header spans instead of raw
│   │   │                            blocks. Auto QRD =
│   │   │                            auto-cross-out headers before compare.
│   │   │                            Highlight Detection = treat highlighted
│   │   │                            (colored-background) spans in Sample as
│   │   │                            excluded, same effect as manual
│   │   │                            cross-out. Bold Font Detection = only
│   │   │                            flag bold diffs within template mode.
│   │   ├── language_mode.py         NEW — Default/Asian/RTL/Enhanced RTL.
│   │   │                            Changes normalization + comparison
│   │   │                            direction, not a separate checker.
│   │   ├── images.py                NEW — image block extraction + diffing.
│   │   │                            Nothing reusable from text pipeline.
│   │   ├── barcodes.py              NEW — decode + compare barcodes
│   │   │                            (None/Default/Rotated). Needs a barcode
│   │   │                            decode library, not PyMuPDF alone.
│   │   ├── braille.py               STUB — waiting on your next prompt with
│   │   │                            the Braille picklist options before
│   │   │                            structuring this properly.
│   │   ├── pdf_flags.py             NEW — Enable Overprint, Invisible Text.
│   │   │                            Reads PDF rendering-intent/span flags
│   │   │                            (PyMuPDF exposes invisible text via
│   │   │                            span flags — overprint is a color-space
│   │   │                            /separation concept, needs checking per
│   │   │                            PDF spec, not guaranteed available).
│   │   └── line_processing.py       NEW — Off/Underlines/Underlines+Tables.
│   │                                Affects how extractor groups
│   │                                table cells / underline runs.
│   │
│   ├── review/                     Stateful layer for Proofing Results —
│   │   ├── __init__.py              findings stop being flat CSV rows once
│   │   │                            a user starts reviewing them.
│   │   ├── models.py                NEW — Finding object: id, type, master,
│   │   │                            sample, bboxes, level, comment,
│   │   │                            group_id, is_duplicate
│   │   ├── levels.py                NEW — Level enum (None/Ignore All/
│   │   │                            Critical/Major/Minor) + predefined
│   │   │                            comment list; "Reviewed" default
│   │   │                            comment used by Ignore/Skip All
│   │   ├── grouping.py              NEW — collapses identical findings
│   │   │                            (same type+master+sample text) into one
│   │   │                            group w/ duplicate count, so Ignore/
│   │   │                            Skip All on one instance propagates
│   │   ├── resync.py                NEW — re-diffs a single finding on
│   │   │                            demand: drop if now identical,
│   │   │                            reclassify as Change if still
│   │   │                            different but doesn't match original
│   │   │                            finding type
│   │   └── change_grid.py           NEW — character-level diff + Unicode
│   │                                codepoint per char, for Change-type
│   │                                findings only (powers the Change Grid
│   │                                view)
│   │
│   ├── pipelines/
│   │   ├── __init__.py
│   │   └── comparison_pipeline.py   UPGRADE — orchestrator only. No diff
│   │                                logic lives here — calls: selection
│   │                                (crop/cross-out/underline/zones) →
│   │                                extractor → page_filter → matcher →
│   │                                checker registry loop → feature
│   │                                toggles (template/images/barcodes/
│   │                                braille) → review.grouping →
│   │                                report_builder. Table Zones run AFTER
│   │                                the full inspection, not inline with
│   │                                the rest — keep that ordering explicit.
│   │
│   └── reporting/
│       ├── __init__.py              NEW
│       └── report_builder.py        UPGRADE — now consumes review/ output
│                                    (findings + level/comment/group state),
│                                    not a flat findings list. Also where
│                                    the highlighted/red-numbered PDF report
│                                    generation would live if you build that
│                                    (GVW shows this in its report).
│
├── tests/                          NEW — real test suite, replaces the
│   ├── fixtures/                   loose root-level scripts.
│   │   └── (sample master/sample PDFs for repeatable tests)
│   ├── test_extractor.py            replaces old test_extraction.py
│   ├── test_matcher.py
│   └── test_checkers/
│       ├── test_content.py
│       ├── test_whitespace.py
│       ├── test_formatting.py
│       └── test_position.py
│
└── debug/                          OPTIONAL — keep exactly ONE debug
    └── debug_blocks.py              KEEP (moved here, out of src/) if you
                                     still want visual block-bbox debugging.
                                     Not part of the pipeline; never imported
                                     by src/.
```

## Files to DELETE (from your current structure)

| File | Why |
|---|---|
| `src/components/font_checker.py` | Not called anywhere in the pipeline; dead code |
| `test.py` (root) | Ad-hoc script, superseded by `tests/test_extractor.py` |
| `test_extraction.py` (root) | Same — move any useful assertions into `tests/` |
| `Notebooks/experiment.ipynb` | Already gitignored — fine to keep locally as scratch, just don't let it grow into "real" logic that only lives there |

## What NOT to build yet

- **`braille.py`** — leave as a stub (`raise NotImplementedError` or just skip) until you send the Braille picklist screenshots. No point guessing the option set.
- **Report PDF generation** (the highlighted/red-tag PDF GVW produces) — CSV via `report_builder.py` is enough for now; that's a bigger feature to design separately once findings output is stable.
- **OCR / Invisible-text-in-images** — only needed if you're matching GVW's "Verify OCR" feature; not implied by Text Inspection alone.
- **`review/resync.py`** — needs the rest of the pipeline (checkers + selection) stable first, since resync just re-runs that same logic on-demand for one finding. Build it last.
- **Table Zones in `selection.py`** — build Crop/Cross-out/Underline/Zones first (simpler, no ordering dependency); Table Zones has the "runs after full inspection" ordering constraint, so it's the riskiest one to get right — do it once the rest is proven.
- **Non-PDF extractors (`docx_extractor.py`, `xlsx_extractor.py`, etc.)** — get PDF↔PDF fully solid first (extraction, matching, all checkers). Add DOCX second, since it's the next most common Master format from your QRD example, and it's the one that forces you to actually implement the `has_real_position` fallback in `matcher.py`. Add the rest (RTF/XML/TXT) only as real files needing them show up.

## Why this shape works for "only run what's selected"

- `checkers/__init__.py`'s `CHECKER_REGISTRY` is the **only** place a diff-filter checkbox gets evaluated — the pipeline just loops over `config.diff_filters` and looks each one up. Nothing runs unless it's in that list.
- `features/*` are gated individually and separately from diff filters, because they're not per-block-pair comparisons — they're whole separate passes (images, barcodes, braille) or extraction-time behavior changes (language mode, line processing).
- `components/matcher.py` always runs — matching isn't optional, it's the prerequisite every checker depends on.
