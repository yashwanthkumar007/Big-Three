"""
Braille inspection v0.2 - Braille in artwork PDFs.

Sources of dots (tried in this order, per page):
  1. Braille FONT text (embedded CFF font; dots read from the glyph outlines)
  2. Vector dots on an optional-content LAYER whose name contains "braille"
Then one shared geometric analysis: dots -> rows/lines -> columns -> 6-dot cells
-> measurements -> decode with liblouis FROM THE DOT PATTERNS (not from any PDF text).

Usage:  python braille_inspect.py file.pdf [--lang English] [--layer braille] [--rotate auto|0|90|180|270]
"""
import argparse
import io
import math
import os
import statistics as st
import sys
import threading
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import pymupdf
from fontTools.agl import UV2AGL
from fontTools.cffLib import CFFFontSet
from fontTools.pens.recordingPen import DecomposingRecordingPen

PT_TO_MM = 25.4 / 72.0
LINK_MM = 15.0         # dots closer than this (single linkage) belong to the same Braille block

# Translation tables. None = no usable table yet. Verify each with a known test string.
LANGUAGE_TABLES = {
    "Danish": ["unicode.dis", "da-dk-g16.ctb"],          # da-dk-g08 decoded numbers wrongly
    "Dutch": ["unicode.dis", "nl-NL-g0.utb"],          # was nl-unicode.dis (a display table, gives garbage)
    "EBU": None,
    "English (UK)": ["unicode.dis", "en-gb-g1.utb"],
    "English": ["unicode.dis", "en-us-g1.ctb"],
    "Estonian": ["unicode.dis", "et-g0.utb"],
    "Faroese": None,                                    # no liblouis table found
    "Finnish": ["unicode.dis", "fi.utb"],
    "French (Antoine)": None,
    "French (Traditional)": ["unicode.dis", "fr-bfu-comp6.utb"],
    "Galician (Spain)": ["unicode.dis", "Es-Es-G0.utb"],   # Spanish table as a stand-in - confirm
    "German": ["unicode.dis", "de-g0.utb"],             # was de-de.dis (display table)
    "Greek": None,                                      # el.ctb decoded the test string oddly - needs checking
    "Greenlandic": None,                                # no liblouis table found
    "Hungarian": ["unicode.dis", "hu-hu-g1.ctb"],
    "Iceland": ["unicode.dis", "is.ctb"],
    "Irish (Gaelic)": ["unicode.dis", "ga-g1.utb"],
    "Italian": None,                                    # it-it-comp6 is computer braille (decodes abc as 123)
    "Kazakh": ["unicode.dis", "kk.utb"],
    "Latvian": ["unicode.dis", "Lv-Lv-g1.utb"],
    "Lithuanian": ["unicode.dis", "lt-6dot.utb"],
    "Maltese": ["unicode.dis", "mt.ctb"],
    "Norwegian": ["unicode.dis", "no-no-g1.ctb"],
    "Polish": ["unicode.dis", "Pl-Pl-g1.utb"],
    "Portuguese": ["unicode.dis", "pt-pt-g1.utb"],
    "Romanian": ["unicode.dis", "ro-g0.utb"],
    "Russian": ["unicode.dis", "ru.ctb"],               # was ru-unicode.dis (display table)
    "Serbian": ["unicode.dis", "sr-g1.ctb"],
    "Slovakian": ["unicode.dis", "sk-sk-g1.utb"],
    "Slovene": ["unicode.dis", "sl-si-g1.utb"],
    "Spanish": ["unicode.dis", "es-g1.ctb"],
    "Swedish": ["unicode.dis", "sv-g1.ctb"],
    "Turkish": ["unicode.dis", "tr-g1.ctb"],
    "UEB": ["unicode.dis", "en-ueb-g1.ctb"],
    "Ukrainian": ["unicode.dis", "uk.utb"],
    "Uzbek": ["unicode.dis", "uz-g1.utb"],
}


# =====================================================================
# Source 1: Braille font -> dots
# =====================================================================
def _dots_from_contours(pen_value, min_w):
    """Split a recorded glyph outline into contours; keep the big round ones above the baseline (= raised dots)."""
    contours, cur = [], None
    for op, args in pen_value:
        if op == "moveTo":
            cur = []
            contours.append(cur)
        cur.extend(p for p in args if p is not None)
    dots = []
    for c in contours:
        if not c:
            continue
        xs, ys = [p[0] for p in c], [p[1] for p in c]
        w, h, cy = max(xs) - min(xs), max(ys) - min(ys), (min(ys) + max(ys)) / 2
        # a raised dot is a big, round contour inside the cell; tiny 'empty position' markers are small,
        # and the label letters printed under the cell sit below the baseline (cy < 0)
        if w >= min_w and abs(w - h) <= 0.15 * w and cy > 0:
            dots.append(((min(xs) + max(xs)) / 2, cy, w))
    return dots


def _font_glyph_dots(doc, xref):
    """Return (glyphs, scale, cmap) or None. glyphs: glyph name -> [(x, y, width) of each dot] in font units;
    scale: font units -> em; cmap: unicode -> glyph name (None = use standard glyph names)."""
    _, ext, _, buf = doc.extract_font(xref)
    if not buf:
        return None
    if ext == "cff":                                              # bare CFF / Type1C
        cff = CFFFontSet()
        cff.decompile(io.BytesIO(buf), None)
        top = cff.topDictIndex[0]
        scale = top.FontMatrix[0] if hasattr(top, "FontMatrix") else 0.001
        glyphs = {}
        for name in top.CharStrings.keys():
            pen = DecomposingRecordingPen(None)
            top.CharStrings[name].draw(pen)
            glyphs[name] = _dots_from_contours(pen.value, 0.1 / scale)
        return glyphs, scale, None
    if ext in ("ttf", "otf"):                                     # TrueType / OpenType (glyf or CFF outlines)
        from fontTools.ttLib import TTFont
        tt = TTFont(io.BytesIO(buf))
        upem = tt["head"].unitsPerEm
        gs = tt.getGlyphSet()
        glyphs = {}
        for name in tt.getGlyphOrder():
            pen = DecomposingRecordingPen(gs)
            gs[name].draw(pen)
            glyphs[name] = _dots_from_contours(pen.value, 0.1 * upem)
        return glyphs, 1.0 / upem, (tt.getBestCmap() or {})
    return None


def _glyph_name(ch, glyphs, cmap):
    if cmap:
        g = cmap.get(ord(ch))
        if g in glyphs:
            return g
    return UV2AGL.get(ord(ch), ch)


AXIS_ROT = {(1, 0): 0, (0, 1): 90, (-1, 0): 180, (0, -1): 270}     # text direction -> rotation to read it


def dots_from_fonts(doc, page):
    fonts = {}
    for f in page.get_fonts(full=True):
        if "braille" in f[3].lower():
            r = _font_glyph_dots(doc, f[0])
            if r:
                fonts[f[3].split("+")[-1]] = r
            else:
                print(f"[warn] Braille font {f[3]}: font file type '{doc.extract_font(f[0])[1]}' cannot be read "
                      "(Type3 or not embedded) - not supported yet", file=sys.stderr)
    pools, missing = {}, {}
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            dx, dy = line["dir"]
            rot = AXIS_ROT.get((round(dx), round(dy))) if abs(abs(dx) + abs(dy) - 1) < 0.02 else None
            for span in line["spans"]:
                fname = span["font"].split("+")[-1]
                if fname not in fonts:
                    continue
                glyphs, scale, cmap = fonts[fname]
                k = span["size"] * scale
                pool = pools.setdefault((fname, rot), {"dots": [], "d": 0})
                for ch in span["chars"]:
                    gname = _glyph_name(ch["c"], glyphs, cmap)
                    if gname not in glyphs and not ch["c"].isspace():
                        missing.setdefault(fname, set()).add(ch["c"])
                    ox, oy = ch["origin"]
                    for gx, gy, gd in glyphs.get(gname, []):
                        # glyph x runs along the text direction, glyph y (up) is the direction rotated -90 deg
                        pool["dots"].append((ox + k * (gx * dx + gy * dy), oy + k * (gx * dy - gy * dx)))
                        pool["d"] = gd * k
    regions = []
    for (fname, rot), pool in pools.items():
        if not pool["dots"]:
            continue
        for g in cluster_points(pool["dots"], LINK_MM / PT_TO_MM):
            regions.append({"source": f"font {fname}", "dots": g, "d": pool["d"], "rot": rot,
                            "warn": (f"characters with no glyph in the font: {sorted(missing[fname])}"
                                     if fname in missing else None)})
    return regions


# =====================================================================
# Source 2: vector dots on a named layer
# =====================================================================
def _subpath_boxes(drawing):
    """Split a (possibly compound) path into its closed sub-paths; yield (cx, cy, w, h) of each."""
    subs, cur, last = [], [], None
    for it in drawing["items"]:
        if it[0] == "re":
            r = it[1]
            subs.append([(r.x0, r.y0), (r.x1, r.y1)])
            continue
        pts = [q for q in it[1:] if hasattr(q, "x")]
        if last is not None and math.hypot(pts[0].x - last.x, pts[0].y - last.y) > 0.05:
            subs.append(cur)
            cur = []
        cur.extend((q.x, q.y) for q in pts)
        last = pts[-1]
    if cur:
        subs.append(cur)
    for s in subs:
        xs, ys = [a for a, _ in s], [b for _, b in s]
        yield (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(xs) - min(xs), max(ys) - min(ys)


def cluster_points(pts, link_pt):
    """Single-linkage clusters of points (union-find over a KD-tree)."""
    from scipy.spatial import cKDTree
    parent = list(range(len(pts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, j in cKDTree(pts).query_pairs(link_pt):
        parent[find(i)] = find(j)
    groups = {}
    for i in range(len(pts)):
        groups.setdefault(find(i), []).append(pts[i])
    return list(groups.values())


def dots_from_layer(page, key="braille"):
    shapes = []
    for d in page.get_drawings():
        if key.lower() in (d.get("layer") or "").lower():
            shapes.extend(_subpath_boxes(d))
    if not shapes:
        return []
    (w0, h0), n = Counter((round(w, 1), round(h, 1)) for _, _, w, h in shapes).most_common(1)[0]
    if n < 4:
        return []
    dots = [(x, y) for x, y, w, h in shapes if abs(w - w0) <= 0.12 * w0 and abs(h - h0) <= 0.12 * h0]
    diam = (w0 + h0) / 2
    return [{"source": f"vector layer '{key}'", "dots": g, "d": diam, "rot": None, "warn": None}
            for g in cluster_points(dots, LINK_MM / PT_TO_MM) if len(g) >= 2]


def dots_from_shapes(page):
    """Last resort (no Braille font, no Braille layer): groups of identical round shapes that form a Braille grid."""
    groups = {}
    for d in page.get_drawings():
        if not d.get("fill"):
            continue
        fill = tuple(round(v, 2) for v in d["fill"])
        for cx, cy, w, h in _subpath_boxes(d):
            if 3 <= w <= 7 and abs(w - h) <= 0.15 * max(w, h):
                groups.setdefault((round(w, 1), round(h, 1), fill), []).append((cx, cy))
    best = None
    for (w, h, fill), pts in groups.items():
        if len(pts) < 8:
            continue
        blocks = [g for g in cluster_points(pts, LINK_MM / PT_TO_MM) if len(g) >= 4]
        ok = [g for g in blocks if (best_orientation(g, (w + h) / 2)[0] or {"fit": 0})["fit"] >= 0.98]
        n = sum(len(g) for g in ok)
        if n >= 8 and (best is None or n > best[0]):
            best = (n, w, h, fill, ok)
    if not best:
        return []
    n, w, h, fill, ok = best
    return [{"source": f"round shapes, fill {fill} - NOT on a Braille layer/font, please confirm it is Braille",
             "dots": g, "d": (w + h) / 2, "rot": None, "warn": None} for g in ok]


def drop_duplicates(regions):
    """The same Braille can be found twice (e.g. font text AND a layer); keep the first."""
    kept = []
    for r in regions:
        pts = r["dots"]
        dup = any(len(pts) == len(k["dots"]) and
                  all(any(abs(x - a) < 1.0 and abs(y - b) < 1.0 for a, b in k["dots"]) for x, y in pts)
                  for k in kept)
        if not dup:
            kept.append(r)
    return kept


# =====================================================================
# Shared geometric analysis
# =====================================================================
ROTATIONS = {0: lambda x, y: (x, y), 90: lambda x, y: (y, -x),
             180: lambda x, y: (-x, -y), 270: lambda x, y: (-y, x)}


def cluster1d(vals, tol):
    vals = sorted(vals)
    groups = [[vals[0]]]
    for v in vals[1:]:
        if v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [sum(g) / len(g) for g in groups]


def analyze(dots, d, rot):
    """Read `dots` as Braille after rotating by `rot`. Returns a dict (with 'fit' 0..1) or None."""
    pts = [ROTATIONS[rot](x, y) for x, y in dots]
    tol = 0.3 * d
    rows = cluster1d([p[1] for p in pts], tol)
    cols = cluster1d([p[0] for p in pts], tol)
    if len(rows) < 2 or len(cols) < 2:
        return None
    rgaps = [b - a for a, b in zip(rows, rows[1:])]
    pv = st.median([g for g in rgaps if g < 1.35 * min(rgaps)])         # dot-row pitch inside a line
    line_of, first_row, line = {}, {}, -1
    for i, y in enumerate(rows):
        if i == 0 or rgaps[i - 1] > 1.5 * pv:                           # bigger gap = next line
            line += 1
            first_row[line] = y
        line_of[i] = line
    ph = min(b - a for a, b in zip(cols, cols[1:]))                     # dot-column pitch inside a cell
    lefts, i = [], 0
    while i < len(cols):
        if i + 1 < len(cols) and abs(cols[i + 1] - cols[i] - ph) < tol:  # two columns ph apart = one cell
            lefts.append(cols[i])
            i += 2
        else:
            i += 1
    pitch = min(b - a for a, b in zip(lefts, lefts[1:])) if len(lefts) >= 2 else 2.4 * ph
    x0 = lefts[0] if lefts else cols[0]
    cells, bad = {}, 0
    for x, y in pts:
        ri = min(range(len(rows)), key=lambda r: abs(rows[r] - y))
        ln = line_of[ri]
        rrow = round((rows[ri] - first_row[ln]) / pv)
        k = round((x - x0) / pitch)
        off = x - x0 - k * pitch
        col = 0 if abs(off) < tol else (1 if abs(off - ph) < tol else None)
        if col is None or not 0 <= rrow <= 2:
            bad += 1
            continue
        cells.setdefault((ln, k), {})[col * 3 + rrow + 1] = (x, y)
    good = sum(len(c) for c in cells.values())
    bottom = sum(1 for c in cells.values() for n in c if n in (3, 6)) / max(good, 1)
    return {"rot": rot, "fit": good / len(pts), "bottom": bottom, "cells": cells, "ph": ph,
            "pv": pv, "pitch": pitch, "line_y": first_row, "bad": bad}


def best_orientation(dots, d, rotate="auto", known=None):
    if rotate == "auto" and known is not None:           # Braille set as text: direction is known, no guessing
        a = analyze(dots, d, known)
        if a:
            a["known"] = True
        return a, []
    if rotate != "auto":
        return analyze(dots, d, int(rotate)), []
    cands = [a for a in (analyze(dots, d, r) for r in ROTATIONS) if a]
    if not cands:
        return None, []
    top = max(c["fit"] for c in cands)
    ok = [c for c in cands if c["fit"] >= top - 0.02]
    ok.sort(key=lambda c: c["bottom"])       # upright text tends to use the bottom dot row least
    return ok[0], ok


def measure(a):
    cells, ph = a["cells"], a["ph"]
    mm = lambda v: round(st.mean(v) * PT_TO_MM, 2) if v else None
    dot_h, dot_v, cx = [], [], {}
    for key, c in cells.items():
        for r in range(3):
            if r + 1 in c and r + 4 in c:
                dot_h.append(c[r + 4][0] - c[r + 1][0])
        for base in (1, 4):
            for r in range(2):
                if base + r in c and base + r + 1 in c:
                    dot_v.append(abs(c[base + r + 1][1] - c[base + r][1]))
        cx[key] = st.mean(p[0] - (0 if n <= 3 else ph) for n, p in c.items())
    char_sp, word_sp = [], []
    lines = sorted({ln for ln, _ in cells})
    for ln in lines:
        ks = sorted(k for l2, k in cells if l2 == ln)
        for a_, b_ in zip(ks, ks[1:]):
            (char_sp if b_ - a_ == 1 else word_sp).append(cx[(ln, b_)] - cx[(ln, a_)])
    ys = [a["line_y"][ln] for ln in lines]
    return {"lines": len(lines), "characters": len(cells), "dots": sum(len(c) for c in cells.values()),
            "dot_h_mm": mm(dot_h), "dot_v_mm": mm(dot_v), "character_mm": mm(char_sp),
            "word_mm": mm(word_sp),
            "line_mm": mm([b - a for a, b in zip(ys, ys[1:])]) if len(ys) > 1 else 0.0}   # GV shows 0 for one line


DIGITS = {0x01: "1", 0x03: "2", 0x09: "3", 0x19: "4", 0x11: "5",
          0x0B: "6", 0x1B: "7", 0x13: "8", 0x0A: "9", 0x1A: "0"}      # dot patterns a-j -> 1-9,0
NUMBER_SIGN = 0x3C                                                    # dots 3456
SEPARATORS = {0x02: ",", 0x32: "."}                                   # dot 2 = comma, dots 256 = point

_LIBLOUIS_DATA_PATH_CONFIGURED = False


def _configure_liblouis_data_path(louis):
    global _LIBLOUIS_DATA_PATH_CONFIGURED
    if _LIBLOUIS_DATA_PATH_CONFIGURED:
        return

    library_path = getattr(louis.liblouis, "_name", None)
    if not library_path:
        return

    for directory in Path(library_path).resolve().parents:
        data_path = directory / "share"
        if (data_path / "liblouis" / "tables").is_dir():
            louis.liblouis.lou_setDataPath(os.fsencode(str(data_path)))
            _LIBLOUIS_DATA_PATH_CONFIGURED = True
            return


def _decode_word(cells, tables):
    """cells: list of 6-bit patterns for one word. Number sign + a-j patterns become digits directly
    (some liblouis tables have no number mode); everything else goes through the language table."""
    import louis

    _configure_liblouis_data_path(louis)
    out, i = "", 0
    while i < len(cells):
        if cells[i] == NUMBER_SIGN and i + 1 < len(cells) and cells[i + 1] in DIGITS:
            i += 1
            while i < len(cells):
                if cells[i] in DIGITS:
                    out += DIGITS[cells[i]]
                elif cells[i] in SEPARATORS and i + 1 < len(cells) and cells[i + 1] in DIGITS:
                    out += SEPARATORS[cells[i]]          # decimal comma / point stays in number mode
                else:
                    break
                i += 1
        else:
            j = i
            while j < len(cells) and not (cells[j] == NUMBER_SIGN and j + 1 < len(cells) and cells[j + 1] in DIGITS):
                j += 1
            out += louis.backTranslateString(tables, "".join(chr(0x2800 + c) for c in cells[i:j]))
            i = j
    return out


def decode(a, language):
    tables = LANGUAGE_TABLES.get(language)
    if not tables:
        raise ValueError(f"No liblouis table configured yet for: {language}")
    cells = a["cells"]
    kmin, kmax = min(k for _, k in cells), max(k for _, k in cells)
    out = []
    for ln in sorted({ln for ln, _ in cells}):
        pats = [sum(1 << (n - 1) for n in cells.get((ln, k), {})) for k in range(kmin, kmax + 1)]
        words, cur = [], []
        for pt in pats + [0]:
            if pt == 0:
                if cur:
                    words.append(_decode_word(cur, tables))
                    cur = []
            else:
                cur.append(pt)
        out.append(" ".join(words))
    return out


# =====================================================================
def find_regions(doc, page, layer):
    regs = dots_from_fonts(doc, page) + dots_from_layer(page, layer)
    if not regs:
        regs = dots_from_shapes(page)
    return drop_duplicates(regs)


def region_bbox(page, dots, diameter):
    """Return the full dot bounds in the same rotated point space as rendered pages."""
    radius = max(float(diameter), 0.0) / 2
    bounds = pymupdf.Rect(
        min(point[0] for point in dots) - radius,
        min(point[1] for point in dots) - radius,
        max(point[0] for point in dots) + radius,
        max(point[1] for point in dots) + radius,
    )
    return bounds * page.rotation_matrix


def pick_language(arg):
    langs = list(LANGUAGE_TABLES)
    if arg is None:
        print("\nAvailable languages:")
        for i, l in enumerate(langs, 1):
            print(f"{i}. {l}")
    while True:
        if arg is None:
            arg = input("\nSelect language number or language name: ").strip()
        if arg.isdigit() and 1 <= int(arg) <= len(langs):
            return langs[int(arg) - 1]
        match = next((l for l in langs if l.lower() == arg.lower()), None)
        if match:
            return match
        print(f"'{arg}' is not a valid choice - enter a number from 1 to {len(langs)} or a language name.")
        arg = None


def run_braille_inspection(
    master_path,
    sample_path=None,
    filters=None,
    braille_config=None,
):
    """Run the Braille analyzer through the shared inspection report contract."""
    config = {} if braille_config is None else braille_config
    if not isinstance(config, dict):
        raise ValueError("braille_config must be an object")

    requested_language = config.get("language", "English")
    if not isinstance(requested_language, str):
        raise ValueError("Braille language must be a string.")
    language_aliases = {
        "Faroese (Denmark)": "Faroese",
        "Icelandic": "Iceland",
    }
    language = language_aliases.get(requested_language, requested_language)
    if language not in LANGUAGE_TABLES or not LANGUAGE_TABLES[language]:
        raise ValueError(
            f"Braille translation is not configured for {requested_language}."
        )

    findings = []
    with pymupdf.open(master_path) as doc:
        for page_number, page in enumerate(doc):
            for region_index, region in enumerate(find_regions(doc, page, "braille"), 1):
                analysis, _alternatives = best_orientation(
                    region["dots"],
                    region["d"],
                    known=region.get("rot"),
                )
                if not analysis:
                    continue

                try:
                    translated = " ".join(decode(analysis, language))
                except ImportError as exc:
                    raise RuntimeError(
                        "Braille translation is unavailable because liblouis is not installed."
                    ) from exc

                measurements = measure(analysis)
                dots = region["dots"]
                findings.append(
                    {
                        "type": "Braille",
                        "master": translated or f"Braille region {region_index}",
                        "sample": "",
                        "comment": (
                            f"{measurements['lines']} lines, "
                            f"{measurements['characters']} characters, "
                            f"{measurements['dots']} dots; "
                            f"orientation {analysis['rot']} degrees "
                            f"({analysis['fit']:.0%} fit)."
                        ),
                        "page": page_number,
                        "master_bbox": region_bbox(page, dots, region["d"]),
                        "sample_bbox": None,
                        "source": region["source"],
                        "braille_metrics": measurements,
                    }
                )

    return {
        "metadata": {"language": requested_language},
        "findings": findings,
        "location_groups": [],
        "match_stats": {
            "matched_pairs": 0,
            "unmatched_master": len(findings),
            "unmatched_sample": 0,
        },
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", nargs="?", default=r"C:\Users\tejav\OneDrive\Braille Inspection\SampleArtwork.pdf",
                    help="PDF to inspect (defaults to SampleArtwork.pdf)")
    ap.add_argument("--lang")
    ap.add_argument("--layer", default="braille")
    ap.add_argument("--rotate", default="auto")
    args = ap.parse_args()
    language = pick_language(args.lang)
    print(f"\nSelected language: {language}")
    doc = pymupdf.open(args.pdf)
    print(f"Inspecting: {args.pdf}")
    found = False
    for pno, page in enumerate(doc):
        for i, reg in enumerate(find_regions(doc, page, args.layer), 1):
            found = True
            a, alts = best_orientation(reg["dots"], reg["d"], args.rotate, reg.get("rot"))
            print(f"\n--- page {pno + 1} | region {i} | {reg['source']} ---")
            if not a:
                print("could not read these dots as Braille (no lattice found)")
                continue
            for k, v in measure(a).items():
                print(f"{k:14s}: {v}")
            print(f"{'orientation':14s}: rotate {a['rot']} deg | fit {a['fit']:.0%} | unexplained dots {a['bad']}"
                  + (" | from text direction" if a.get("known") else "")
                  + (" | GUESSED between " + str([c['rot'] for c in alts]) if len(alts) > 1 else ""))
            if reg.get("warn"):
                print(f"{'WARNING':14s}: {reg['warn']}")
            try:
                tr = decode(a, language)
                print(f"{'translation':14s}:", " ".join(tr))
                print(f"{'table':14s}: {LANGUAGE_TABLES[language][1]}")
                if language != "English" and tr == decode(a, "English"):
                    print(f"{'note':14s}: same as English - this Braille only uses basic letters/digits, "
                          "which are identical in most languages (accented/special cells would differ)")
            except ImportError:
                print("translation   : liblouis not installed")
            except ValueError as e:
                print("translation   :", e)
    if not found:
        print("No Braille found (no Braille font and no vector layer matching '%s')." % args.layer)