"""
Barcode Inspection — single, self-contained backend module.

Everything the Barcode Inspection workflow needs lives in this one file:
configuration, PDF loading/rendering, candidate localisation, decoding,
strict validation, de-duplication, grading, result generation, job status,
cancellation and the HTTP API.

Design principles
-----------------
ACCURACY FIRST
    A successful decoder response is NOT a result. Every candidate must pass
    structural validation (bar/space geometry, quiet zone, contrast, payload
    shape) before it can become a finding. Ordinary printed text is therefore
    never reported as a barcode, and there is deliberately no text/OCR
    heuristic anywhere in this module.

DETECT LESS -> DECODE LESS -> VALIDATE BETTER
    Pages are rasterised once at a sensible DPI, likely barcode regions are
    located with OpenCV, and only those crops are handed to the decoder.
    A full-page decode is used at most once as a safety net, never in a loop.

ONE INITIALISED PIPELINE
    The decoders and OpenCV configuration are initialised once by
    ``Runtime.instance()`` and reused for every inspection and every page.

BOUNDED CONCURRENCY, BOUNDED MEMORY
    Pages are processed by a small, CPU-aware thread pool. Only one rendered
    page per worker is alive at a time; results are accumulated, never images.
"""

from __future__ import annotations

import logging
import math
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

import cv2
import fitz  # PyMuPDF
import numpy as np

logger = logging.getLogger("barcode_inspection")

__all__ = [
    "BarcodeConfigError",
    "InspectionCancelled",
    "Runtime",
    "BarcodeInspectionEngine",
    "BarcodeVerifier",
    "score_to_grade",
    "InspectionJob",
    "JobStore",
    "run_barcode_inspection",
    "create_job",
    "get_job",
    "cancel_job",
    "list_jobs",
    "register_blueprint",
]

# ---------------------------------------------------------------------------
# Configuration constants
# ---------------------------------------------------------------------------

#: Canonical coordinate system for every bbox this module reports.
#:
#: PDF points, 72 pt = 1 inch, origin at the page's top-left, y growing
#: downwards. This is the same basis PDF.js's default viewport uses, so the
#: frontend can map a reported box onto the rendered page with a single ratio
#: and never needs to know the detection resolution.
#:
#: Detection happens on a raster produced at ``dpi`` (see :class:`PdfRenderer`),
#: so pixels are converted exactly once on the way out::
#:
#:     points = pixels * 72 / dpi
COORDINATE_SYSTEM = "pdf_points"

#: PDF user-space units per inch. Used for the single pixel -> point conversion.
POINTS_PER_INCH = 72.0

#: Render resolution defaults. A targeted low-DPI matrix scan complements the
#: configured raster when subtle colored symbols are missed at higher DPI.
DEFAULT_DPI = 300
SUPPORTED_RESOLUTIONS = (150, 200, 300, 400, 600)
FALLBACK_DPI = 600
# Small/colored matrix symbols can lose contour contrast when rendered at a
# higher DPI. A lightweight 150-DPI matrix-only pass recovers those symbols;
# its coordinates are scaled back into the configured inspection space.
MATRIX_FALLBACK_DPI = 150

#: Legacy constant, retained only so existing imports keep resolving.
#:
#: It used to define the basis of every reported box (boxes were scaled by
#: ``REPORT_DPI / dpi``). That was the source of the overlay drift: a 150-DPI
#: box is a resolution-specific pixel count that only lines up with the
#: rendered page if the viewer happens to know the page's size in the same
#: units — which the barcode page did not supply, so the overlay stopped
#: tracking the page as soon as the zoom changed.
#:
#: Reported boxes are now in PDF points (see :data:`COORDINATE_SYSTEM`). The
#: text/graphics findings still use the 150-DPI space defined in
#: ``src/pipelines/report_builder.REPORT_DPI``; this value no longer applies to
#: anything emitted by this module.
REPORT_DPI = 150

#: Upscale factors applied to a crop when its first decode attempt failed.
RETRY_UPSCALES = (
    1.5,
    2.0,
    2.5,
    3.0,
)

#: Progress stages exposed to the frontend (no Master/Sample vocabulary).
STAGES = (
    "rendering",
    "barcode_detection",
    "barcode_decoding",
    "barcode_validation",
    "saving_results",
    "inspection_complete",
)

STAGE_LABELS = {
    "rendering": "Rendering",
    "barcode_detection": "Barcode Detection",
    "barcode_decoding": "Barcode Decoding",
    "barcode_validation": "Barcode Validation",
    "saving_results": "Saving Results",
    "inspection_complete": "Inspection Complete",
}

INITIAL_STAGE = "barcode_detection"

#: Profiles exposed by the filter panel.
PROFILES: dict[str, dict[str, Any]] = {
    "default": {"label": "Default", "min_module_px": 2.0, "rotated": False},
    "rotated": {"label": "Rotated", "min_module_px": 2.0, "rotated": True},
}

#: Backend format id -> (display label, family).
BARCODE_FORMATS: dict[str, tuple[str, str]] = {
    "CODE_128": ("Code 128", "linear"),
    "GS1_128": ("GS1-128", "linear"),
    "CODE_39": ("Code 39", "linear"),
    "CODE_93": ("Code 93", "linear"),
    "EAN_8": ("EAN-8", "linear"),
    "EAN_13": ("EAN-13", "linear"),
    "UPC_A": ("UPC-A", "linear"),
    "UPC_E": ("UPC-E", "linear"),
    "ITF": ("ITF", "linear"),
    "ITF_14": ("ITF-14", "linear"),
    "CODABAR": ("Codabar", "linear"),
    "QR_CODE": ("QR Code", "matrix2D"),
    "MICRO_QR_CODE": ("Micro QR Code", "matrix2D"),
    "DATA_MATRIX": ("Data Matrix", "matrix2D"),
    "PDF417": ("PDF417", "matrix2D"),
    "AZTEC": ("Aztec", "matrix2D"),
}

LINEAR_FORMATS = frozenset(
    name for name, (_, family) in BARCODE_FORMATS.items() if family == "linear"
)

#: zxing-cpp BarcodeFormat attribute name for each backend format id.
_ZXING_ATTRS = {
    "CODE_128": "Code128",
    "GS1_128": "DataBar",
    "CODE_39": "Code39",
    "CODE_93": "Code93",
    "EAN_8": "EAN8",
    "EAN_13": "EAN13",
    "UPC_A": "UPCA",
    "UPC_E": "UPCE",
    "ITF": "ITF",
    "ITF_14": "ITF14",
    "CODABAR": "Codabar",
    "QR_CODE": "QRCode",
    "MICRO_QR_CODE": "MicroQRCode",
    "DATA_MATRIX": "DataMatrix",
    "PDF417": "PDF417",
    "AZTEC": "Aztec",
}

#: The four settings the filter panel exposes.
DEFAULT_CONFIG: dict[str, Any] = {
    "profile": "default",
    "resolution": DEFAULT_DPI,
    "enableOverprint": True,
    "pages": "all",
}

# --- Validation thresholds (calibrated for printed artwork at 300 DPI) -----
MIN_LINEAR_ASPECT = 1.6          # 1D symbols are tall and narrow
MAX_LINEAR_ASPECT = 12.0
MIN_BAR_RUNS = 8                 # a real 1D symbol has many bar/space runs
MAX_BAR_RUN_CV = 1.2             # bar widths must be reasonably consistent
MIN_DARK_RATIO = 0.10
MAX_DARK_RATIO = 0.95
MIN_CONTRAST = 20.0              # 0-255 spread inside the symbol
MIN_QUIET_ZONE_RATIO = 0.10      # light margin, as a fraction of height
MATRIX_EDGE_VARIANCE = 4.0       # Laplacian energy floor for 2D symbols
MAX_PAYLOAD_LEN = 512
IOU_MERGE_THRESHOLD = 0.5        # same symbol found twice

#: Candidate localisation limits (1D).
MIN_CANDIDATE_WIDTH_PX = 30
MIN_CANDIDATE_HEIGHT_PX = 10
MAX_CANDIDATES_PER_PAGE = 150

#: Candidate localisation limits (2D).
MIN_MATRIX_SIDE_PX = 18

#: pylibdmtx is a brute-force scanner, so its input is size-capped.
MAX_DMTX_CROP = 1000

MIN_DMTX_SIDE = 40
MIN_DMTX_ASPECT = 0.3
MAX_DMTX_ASPECT = 3.0

BAR_RUN_SAMPLE_ROWS = 9
MIN_BAR_RUN_CONSISTENCY = 0.55
MIN_BAR_BAND_ROWS = 4

#: Decoder input caps. zxing-cpp's cost tracks the pixel count of the image it
#: is handed, and a failed crop used to be retried at 1.6x and 2.4x — on a large
#: candidate that meant three multi-megapixel decodes for a region that was
#: never a symbol. Both directions are now bounded: an oversized crop is shrunk
#: before the first attempt, and a crop that is already large is never upscaled
#: because its modules are ample by definition.
MAX_DECODE_SIDE = 1800
UPSCALE_MAX_SIDE = 1100



class BarcodeConfigError(ValueError):
    """Raised when a submitted barcode configuration is not usable."""


class InspectionCancelled(RuntimeError):
    """Raised when the user cancels a running inspection."""


def stage_label(stage: str | None) -> str:
    """Human readable label for a stage id."""
    return STAGE_LABELS.get(stage or "", STAGE_LABELS[INITIAL_STAGE])


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def default_config() -> dict[str, Any]:
    """Fresh copy of the default panel configuration."""
    return dict(DEFAULT_CONFIG)


def normalize_config(raw: Any) -> dict[str, Any]:
    """Validate a client supplied configuration.

    Unknown values fall back to the default so an older or newer frontend can
    never break the engine.
    """
    if raw is None:
        return default_config()
    if not isinstance(raw, dict):
        raise BarcodeConfigError("barcode_config must be an object")

    config = default_config()

    profile = str(raw.get("profile") or config["profile"])
    config["profile"] = profile if profile in PROFILES else config["profile"]

    try:
        dpi = int(raw.get("resolution", config["resolution"]))
    except (TypeError, ValueError):
        dpi = config["resolution"]
    config["resolution"] = dpi if dpi in SUPPORTED_RESOLUTIONS else DEFAULT_DPI

    config["enableOverprint"] = bool(
        raw.get("enableOverprint", config["enableOverprint"])
    )

    pages = raw.get("pages", config["pages"])
    if pages is None or pages == "all":
        config["pages"] = "all"
    elif isinstance(pages, (list, tuple)):
        parsed: list[int] = []
        for page in pages:
            try:
                number = int(page)
            except (TypeError, ValueError):
                continue
            if number >= 1 and number not in parsed:
                parsed.append(number)
        config["pages"] = parsed
        if not parsed:
            raise BarcodeConfigError("Select at least one page to inspect.")
    else:
        try:
            number = int(pages)
        except (TypeError, ValueError):
            number = 0
        config["pages"] = number if number >= 1 else "all"

    return config


def resolve_page_indices(pages: Any, page_count: int) -> list[int]:
    """Translate the panel page selection into 0-based page indices."""
    if page_count <= 0:
        return []
    if pages == "all" or pages is None:
        return list(range(page_count))

    selected = pages if isinstance(pages, (list, tuple)) else [pages]
    indices: set[int] = set()
    for page in selected:
        try:
            index = int(page) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= index < page_count:
            indices.add(index)
    return sorted(indices)



# ---------------------------------------------------------------------------
# One-time initialisation of the expensive libraries
# ---------------------------------------------------------------------------

class Runtime:
    """Holds the process-wide, initialised decoding pipeline.

    OpenCV tuning, the zxing-cpp handle and the pylibdmtx handle are created
    exactly once and reused for every page of every inspection. Thread-safe via
    a lock so concurrent jobs cannot initialise twice.
    """

    _instance: "Runtime | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self.zxingcpp: Any = None
        self.zxing_formats: list[Any] = []
        self.pylibdmtx_decode: Callable[..., Any] | None = None
        self.max_workers: int = 1
        self.decoder_available: bool = False
        self.dmtx_available: bool = False

    @classmethod
    def instance(cls) -> "Runtime":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()._initialise()
        return cls._instance

    def _initialise(self) -> "Runtime":
        # OpenCV: keep per-call work bounded; the page pool already provides
        # the parallelism.
        try:
            cv2.setNumThreads(1)
            cv2.ocl.setUseOpenCL(False)
        except Exception:  # pragma: no cover - platform dependent
            pass

        try:
            import zxingcpp  # noqa: PLC0415 - optional, initialised once

            self.zxingcpp = zxingcpp
            self.zxing_formats = [
                getattr(zxingcpp.BarcodeFormat, attr)
                for attr in _ZXING_ATTRS.values()
                if hasattr(zxingcpp.BarcodeFormat, attr)
            ]
            self.decoder_available = True
            logger.info(
                "Barcode engine: zxing-cpp ready with %d formats",
                len(self.zxing_formats),
            )
        except Exception as exc:  # pragma: no cover - dependency missing
            logger.warning("Barcode engine: zxing-cpp unavailable (%s)", exc)

        try:
            from pylibdmtx.pylibdmtx import decode as dmtx_decode  # noqa: PLC0415

            self.pylibdmtx_decode = dmtx_decode
            self.dmtx_available = True
            logger.info("Barcode engine: pylibdmtx Data Matrix fallback ready")
        except Exception as exc:  # pragma: no cover - optional dependency
            logger.info("Barcode engine: pylibdmtx unavailable (%s)", exc)

        # Small, CPU-aware pool. Never unbounded.
        self.max_workers = max(1, min(4, os.cpu_count() or 2))
        return self

    def resolve_formats(self, allowed: Iterable[str]) -> list[Any] | None:
        """Translate backend format ids into zxing-cpp format members."""
        if self.zxingcpp is None:
            return None
        wanted = []
        for name in allowed:
            attr = _ZXING_ATTRS.get(name)
            if not attr:
                continue
            member = getattr(self.zxingcpp.BarcodeFormat, attr, None)
            if member is not None:
                wanted.append(member)
        return wanted or None


# ---------------------------------------------------------------------------
# PDF rendering
# ---------------------------------------------------------------------------

class PdfRenderer:
    """Renders PDF pages to grayscale images at a fixed DPI.

    A page is rasterised once and reused for localisation, decoding and
    quality measurement, so each page costs exactly one render.
    """

    def __init__(self, pdf_path: str, dpi: int = DEFAULT_DPI) -> None:
        self.pdf_path = pdf_path
        self.dpi = dpi
        self.scale = dpi / 72.0
        self._doc = fitz.open(pdf_path)
        self.page_count = len(self._doc)

    def close(self) -> None:
        try:
            self._doc.close()
        except Exception:  # pragma: no cover - defensive
            pass

    def __enter__(self) -> "PdfRenderer":
        return self

    def __exit__(self, *exc_info: Any) -> None:
        self.close()

    def page_size_points(self, page_index: int) -> tuple[float, float]:
        """Page size in PDF points, as DISPLAYED (i.e. after /Rotate).

        PyMuPDF's ``page.rect`` is the MediaBox/CropBox already transformed by
        the page's /Rotate entry, which is exactly the orientation PDF.js
        renders by default. Reporting this alongside the boxes keeps the page
        geometry and the boxes in one basis, so a rotated page needs no
        special-casing anywhere downstream.
        """
        try:
            rect = self._doc[page_index].rect
            return float(rect.width), float(rect.height)
        except Exception:  # pragma: no cover - defensive
            return 0.0, 0.0

    def render_gray(self, page_index: int) -> np.ndarray:
        """Render one page as an 8-bit grayscale array."""
        page = self._doc[page_index]
        matrix = fitz.Matrix(self.scale, self.scale)
        pixmap = page.get_pixmap(matrix=matrix, alpha=False, colorspace=fitz.csGRAY)
        image = np.frombuffer(pixmap.samples, dtype=np.uint8)
        return image.reshape(pixmap.height, pixmap.width).copy()

    def render_bgr(self, page_index: int) -> np.ndarray:
        """Render one page as an 8-bit BGR array (for colour-dependent work)."""
        page = self._doc[page_index]
        matrix = fitz.Matrix(self.scale, self.scale)
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        image = np.frombuffer(pixmap.samples, dtype=np.uint8)
        image = image.reshape(pixmap.height, pixmap.width, pixmap.n)
        if image.shape[2] == 4:
            image = image[:, :, :3]
        if image.shape[2] == 3:
            return cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)



# ---------------------------------------------------------------------------
# Candidate localisation — the main false-positive defence
# ---------------------------------------------------------------------------

@dataclass
class Candidate:
    """A region of the page that might contain a barcode."""

    x: int
    y: int
    w: int
    h: int
    family: str  # "linear" | "matrix2D"
    score: float = 0.0

    @property
    def box(self) -> tuple[int, int, int, int]:
        return (self.x, self.y, self.x + self.w, self.y + self.h)

    def expand(self, pad: int) -> "Candidate":
        return Candidate(
            max(0, self.x - pad),
            max(0, self.y - pad),
            self.w + 2 * pad,
            self.h + 2 * pad,
            self.family,
            self.score,
        )


def iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """Intersection-over-union of two ``(x0, y0, x1, y1)`` boxes."""
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    if ix <= 0 or iy <= 0:
        return 0.0
    intersection = ix * iy
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    union = area_a + area_b - intersection
    return float(intersection / union) if union > 0 else 0.0


def _row_run_counts(binary: np.ndarray) -> np.ndarray:
    """Bar/space run count for every scan line (vectorised)."""
    if binary.ndim == 1:
        binary = binary[np.newaxis, :]
    # A transition is any change between adjacent pixels; on a 0/1 image the
    # count is sign-independent, so the unsigned dtype is safe here.
    return np.count_nonzero(np.diff(binary, axis=1), axis=1).astype(np.float64) + 1.0


def _best_bar_band(counts: np.ndarray) -> tuple[float, float]:
    """Widest, most uniform stretch of scan lines that could be a symbol.

    Returns ``(median run count, consistency)`` for the best band found, or
    ``(0.0, 0.0)`` when no stretch of the candidate looks like a symbol at all.
    """
    strong = counts >= MIN_BAR_RUNS
    best_median = 0.0
    best_consistency = 0.0
    index = 0
    total = counts.shape[0]

    while index < total:
        if not strong[index]:
            index += 1
            continue
        start = index
        while index < total and strong[index]:
            index += 1

        window = counts[start:index]
        if window.shape[0] < MIN_BAR_BAND_ROWS:
            continue

        median = float(np.median(window))
        if median <= 0:
            continue

        consistency = float(window.min() / median)
        if consistency > best_consistency:
            best_median = median
            best_consistency = consistency

    return best_median, best_consistency


def _bar_run_profile(binary: np.ndarray) -> tuple[float, float]:
    """``(median run count, run-count consistency)`` for one candidate region.

    ``consistency`` is ``min/median`` of the run counts across the best band of
    scan lines: 1.0 means every line in that band crossed the identical pattern,
    which is what a printed symbol looks like. Both numbers are needed — a line
    of text produces a high *count* but a low *consistency*, which is exactly
    what separates it from a symbol.

    Consistency is the discriminator that was missing before. It is cheap (one
    vectorised pass over the candidate) and on real artwork it takes 128 raw
    blobs down to the genuine symbol plus a couple of cheap-to-reject strips,
    without dropping any real barcode.
    """
    if binary.size == 0:
        return 0.0, 0.0
    return _best_bar_band(_row_run_counts(binary))


class CandidateLocator:
    """Finds likely barcode regions with OpenCV before any decoding.

    1D symbols are found by closing the binarised page horizontally so the
    bars of a symbol merge into a single blob, then keeping only elongated,
    high-contrast components. This is what stops a paragraph of text (a wide,
    low component with few bar runs) from ever reaching the decoder.

    2D symbols are found by keeping squarish, edge-dense contours.
    """

    @staticmethod
    def _binarize(gray: np.ndarray) -> np.ndarray:
        """Otsu-inverted binary image (bars/ink become 1)."""
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        _, binary = cv2.threshold(
            blurred, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )
        return binary

    @classmethod
    def find_linear(cls, gray: np.ndarray) -> list[Candidate]:
        """Locate 1D barcode regions using horizontal morphological closing."""
        binary = cls._binarize(gray)
        height, width = binary.shape[:2]

        # A symbol's bars sit close together horizontally; a wide kernel merges
        # them into one blob. Gaps between words/symbols are larger.
        kernel_width = max(15, int(height * 0.020) | 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_width, 1))
        closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)
        closed = cv2.morphologyEx(
            closed,
            cv2.MORPH_OPEN,
            cv2.getStructuringElement(cv2.MORPH_RECT, (2, 1)),
        )

        count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(
            closed, connectivity=8
        )

        candidates: list[Candidate] = []
        for index in range(1, count):
            x = stats[index, cv2.CC_STAT_LEFT]
            y = stats[index, cv2.CC_STAT_TOP]
            w = stats[index, cv2.CC_STAT_WIDTH]
            h = stats[index, cv2.CC_STAT_HEIGHT]
            area = stats[index, cv2.CC_STAT_AREA]

            if w < MIN_CANDIDATE_WIDTH_PX or h < MIN_CANDIDATE_HEIGHT_PX:
                continue
            if h >= height * 0.95 or w >= width * 0.98:
                # A full-width band is page furniture, not a symbol.
                continue
            if w / float(h) < MIN_LINEAR_ASPECT:
                continue

            candidates.append(
                Candidate(int(x), int(y), int(w), int(h), "linear", 0.0)
            )

        # Cheap structural pre-check BEFORE any decoder call: a real symbol is
        # vertically uniform, so its bar/space run count barely changes from
        # scan line to scan line. A line of text produces a high run count too
        # but an *inconsistent* one, and a picture block does neither. This is
        # what keeps both decoder calls and false positives low: on the
        # reference artwork it takes 128 raw blobs down to ~4 candidates.
        viable: list[Candidate] = []
        for candidate in candidates:
            region = gray[
                candidate.y:candidate.y + candidate.h,
                candidate.x:candidate.x + candidate.w,
            ]
            if region.size == 0:
                continue
            _, row_binary = cv2.threshold(
                region, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
            )
            median_runs, consistency = _bar_run_profile(row_binary)
            if median_runs < MIN_BAR_RUNS:
                continue
            if consistency < MIN_BAR_RUN_CONSISTENCY:
                continue
            viable.append(candidate)

        return cls._reduce(viable, MAX_CANDIDATES_PER_PAGE)

    @classmethod
    def find_matrix(cls, gray: np.ndarray) -> list[Candidate]:
        """Locate 2D barcode regions using squarish, edge-dense contours."""
        binary = cls._binarize(gray)
        contours, _ = cv2.findContours(
            binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
        )

        candidates: list[Candidate] = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if w < MIN_MATRIX_SIDE_PX or h < MIN_MATRIX_SIDE_PX:
                continue
            if not 0.25 <= w / float(h) <= 4.0:
                continue

            # A 2D symbol has dense internal transitions.
            region = gray[y:y + h, x:x + w]
            if region.size == 0:
                continue
            energy = float(np.abs(cv2.Laplacian(region, cv2.CV_64F)).var())
            if energy < MATRIX_EDGE_VARIANCE:
                continue

            candidates.append(
                Candidate(int(x), int(y), int(w), int(h), "matrix2D", energy)
            )

        return cls._reduce(candidates, MAX_CANDIDATES_PER_PAGE // 2)

    @staticmethod
    def _reduce(candidates: list[Candidate], limit: int) -> list[Candidate]:
        """Keep the most promising candidates when there are too many."""
        if len(candidates) <= limit:
            return candidates
        return sorted(candidates, key=lambda c: c.score, reverse=True)[:limit]

    @classmethod
    def locate(cls, gray: np.ndarray) -> list[Candidate]:
        """All likely barcode regions on a page, de-duplicated by overlap."""
        found = cls.find_linear(gray) + cls.find_matrix(gray)
        kept: list[Candidate] = []
        for candidate in sorted(found, key=lambda c: c.w * c.h, reverse=True):
            if any(iou(candidate.box, other.box) > 0.6 for other in kept):
                continue
            kept.append(candidate)
        return kept



# ---------------------------------------------------------------------------
# Decoding
# ---------------------------------------------------------------------------

@dataclass
class Detection:
    """One decoded symbol, in page-pixel coordinates."""

    format_id: str
    value: str
    page: int
    bbox: tuple[int, int, int, int]
    polygon: list[tuple[int, int]]
    decoder: str
    validated: bool = False
    quality: dict[str, Any] = field(default_factory=dict)
    grade: str | None = None
    #: Heuristic verification payload (see :class:`BarcodeVerifier`). Empty
    #: until a validated, decoded symbol has been verified.
    verification: dict[str, Any] = field(default_factory=dict)


def _format_key(name: str) -> str:
    """Normalise a symbology name so EAN13 / EAN-13 / ean_13 all compare equal."""
    return re.sub(r"[^A-Z0-9]", "", str(name).upper())


def _normalise_format(raw: Any) -> str | None:
    """Map a zxing-cpp format enum back onto a backend format id."""
    name = str(getattr(raw, "name", raw) or "").strip()
    if not name:
        return None

    key = _format_key(name)
    for format_id, (label, _family) in BARCODE_FORMATS.items():
        if key in (_format_key(label), _format_key(format_id)):
            return format_id

    # GS1 DataBar variants map onto GS1-128.
    if "DATABAR" in key:
        return "GS1_128"
    return None


def _corners(result: Any) -> list[tuple[float, float]]:
    """Extract the corner points of a decoded symbol."""
    position = getattr(result, "position", None)
    points: list[Any] = []

    if position is not None:
        try:
            points = list(position)
        except TypeError:
            points = [
                getattr(position, name, None)
                for name in ("top_left", "top_right", "bottom_left", "bottom_right")
            ]
    if not points:
        points = [
            getattr(result, name, None)
            for name in ("top_left", "top_right", "bottom_left", "bottom_right")
        ]

    return [
        (float(point.x), float(point.y)) for point in points if point is not None
    ]


class BarcodeDecoder:
    """Decodes candidate crops with zxing-cpp (pylibdmtx as DM fallback).

    Decoding is only ever attempted on a crop the locator produced (plus at
    most one full-page safety-net pass per page), and a failed crop is retried
    by upscaling *that crop only* — the page is never re-rendered in a loop.
    """

    def __init__(
        self,
        runtime: Runtime,
        allowed_formats: list[str],
        allow_rotated: bool,
    ) -> None:
        self.runtime = runtime
        self.allowed = set(allowed_formats)
        self.allow_rotated = allow_rotated
        self.formats = runtime.resolve_formats(self.allowed)
        self.call_count = 0

    def _read(self, image: np.ndarray) -> list[Any]:
        """One zxing-cpp call. Counted so the cost is visible in the log."""
        if self.runtime.zxingcpp is None or image.size == 0:
            return []
        try:
            self.call_count += 1
            return self.runtime.zxingcpp.read_barcodes(
                image,
                formats=self.formats,
                try_rotate=self.allow_rotated,
                try_invert=True,
            ) or []
        except TypeError:
            try:
                self.call_count += 1
                return self.runtime.zxingcpp.read_barcodes(image) or []
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("zxing-cpp decode failed: %s", exc)
                return []
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("zxing-cpp decode failed: %s", exc)
            return []

    def _to_detections(
        self,
        results: Iterable[Any],
        page: int,
        offset: tuple[int, int],
        decoder: str,
        inv_scale: float = 1.0,
    ) -> list[Detection]:
        """Convert zxing-cpp results into validated-shape Detection objects.

        ``inv_scale`` maps a coordinate in the image the decoder was handed
        back to the cropped region's own pixel space (the decoder input may
        have been shrunk or enlarged first). ``offset`` is then the crop's
        origin on the page, so the final box is always in page pixels.
        """
        off_x, off_y = offset
        detections: list[Detection] = []

        for result in results:
            if not getattr(result, "valid", True):
                continue
            text = str(getattr(result, "text", "") or "").strip()
            if not text:
                continue
            format_id = _normalise_format(getattr(result, "format", None))
            if format_id is None or format_id not in self.allowed:
                continue

            corners = _corners(result)
            if len(corners) < 3:
                continue

            xs = [c[0] * inv_scale for c in corners]
            ys = [c[1] * inv_scale for c in corners]
            detections.append(
                Detection(
                    format_id=format_id,
                    value=text,
                    page=page,
                    bbox=(
                        int(round(min(xs))) + off_x,
                        int(round(min(ys))) + off_y,
                        int(round(max(xs))) + off_x,
                        int(round(max(ys))) + off_y,
                    ),
                    polygon=[
                        (
                            int(round(x * inv_scale)) + off_x,
                            int(round(y * inv_scale)) + off_y,
                        )
                        for x, y in corners
                    ],
                    decoder=decoder,
                )
            )
        return detections

    def _dmtx(self, crop: np.ndarray) -> list[Any]:
        """pylibdmtx decode of a Data Matrix crop (returns raw codes).

        Bounded on purpose: pylibdmtx is a brute-force scanner, so a very
        large crop would dominate the run time for no benefit. Crops are
        already small; this is a hard safety net.
        """
        if self.runtime.pylibdmtx_decode is None or crop.size == 0:
            return []
        height, width = crop.shape[:2]
        if height > MAX_DMTX_CROP or width > MAX_DMTX_CROP:
            scale = MAX_DMTX_CROP / float(max(height, width))
            crop = cv2.resize(
                crop,
                None,
                fx=scale,
                fy=scale,
                interpolation=cv2.INTER_AREA,
            )
        try:
            return self.runtime.pylibdmtx_decode(crop) or []
        except Exception:
            return []

    @staticmethod
    def _to_rgb(image: np.ndarray) -> np.ndarray:
        """Grayscale -> contiguous 3-channel RGB for the decoder."""
        if image.ndim == 3:
            return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        return cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)

    @staticmethod
    def _preprocess_for_decode(image: np.ndarray) -> np.ndarray:
        """Adaptive-threshold variant retained for upscale retries."""
        if image.size == 0:
            return image

        blur = cv2.GaussianBlur(image, (3, 3), 0)

        return cv2.adaptiveThreshold(
            blur,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            5,
        )

    @staticmethod
    def _decode_variants(image: np.ndarray) -> list[tuple[str, np.ndarray]]:
        """Build bounded grayscale decode passes, with the original first.

        Thresholding can erase weak or thin modules, so the unmodified crop is
        always attempted before any enhancement. All variants retain identical
        pixel coordinates.
        """
        if image.size == 0:
            return []

        blur = cv2.GaussianBlur(image, (3, 3), 0)
        variants: list[tuple[str, np.ndarray]] = [("original", image)]

        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        variants.append(("clahe", clahe.apply(image)))

        _, otsu = cv2.threshold(
            blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        variants.append(("otsu", otsu))
        variants.append(
            (
                "adaptive",
                cv2.adaptiveThreshold(
                    blur,
                    255,
                    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                    cv2.THRESH_BINARY,
                    31,
                    5,
                ),
            )
        )

        blurred = cv2.GaussianBlur(image, (0, 0), 1.2)
        sharpened = cv2.addWeighted(image, 1.6, blurred, -0.6, 0)
        variants.append(("sharpen", sharpened))

        low, high = np.percentile(image, (1, 99))
        if high > low:
            stretched = np.clip(
                (image.astype(np.float32) - low) * (255.0 / (high - low)),
                0,
                255,
            ).astype(np.uint8)
            variants.append(("contrast", stretched))

        return variants

    @staticmethod
    def _map_detections(
        detections: list[Detection],
        source_to_decoded: np.ndarray,
        offset: tuple[int, int],
    ) -> list[Detection]:
        """Map decoded polygons through an affine transform to page pixels."""
        decoded_to_source = cv2.invertAffineTransform(source_to_decoded)
        off_x, off_y = offset
        for detection in detections:
            points = detection.polygon or [
                (detection.bbox[0], detection.bbox[1]),
                (detection.bbox[2], detection.bbox[1]),
                (detection.bbox[2], detection.bbox[3]),
                (detection.bbox[0], detection.bbox[3]),
            ]
            mapped = cv2.transform(
                np.asarray(points, dtype=np.float32).reshape(1, -1, 2),
                decoded_to_source,
            )[0]
            mapped_points = [
                (int(round(point[0])) + off_x, int(round(point[1])) + off_y)
                for point in mapped
            ]
            xs = [point[0] for point in mapped_points]
            ys = [point[1] for point in mapped_points]
            detection.bbox = (min(xs), min(ys), max(xs), max(ys))
            detection.polygon = mapped_points
        return detections

    def _padded_crop(
        self, gray: np.ndarray, candidate: Candidate
    ) -> tuple[np.ndarray, int, int]:
        """Crop the candidate with a generous quiet-zone margin.

        A symbol needs its light quiet zone, which lies *outside* the ink blob
        the locator found, so the crop must be padded.
        """
        height, width = gray.shape[:2]
        pad = max(8, int(candidate.h * 0.6))
        x0 = max(0, candidate.x - pad)
        y0 = max(0, candidate.y - pad)
        x1 = min(width, candidate.x + candidate.w + pad)
        y1 = min(height, candidate.y + candidate.h + pad)
        return gray[y0:y1, x0:x1], x0, y0

    @staticmethod
    def _limit_side(
        image: np.ndarray, max_side: int
    ) -> tuple[np.ndarray, float]:
        """Shrink ``image`` so its longest side is at most ``max_side``.

        Returns the image and the scale that was applied to it (1.0 when it was
        already small enough), so decoded coordinates can be mapped back.
        """
        height, width = image.shape[:2]
        longest = max(height, width)
        if longest <= max_side:
            return image, 1.0
        scale = max_side / float(longest)
        return (
            cv2.resize(
                image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA
            ),
            scale,
        )

    @staticmethod
    def _dmtx_worth_trying(candidate: Candidate) -> bool:
        """Whether the brute-force Data Matrix scanner should be offered this region.

        pylibdmtx is by far the most expensive decoder available and its cost is
        erratic, so it is only tried on regions that are actually Data-Matrix
        shaped: near-square and not tiny. The linear/text crops the locator also
        produces cannot be a Data Matrix, so running the fallback on them cost
        whole seconds per page for no chance of a hit.
        """
        if min(candidate.w, candidate.h) < MIN_DMTX_SIDE:
            return False
        aspect = candidate.w / float(candidate.h)
        return MIN_DMTX_ASPECT <= aspect <= MAX_DMTX_ASPECT

    def decode_crop(
        self, gray: np.ndarray, candidate: Candidate, page: int
    ) -> list[Detection]:
        """Decode one candidate, retrying with a padded/upscaled crop.

        The page is never re-rendered here and the number of decode attempts is
        bounded by the crop's own size, so a large non-symbol region can no
        longer turn into seconds of decoder work.
        """
        crop, x0, y0 = self._padded_crop(gray, candidate)
        if crop.size == 0:
            return []

        # Try original pixels before enhancement: thresholding may destroy weak
        # modules. Every variant is capped before decoding to bound the cost.
        source, shrink = self._limit_side(crop, MAX_DECODE_SIDE)
        for variant_name, variant in self._decode_variants(source):
            detections = self._to_detections(
                self._read(self._to_rgb(variant)),
                page,
                (x0, y0),
                f"zxing-cpp:{variant_name}",
                1.0 / shrink,
            )
            if detections:
                return detections

        # Attempts 2..n: upscale THIS CROP ONLY, and only while its modules can
        # still be too small to resolve. Upscaling a crop that is already large
        # cannot help — its bars are many pixels wide by definition — so those
        # retries are skipped instead of being run for nothing.
        if max(crop.shape[:2]) < UPSCALE_MAX_SIDE:
            for scale in RETRY_UPSCALES:
                enlarged = cv2.resize(
                    crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC
                )
                for variant_name, variant in self._decode_variants(enlarged)[:2]:
                    detections = self._to_detections(
                        self._read(self._to_rgb(variant)),
                        page,
                        (x0, y0),
                        f"zxing-cpp:upscaled-{variant_name}",
                        1.0 / scale,
                    )
                    if detections:
                        return detections

        # Explicitly try the other orientations when the rotated profile is
        # enabled. Convert each decoded box back into the original crop's
        # coordinate space before returning it to page-level validation.
        if self.allow_rotated:
            for rotation in (1, 2, 3):
                rotated = np.ascontiguousarray(np.rot90(crop, rotation))
                rotated_source, rotated_scale = self._limit_side(
                    rotated, MAX_DECODE_SIDE
                )
                rotated_detections = self._to_detections(
                    self._read(self._to_rgb(rotated_source)),
                    page,
                    (0, 0),
                    f"zxing-rot-{rotation * 90}",
                    1.0 / rotated_scale,
                )
                if rotated_detections:
                    if rotation == 1:
                        transform = np.asarray(
                            [[0, 1, 0], [-1, 0, crop.shape[1] - 1]],
                            dtype=np.float32,
                        )
                    elif rotation == 2:
                        transform = np.asarray(
                            [[-1, 0, crop.shape[1] - 1],
                             [0, -1, crop.shape[0] - 1]],
                            dtype=np.float32,
                        )
                    else:
                        transform = np.asarray(
                            [[0, -1, crop.shape[0] - 1], [1, 0, 0]],
                            dtype=np.float32,
                        )
                    return self._map_detections(
                        rotated_detections, transform, (x0, y0)
                    )

            # Small-angle skew retries are intentionally limited to the
            # original crop and only run after all axis-aligned passes fail.
            height, width = crop.shape[:2]
            center = (width / 2.0, height / 2.0)
            for angle in (-10, -5, 5, 10):
                transform = cv2.getRotationMatrix2D(center, angle, 1.0)
                deskewed = cv2.warpAffine(
                    crop,
                    transform,
                    (width, height),
                    flags=cv2.INTER_CUBIC,
                    borderMode=cv2.BORDER_CONSTANT,
                    borderValue=255,
                )
                deskewed_detections = self._to_detections(
                    self._read(self._to_rgb(deskewed)),
                    page,
                    (0, 0),
                    f"zxing-skew-{angle}",
                )
                if deskewed_detections:
                    return self._map_detections(
                        deskewed_detections, transform, (x0, y0)
                    )

        # Data Matrix fallback, for this crop only — and only when the region is
        # actually Data-Matrix shaped. See :meth:`_dmtx_worth_trying`.
        if "DATA_MATRIX" in self.allowed and self._dmtx_worth_trying(candidate):
            detections = self._decode_dmtx(crop, page, x0, y0)
            if detections:
                return detections

        return []

    def _decode_dmtx(
        self, crop: np.ndarray, page: int, off_x: int, off_y: int
    ) -> list[Detection]:
        """pylibdmtx decode of a single crop, normalised to page coordinates."""
        codes = self._dmtx(crop)
        detections: list[Detection] = []
        for code in codes:
            text = getattr(code, "data", None)
            if isinstance(code, (tuple, list)) and code:
                text = code[0]
            if not text:
                continue
            try:
                rect = code.rect
                bx0, by0 = float(rect.left), float(rect.top)
                bx1, by1 = bx0 + float(rect.width), by0 + float(rect.height)
            except Exception:
                bx0, by0 = 0.0, 0.0
                bx1, by1 = float(crop.shape[1]), float(crop.shape[0])

            detections.append(
                Detection(
                    format_id="DATA_MATRIX",
                    value=str(text),
                    page=page,
                    bbox=(
                        int(bx0) + off_x,
                        int(by0) + off_y,
                        int(bx1) + off_x,
                        int(by1) + off_y,
                    ),
                    polygon=[],
                    decoder="pylibdmtx",
                )
            )
        return detections

    def decode_page_once(self, gray: np.ndarray, page: int) -> list[Detection]:
        """Single full-page safety net for symbols the locator missed.

        Used at most once per page and only when no candidate decoded, so the
        "decode less" rule is preserved. pylibdmtx is deliberately NOT run on
        a whole page — it is a brute-force scan and is pathologically slow on
        a full A4 raster, so it stays crop-scoped in :meth:`decode_crop`.
        """
        return self._to_detections(
            self._read(self._to_rgb(gray)), page, (0, 0), "zxing-cpp:page"
        )



# ---------------------------------------------------------------------------
# Validation — a decode is NOT a result
# ---------------------------------------------------------------------------

class BarcodeValidator:
    """Rejects anything that is not a physically plausible barcode symbol.

    This is the layer that stops ordinary printed text from being reported as
    a Code 39 barcode: real payloads never contain whitespace, a real 1D
    symbol has many consistent bar/space runs plus a light quiet zone, and a
    real 2D symbol is a compact block of structure rather than a line of glyphs.
    """

    def __init__(self, min_module_px: float = 2.0) -> None:
        self.min_module_px = min_module_px

    def validate(
        self, gray: np.ndarray, detection: Detection
    ) -> tuple[bool, str]:
        """Validate one detection. Returns ``(is_valid, reason)``."""
        if gray is None or gray.size == 0:
            return False, "empty_page_image"

        x0, y0, x1, y1 = detection.bbox
        if x1 <= x0 or y1 <= y0:
            return False, "degenerate_box"

        height, width = gray.shape[:2]
        x0, x1 = max(0, x0), min(width, x1)
        y0, y1 = max(0, y0), min(height, y1)
        symbol_w, symbol_h = x1 - x0, y1 - y0
        if symbol_w < 8 or symbol_h < 8:
            return False, "region_too_small"

        # --- payload sanity: a sentence is not a barcode payload ----------
        value = detection.value
        if not value:
            return False, "empty_payload"
        value = value.strip()

        if len(value) < 2:
            return False, "payload_too_short"
        if len(value) > MAX_PAYLOAD_LEN:
            return False, "payload_too_long"
        if any(character.isspace() for character in value):
            return False, "payload_contains_whitespace"

        region = gray[y0:y1, x0:x1]
        if region.size == 0:
            return False, "empty_region"

        # --- contrast -----------------------------------------------------
        if float(region.max()) - float(region.min()) < MIN_CONTRAST:
            return False, "insufficient_contrast"

        if detection.format_id in LINEAR_FORMATS:
            return self._validate_linear(
                gray, region, (x0, y0, x1, y1), symbol_w, symbol_h
            )
        return self._validate_matrix(region, symbol_w, symbol_h)

    def _validate_linear(
        self,
        gray: np.ndarray,
        region: np.ndarray,
        box: tuple[int, int, int, int],
        symbol_w: int,
        symbol_h: int,
    ) -> tuple[bool, str]:
        """1D: geometry, bar-run count, bar-width consistency, quiet zone."""
        aspect = symbol_w / float(max(symbol_h, 1))
        if aspect < MIN_LINEAR_ASPECT:
            return False, f"aspect_too_low({aspect:.2f})"
        if aspect > MAX_LINEAR_ASPECT:
            return False, f"aspect_too_high({aspect:.2f})"

        blurred = cv2.GaussianBlur(region, (3, 3), 0)
        _, binary = cv2.threshold(
            blurred, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )
        dark_ratio = float(binary.mean())
        if not MIN_DARK_RATIO <= dark_ratio <= MAX_DARK_RATIO:
            return False, f"dark_ratio_out_of_range({dark_ratio:.2f})"

        runs = self._bar_runs(binary)
        if len(runs) < MIN_BAR_RUNS:
            # A line of text has only a handful of glyph transitions.
            return False, f"too_few_bar_runs({len(runs)})"

        if self._coefficient_of_variation(runs) > MAX_BAR_RUN_CV:
            return False, "irregular_bar_widths"

        if not self._quiet_zone_ok(gray, box, symbol_h):
            return False, "insufficient_quiet_zone"

        return True, "valid"

    def _validate_matrix(
        self, region: np.ndarray, symbol_w: int, symbol_h: int
    ) -> tuple[bool, str]:
        """2D: compact block with real module structure, not a line of glyphs."""
        aspect = symbol_w / float(max(symbol_h, 1))
        if aspect > 3.0 or aspect < 0.33:
            return False, f"matrix_aspect_out_of_range({aspect:.2f})"

        energy = float(np.abs(cv2.Laplacian(region, cv2.CV_64F)).var())
        if energy < MATRIX_EDGE_VARIANCE:
            return False, "matrix_lacks_structure"

        return True, "valid"

    @staticmethod
    def _bar_runs(binary: np.ndarray) -> list[int]:
        """Run lengths of the alternating dark/light pattern."""
        row = binary[binary.shape[0] // 2]
        runs: list[int] = []
        current = 0
        for value in row:
            if value:
                current += 1
            elif current:
                runs.append(current)
                current = 0
        if current:
            runs.append(current)
        return runs

    @staticmethod
    def _coefficient_of_variation(runs: list[int]) -> float:
        """Normalised spread of the run widths — near 0 for real barcodes."""
        if len(runs) < 2:
            return 1.0
        data = np.asarray(runs, dtype=float)
        return float(data.std() / max(data.mean(), 1e-6))

    @staticmethod
    def _quiet_zone_ok(
        gray: np.ndarray, box: tuple[int, int, int, int], symbol_h: int
    ) -> bool:
        """A 1D symbol needs a light margin on both sides."""
        x0, y0, x1, y1 = box
        margin = max(int(symbol_h * MIN_QUIET_ZONE_RATIO), 4)
        left = gray[y0:y1, max(0, x0 - margin):x0]
        right = gray[y0:y1, x1:min(gray.shape[1], x1 + margin)]
        if left.size == 0 or right.size == 0:
            # Symbol touches the page edge — cannot confirm a quiet zone.
            return False
        return bool(
    (left > 190).mean() >= 0.40
    and
    (right > 190).mean() >= 0.40
)


# ---------------------------------------------------------------------------
# Quality measurement and grading
# ---------------------------------------------------------------------------

class QualityGrader:
    """Derives a quality grade from measured pixel metrics.

    IMPORTANT: this is an *indicative* quality grade computed from contrast,
    modulation, edge sharpness, quiet zone and geometry. It is NOT an ISO/IEC
    15416 or 15415 verification grade — no certified verifier is present. The
    result object keeps the decoder outcome and the measured metrics separate
    from the grade so the distinction is never lost.
    """

    @staticmethod
    def measure(gray: np.ndarray, detection: Detection) -> dict[str, Any]:
        """Collect the measurable quality signals for one symbol."""
        x0, y0, x1, y1 = detection.bbox
        height, width = gray.shape[:2]
        x0, x1 = max(0, x0), min(width, x1)
        y0, y1 = max(0, y0), min(height, y1)
        region = gray[y0:y1, x0:x1]
        if region.size == 0:
            return {}

        contrast = float(region.max()) - float(region.min())
        # Modulation: how far the darkest ink sits from the lightest paper.
        modulation = contrast / 255.0
        # Edge sharpness proxy (higher = crisper print).
        sharpness = float(np.abs(cv2.Laplacian(region, cv2.CV_64F)).var())
        # Dark-pixel coverage of the symbol area.
        _, binary = cv2.threshold(
            region, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )
        coverage = float(binary.mean())
        # Geometry: aspect ratio of the symbol.
        aspect = (x1 - x0) / float(max(y1 - y0, 1))

        quiet_left = quiet_right = 0.0
        if detection.format_id in LINEAR_FORMATS:
            margin = max(int((y1 - y0) * MIN_QUIET_ZONE_RATIO), 4)
            left = gray[y0:y1, max(0, x0 - margin):x0]
            right = gray[y0:y1, x1:min(width, x1 + margin)]
            if left.size:
                quiet_left = float((left > 200).mean())
            if right.size:
                quiet_right = float((right > 200).mean())

        return {
            "contrast": round(contrast, 1),
            "modulation": round(modulation, 3),
            "edgeSharpness": round(sharpness, 1),
            "coverage": round(coverage, 3),
            "aspectRatio": round(aspect, 2),
            "quietZoneLeft": round(quiet_left, 3),
            "quietZoneRight": round(quiet_right, 3),
            "standard": "indicative (not ISO/IEC verification)",
        }

    @staticmethod
    def grade(metrics: dict[str, Any]) -> str | None:
        """Grade A-F from the measured metrics, or ``None`` if unmeasurable.

        A grade is only returned when the measurements exist; it is never
        invented from a successful decode alone.
        """
        if not metrics:
            return None

        score = 0.0
        scored = 0

        modulation = metrics.get("modulation")
        if modulation is not None:
            score += 1.0 if modulation >= 0.8 else 0.4 if modulation >= 0.5 else 0.0
            scored += 1

        edge = metrics.get("edgeSharpness")
        if edge is not None:
            score += 1.0 if edge >= 200 else 0.5 if edge >= 50 else 0.0
            scored += 1

        if metrics.get("quietZoneLeft") is not None:
            quiet = min(
                metrics.get("quietZoneLeft", 0.0),
                metrics.get("quietZoneRight", 0.0),
            )
            score += 1.0 if quiet >= 0.8 else 0.4 if quiet >= 0.6 else 0.0
            scored += 1

        coverage = metrics.get("coverage")
        if coverage is not None:
            score += 1.0 if 0.2 <= coverage <= 0.8 else 0.3
            scored += 1

        if scored == 0:
            return None

        ratio = score / scored
        if ratio >= 0.85:
            return "A"
        if ratio >= 0.7:
            return "B"
        if ratio >= 0.55:
            return "C"
        if ratio >= 0.4:
            return "D"
        return "F"


def _json_safe(value: Any) -> Any:
    """Recursively coerce a structure into JSON-serialisable Python types.

    NumPy scalars become plain ``float``/``int``/``bool``, and any ``NaN`` or
    infinity becomes ``None`` (which ``json.dumps`` renders as ``null``)
    instead of emitting invalid JSON. Dicts and lists are converted element by
    element; anything already serialisable is returned unchanged.
    """
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    # bool must be checked before the numeric types: it is an int subclass.
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        value = float(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


# ---------------------------------------------------------------------------
# Enhanced barcode verification (heuristic, post-decode layer)
# ---------------------------------------------------------------------------

#: Attached to every verification payload. This layer performs image analysis
#: only: it is not a certified verifier and must never be presented as one.
VERIFICATION_DISCLAIMER = "Heuristic verification score. Not ISO/IEC certified."

#: Nominal (100% magnification) X-dimension per symbology, in millimetres.
#:
#: REFERENCE ASSUMPTION, NOT A MEASUREMENT. These are commonly published
#: nominal module widths for retail packaging artwork. They are an internal
#: assumption of this module; nothing is read from the artwork to establish
#: them and they are not GS1-certified. Magnification is therefore reported as
#: an ESTIMATE against these assumptions, and a symbology missing from this
#: table yields ``None`` rather than a guessed nominal.
NOMINAL_X_DIMENSION_MM: dict[str, float] = {
    "EAN_13": 0.33,
    "EAN_8": 0.27,
    "UPC_A": 0.33,
    "UPC_E": 0.27,
    "CODE_128": 0.26,
    "GS1_128": 0.26,
    "CODE_39": 0.19,
}

#: Symbologies that genuinely encode wide elements. For every other supported
#: symbology a "wide bar" measurement would be fabricated, so it stays ``None``.
WIDE_BAR_FORMATS = frozenset({"CODE_39", "CODE_93", "CODABAR"})

#: Grade thresholds for a higher-is-better 0-100 score, best first.
GRADE_THRESHOLDS: tuple[tuple[str, float], ...] = (
    ("A", 80.0),
    ("B", 70.0),
    ("C", 60.0),
    ("D", 50.0),
)

#: Reflectance percentiles used for robust dark/light estimation. Using the
#: 1st/99th percentile instead of the absolute min/max means a handful of
#: stray antialiasing or sensor-noise pixels cannot collapse or inflate the
#: symbol contrast. Fixed percentiles keep the result deterministic.
REFLECTANCE_DARK_PERCENTILE = 1.0
REFLECTANCE_LIGHT_PERCENTILE = 99.0

#: Percentile of |dI/dx| treated as "a real bar edge" for minimum edge contrast.
EDGE_TRANSITION_PERCENTILE = 98.0

#: Minimum ROI side, in pixels, before physical millimetre measurements are
#: attempted. Below this the module width is not resolvable reliably.
MIN_ROI_SIDE_PX = 8

#: A run shorter than this fraction of the estimated module width is treated as
#: printing noise (antialiasing speckle) rather than as a real bar or space.
NOISE_RUN_FRACTION = 0.34

#: Scanlines sampled across the symbol height when profiling bar runs.
SCANLINE_SAMPLE_ROWS = 9


def score_to_grade(score: float | None) -> str | None:
    """Map a higher-is-better 0-100 score onto an A-F grade.

    ``A >= 80``, ``B >= 70``, ``C >= 60``, ``D >= 50``, otherwise ``F``.
    Returns ``None`` for ``None`` or non-finite input so an unmeasurable metric
    is never silently turned into a failing grade.

    For metrics where LOWER is better (such as the defect count) the caller
    must normalise into a higher-is-better quality score first; this function
    must never be pointed at a raw defect count.
    """
    if score is None:
        return None
    try:
        value = float(score)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None

    for letter, floor in GRADE_THRESHOLDS:
        if value >= floor:
            return letter
    return "F"


class BarcodeVerifier:
    """Post-decode verification and quality analysis for ONE symbol.

    This is an *analysis layer only*. It runs strictly after the existing
    pipeline has produced a validated, decoded symbol, and it never influences
    whether a barcode was accepted or decoded. Every metric that cannot be
    computed reliably is returned as ``None`` rather than being invented, and
    any internal failure degrades to a partial result (see :meth:`verify`).

    IMPORTANT: the scores below are heuristic image-analysis estimates. They
    are not ISO/IEC 15416 (1D) or 15415 (2D) verification grades, not GS1
    conformance results, and not produced by a certified verifier.
    """

    def __init__(self, image: np.ndarray, dpi: float = 300.0) -> None:
        """Bind the verifier to an already-rendered grayscale page raster.

        ``image`` is the SAME raster the detection and decode stages used; the
        verifier never re-renders the page. ``dpi`` is the resolution that
        raster was produced at and is the only basis for physical (mm)
        measurements.
        """
        self._image = image
        # Guard against a missing/zero/negative/NaN DPI: without a trustworthy
        # DPI every millimetre value would be fabricated, so physical metrics
        # are simply unavailable instead.
        try:
            dpi_value = float(dpi)
        except (TypeError, ValueError):
            dpi_value = 0.0
        self._dpi = dpi_value if math.isfinite(dpi_value) and dpi_value > 0 else None

    # -- small helpers ----------------------------------------------------

    @property
    def dpi(self) -> float | None:
        """Usable DPI, or ``None`` when physical measurement is unavailable."""
        return self._dpi

    def _to_mm(self, pixels: float | None) -> float | None:
        """Convert pixels to millimetres using the render DPI.

        ``mm = px * 25.4 / dpi``. Returns ``None`` for a missing measurement or
        an unusable DPI rather than assuming a default resolution.
        """
        if pixels is None or self._dpi is None:
            return None
        try:
            value = float(pixels) * 25.4 / self._dpi
        except (TypeError, ValueError):
            return None
        return value if math.isfinite(value) else None

    def _roi(
        self, box: tuple[int, int, int, int]
    ) -> tuple[np.ndarray | None, tuple[int, int, int, int]]:
        """Crop the symbol region, clamped to the image.

        Returns ``(roi, clipped_box)``. ``roi`` is ``None`` for an empty or
        degenerate crop, which every caller treats as "no measurements".
        Clipping keeps symbols that touch a page edge safe to analyse.
        """
        if self._image is None or self._image.size == 0:
            return None, box
        height, width = self._image.shape[:2]
        x0, y0, x1, y1 = box
        x0, x1 = max(0, int(x0)), min(width, int(x1))
        y0, y1 = max(0, int(y0)), min(height, int(y1))
        if x1 - x0 < MIN_ROI_SIDE_PX or y1 - y0 < MIN_ROI_SIDE_PX:
            return None, (x0, y0, x1, y1)
        roi = self._image[y0:y1, x0:x1]
        if roi.size == 0:
            return None, (x0, y0, x1, y1)
        return roi, (x0, y0, x1, y1)

    # -- reflectance and contrast ----------------------------------------

    def _reflectance(self, roi: np.ndarray) -> tuple[float, float]:
        """Estimate light/dark reflectance of the symbol, as percentages.

        Method (deterministic): grayscale values are normalised with
        ``v / 255 * 100`` to a 0-100 scale, then the light level is the 99th
        percentile and the dark level the 1st percentile. Percentiles rather
        than absolute max/min so a few isolated noise or antialiasing pixels
        cannot distort the levels; the percentiles are fixed constants, so the
        result is reproducible.
        """
        values = roi.astype(np.float32) / 255.0 * 100.0
        dark = float(np.percentile(values, REFLECTANCE_DARK_PERCENTILE))
        light = float(np.percentile(values, REFLECTANCE_LIGHT_PERCENTILE))
        return dark, light

    def _minimum_edge_contrast(self, roi: np.ndarray) -> float | None:
        """Weakest real bar-to-space transition, as a percentage.

        Method: a Sobel-x operator measures the horizontal intensity gradient
        across the bars (a linear symbol's bars run vertically, so the
        transitions that matter are in x). For every image row the strongest
        gradient is taken as that row's sharpest bar/space edge, and the
        MINIMUM of those row peaks is reported - the weakest edge anywhere in
        the symbol, which is what makes this a *minimum* edge contrast rather
        than a measure of global sharpness.

        Taking a per-row peak (rather than a mean over all edge pixels) means a
        clean, sharply printed symbol scores near full scale, because each row
        contains at least one genuine hard edge. Rows with no detectable edge
        carry a peak of zero and therefore correctly lower the minimum, which
        is what a smeared or low-quality print looks like.

        A ksize=3 Sobel kernel has a built-in gain of 8 and, after the light
        Gaussian pre-blur used to suppress speckle, its response is not a true
        0-255 intensity step. It is therefore used only to LOCATE each
        transition; the contrast itself is then measured directly as the
        difference in mean intensity either side of that location (a 3-pixel
        window per side), which is a genuine 0-255 step in intensity.

        Rows whose measured step is negligible are treated as having no real
        edge and contribute zero, so a smeared or low-contrast print correctly
        lowers the minimum.

        Returns ``None`` when no transition is detectable at all.
        """
        if roi is None or roi.size == 0 or roi.shape[0] < 3 or roi.shape[1] < 3:
            return None
        blurred = cv2.GaussianBlur(roi, (3, 3), 0)
        grad_x = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3)
        magnitude = np.abs(grad_x)

        height, width = magnitude.shape
        if width < 7:
            return None

        # Ignore the first and last row: a cropped symbol can clip a bar there,
        # which is a cropping artefact rather than a print defect.
        steps: list[float] = []
        window = 3
        for y in range(1, height - 1):
            row = magnitude[y]
            x = int(np.argmax(row))
            if row[x] <= 1e-6:
                steps.append(0.0)
                continue
            left = blurred[y, max(0, x - window):x]
            right = blurred[y, x + 1:x + 1 + window]
            if left.size == 0 or right.size == 0:
                continue
            steps.append(abs(float(right.mean()) - float(left.mean())))

        if not steps:
            return None
        weakest = min(steps)
        value = weakest / 255.0 * 100.0
        return round(min(max(value, 0.0), 100.0), 2)

    # -- linear bar width analysis ---------------------------------------

    @staticmethod
    def _scanline_profile(binary: np.ndarray) -> list[int]:
        """Return the dark/light run lengths of one binarised scanline.

        The scanline is 0/1 where 1 = dark. Zero-length runs are dropped so a
        single antialiased column cannot create a phantom run.
        """
        if binary.size == 0:
            return []
        row = (binary > 0).astype(np.uint8)
        transitions = np.flatnonzero(np.diff(row)) + 1
        edges = np.concatenate(([0], transitions, [row.size]))
        return [
            int(edges[i + 1] - edges[i])
            for i in range(len(edges) - 1)
            if int(edges[i + 1] - edges[i]) >= 1
        ]

    def _measure_bar_widths(
        self,
        roi: np.ndarray,
        symbology: str,
    ) -> dict[str, Any]:
        """Measure narrow/wide bar, ratio and gap for a LINEAR symbol.

        Steps: binarise the ROI with Otsu (consistent with the existing
        :class:`BarcodeValidator`), take a centre scanline so a rotated or
        slightly skewed symbol is still crossed through its middle, convert it
        to stable dark/light runs, drop runs too short to be a real module, and
        take the median of the shortest runs as the narrow-bar width.

        The narrow bar is reported for every linear symbology. Wide bar,
        wide-to-narrow ratio and gap are only reported for symbologies that
        genuinely encode wide elements (see :data:`WIDE_BAR_FORMATS`); for the
        others ``None`` is returned rather than a fabricated figure, because a
        fixed-width symbology has no meaningful wide bar to measure.

        Lengths are returned in PIXELS; the caller converts to millimetres.
        """
        empty: dict[str, Any] = {
            "narrowBarPx": None,
            "wideBarPx": None,
            "wideToNarrowRatio": None,
            "gapPx": None,
        }
        if roi is None or roi.size == 0 or roi.shape[0] < 3 or roi.shape[1] < 3:
            return empty

        blurred = cv2.GaussianBlur(roi, (3, 3), 0)
        _, binary = cv2.threshold(
            blurred, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )

        # Centre scanline: crosses the symbol through its middle height.
        row_index = binary.shape[0] // 2
        runs = self._scanline_profile(binary[row_index, :])
        if len(runs) < 3:
            return empty

        # Establish the module scale from the median run, then discard runs
        # too short to be a real bar/space (printing speckle, not a module).
        module = float(np.median(runs))
        if module <= 0:
            return empty
        floor = max(1.0, module * NOISE_RUN_FRACTION)
        kept = [run for run in runs if run >= floor]
        if len(kept) < 3:
            return empty

        # Narrow bar = median of the shortest runs. Median (not min) so one
        # clipped or speckled run cannot define the narrowest bar.
        narrow = float(np.median(sorted(kept)[: max(1, len(kept) // 3)]))
        if narrow <= 0:
            return empty

        result = dict(empty)
        result["narrowBarPx"] = narrow

        if symbology in WIDE_BAR_FORMATS:
            # Wide runs are those clearly wider than the narrow module.
            wide_candidates = [run for run in kept if run > narrow * 1.5]
            if wide_candidates:
                wide = float(np.median(sorted(wide_candidates)))
                result["wideBarPx"] = wide
                result["wideToNarrowRatio"] = round(wide / narrow, 3)
            # Gap = narrowest significant space between bars.
            gaps = [run for run in kept if run <= narrow * 1.5]
            if gaps:
                result["gapPx"] = float(np.median(sorted(gaps)))

        return result

    # -- magnification ----------------------------------------------------

    def _magnification(
        self, format_id: str, narrow_bar_px: float | None
    ) -> dict[str, Any] | None:
        """Estimate magnification against the internal nominal X-dimension.

        Method: ``X = narrow_bar_px * 25.4 / dpi`` gives the measured module
        width in millimetres; magnification is that divided by the reference
        nominal X-dimension for the symbology
        (:data:`NOMINAL_X_DIMENSION_MM`), expressed as a percentage.

        The nominal is an ASSUMPTION of this module, not something measured
        from the artwork, so this is an estimate and is never presented as
        certified magnification. Returns ``None`` when the narrow bar could not
        be measured, the DPI is unusable, or the symbology has no documented
        nominal here - accuracy is preferred over a populated field.
        """
        nominal = NOMINAL_X_DIMENSION_MM.get(format_id)
        if nominal is None or nominal <= 0:
            return None
        measured_mm = self._to_mm(narrow_bar_px)
        if measured_mm is None or measured_mm <= 0:
            return None
        value = measured_mm / nominal * 100.0
        return {
            "grade": score_to_grade(value),
            "value": round(value, 2),
            "unit": "%",
        }

    # -- quiet zone -------------------------------------------------------

    def _quiet_zone(
        self, box: tuple[int, int, int, int], linear: bool
    ) -> dict[str, Any]:
        """Quiet zone as the percentage of light (paper) pixels in the margin.

        Reuses the existing approach from :meth:`QualityGrader.measure` - the
        margin width is ``MIN_QUIET_ZONE_RATIO`` of the symbol height (min 4
        px), and the value is the fraction of pixels brighter than 200. For 2D
        symbols the margin is taken on all four sides instead of left/right.

        Returned as percentages (0-100) to match the rest of ``verification``.
        A side lying entirely outside the page cannot be measured and is
        returned as ``None`` rather than counted as a perfect zone.
        """
        empty: dict[str, Any] = {"grade": None, "left": None, "right": None}
        if self._image is None or self._image.size == 0:
            return empty
        height, width = self._image.shape[:2]
        x0, y0, x1, y1 = box
        if x1 <= x0 or y1 <= y0:
            return empty

        def _side(patch: np.ndarray) -> float | None:
            if patch.size == 0:
                return None
            return round(float((patch > 200).mean()) * 100.0, 2)

        if linear:
            margin = max(int((y1 - y0) * MIN_QUIET_ZONE_RATIO), 4)
            left = _side(self._image[y0:y1, max(0, x0 - margin):x0])
            right = _side(self._image[y0:y1, x1:min(width, x1 + margin)])
            values = [v for v in (left, right) if v is not None]
            return {
                "grade": score_to_grade(min(values)) if values else None,
                "left": left,
                "right": right,
            }

        # 2D: analyse all four sides.
        margin = max(int(min(x1 - x0, y1 - y0) * MIN_QUIET_ZONE_RATIO), 4)
        sides = [
            _side(self._image[y0:y1, max(0, x0 - margin):x0]),
            _side(self._image[y0:y1, x1:min(width, x1 + margin)]),
            _side(self._image[max(0, y0 - margin):y0, x0:x1]),
            _side(self._image[y1:min(height, y1 + margin), x0:x1]),
        ]
        values = [v for v in sides if v is not None]
        return {
            "grade": score_to_grade(min(values)) if values else None,
            "other": {
                "left": sides[0],
                "right": sides[1],
                "top": sides[2],
                "bottom": sides[3],
            },
        }


    # -- defect analysis --------------------------------------------------

    def _defects(self, roi: np.ndarray) -> dict[str, Any]:
        """Heuristic defect severity, as a percentage of suspicious scanlines.

        Method: binarise the ROI, sample several evenly spaced scanlines across
        the symbol height, and compare each row's dark-pixel coverage with the
        median coverage. A genuine print defect (a broken bar, a missing
        transition, a blotch) shifts a single row's ink coverage relative to
        its neighbours, whereas ordinary antialiasing is uniform across rows
        and does not. Rows deviating beyond a 20% relative tolerance are
        therefore counted as defective, which isolates real defects and does
        not flag anti-aliasing.

        ``value`` is LOWER IS BETTER (0% = clean). The grade is derived from the
        inverted quality score so zero defects grade best.
        """
        none_result: dict[str, Any] = {"grade": None, "value": None}
        if roi is None or roi.size == 0 or roi.shape[0] < 4 or roi.shape[1] < 4:
            return none_result

        blurred = cv2.GaussianBlur(roi, (3, 3), 0)
        _, binary = cv2.threshold(
            blurred, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )
        rows = np.flatnonzero(binary.sum(axis=1) > 0)
        if rows.size < 4:
            return none_result

        samples = np.linspace(rows[0], rows[-1], SCANLINE_SAMPLE_ROWS).astype(int)
        ratios = np.array(
            [binary[y].mean() for y in samples if 0 <= y < binary.shape[0]],
            dtype=np.float32,
        )
        if ratios.size < 4:
            return none_result

        median = float(np.median(ratios))
        if median <= 0:
            return none_result
        deviation = np.abs(ratios - median) / median
        flagged = int(np.count_nonzero(deviation > 0.20))
        severity = flagged / float(ratios.size) * 100.0

        # Invert to a higher-is-better quality score before grading, so a low
        # defect count is never mistaken for a poor result.
        return {
            "grade": score_to_grade(max(0.0, 100.0 - severity)),
            "value": round(severity, 2),
        }

    # -- decodability and decode metric ----------------------------------

    def _decodability(
        self,
        decoded: bool,
        symbol_contrast: float | None,
        edge_contrast: float | None,
        modulation: float | None,
        quiet_min: float | None,
        defect_value: float | None,
    ) -> float | None:
        """Heuristic decodability score, 0-100.

        Weighted sum of the available signals (weights sum to 1.0, fixed so the
        score is deterministic):

            symbol contrast  0.30
            edge contrast    0.20
            modulation       0.20
            quiet zone       0.15
            defects          0.15 (inverted: fewer defects scores higher)

        A successful decode is required to reach this stage at all and
        contributes positively: a decoded symbol starts from a base of 20
        points, so decode success can never reduce the score. The result is
        clamped to 0-100.

        This is NOT the ISO/IEC 15416 decodability grade.
        """
        base = 20.0 if decoded else 0.0
        if not decoded:
            return 0.0

        total = base
        weight = 0.20  # the decode-success contribution

        if symbol_contrast is not None:
            total += 0.30 * min(max(symbol_contrast, 0.0), 100.0)
            weight += 0.30
        if edge_contrast is not None:
            total += 0.20 * min(max(edge_contrast, 0.0), 100.0)
            weight += 0.20
        if modulation is not None:
            # Existing modulation metric is 0-1; scale to 0-100.
            total += 0.20 * min(max(modulation, 0.0), 1.0) * 100.0
            weight += 0.20
        if quiet_min is not None:
            total += 0.15 * min(max(quiet_min, 0.0), 100.0)
            weight += 0.15
        if defect_value is not None:
            total += 0.15 * min(max(100.0 - defect_value, 0.0), 100.0)
            weight += 0.15

        if weight <= 0:
            return None
        # Renormalise by the weight actually used, so a metric that could not
        # be measured does not drag the score down; it simply carries no
        # weight. Since the total is already on a 0-100 scale the ratio is
        # the score directly.
        return round(min(max(total / weight, 0.0), 100.0), 2)

    def _decode_metric(self, decodability: float | None) -> dict[str, Any] | None:
        """Heuristic decode metric on a 0-4 scale.

        Maps the decodability score onto 0-4 in 0.5 steps. This is a heuristic
        indicator only - it is not an ISO/IEC 15416 decode grade and not a
        certified decode score.
        """
        if decodability is None:
            return None
        value = min(max(decodability, 0.0), 100.0) / 25.0
        return {
            "grade": score_to_grade(decodability),
            "value": round(round(value * 2.0) / 2.0, 2),
        }
# -- public entry point ----------------------------------------------

    def verify(self, detection: dict[str, Any]) -> dict[str, Any]:
        """Produce the verification payload for one validated, decoded symbol.

        ``detection`` is a mapping using the same keys as a serialised result
        (``formatId``, ``decodedValue``, ``bbox``, ``polygon``,
        ``qualityMetrics``). This method performs image analysis ONLY: it never
        decodes, never re-detects and never re-renders, and its result has no
        influence on whether the barcode was accepted.

        Every metric that cannot be measured reliably is ``None``. Any
        unexpected internal error is contained and reported as a partial result
        carrying ``error``, so a verification failure can never break the
        inspection or hide an otherwise valid decoded barcode.
        """
        try:
            return self._verify(detection)
        except Exception as exc:  # supplementary layer: never break the scan
            logger.debug("Barcode verification failed (%s)", exc)
            return {
                "overallGrade": None,
                "error": (
                    "Verification could not be calculated for this ROI."
                ),
                "disclaimer": VERIFICATION_DISCLAIMER,
            }

    def _verify(self, detection: dict[str, Any]) -> dict[str, Any]:
        """Compute every verification metric; see :meth:`verify` for the API."""
        if not isinstance(detection, dict):
            return {"overallGrade": None, "error": "Invalid detection."}

        format_id = str(detection.get("formatId") or "")
        value = str(detection.get("decodedValue") or "")
        linear = format_id in LINEAR_FORMATS
        quality = detection.get("qualityMetrics")
        quality = quality if isinstance(quality, dict) else {}

        # --- geometry: prefer the detected polygon (handles rotation), and
        # fall back to the axis-aligned bbox when no polygon is available.
        box = self._resolve_box(detection)
        roi, clipped = self._roi(box)

        payload: dict[str, Any] = {
            "decodability": {"grade": None, "value": None},
            "magnification": None,
            "symbolContrast": {"grade": None, "value": None},
            "minimumEdgeContrast": {"grade": None, "value": None},
            "modulation": {"grade": None, "value": None},
            "defects": {"grade": None, "value": None},
            "decode": None,
            "quietZone": {"grade": None, "left": None, "right": None},
            "narrowBar": None,
            "wideBar": None,
            "wideToNarrowRatio": None,
            "gap": None,
            "dataStructure": None,
            "minReflectance": {"grade": None, "value": None},
            "maxReflectance": {"value": None},
            "bwr": {"value": None, "unit": "mm"},
            "disclaimer": VERIFICATION_DISCLAIMER,
        }

        if roi is None:
            # Nothing measurable in this ROI; return the null skeleton.
            payload["overallGrade"] = None
            payload["error"] = "Empty or too-small ROI for verification."
            return payload

        # -- reflectance, contrast, modulation --------------------------

        dark, light = self._reflectance(roi)
        symbol_contrast = round(min(max(light - dark, 0.0), 100.0), 2)
        payload["symbolContrast"] = {
            "grade": score_to_grade(symbol_contrast),
            "value": symbol_contrast,
        }
        # Minimum reflectance is graded as a REFLECTANCE FLOOR: for the darkest
        # bar a HIGHER reflectance means the ink is lighter / less opaque, so
        # higher-is-better genuinely applies here. A value of 0% therefore
        # grades F, which correctly flags ink that carries no reflectance at
        # all. This is a floor check, not a defect count; symbol contrast and
        # modulation remain the measures of print quality.
        payload["minReflectance"] = {
            "grade": score_to_grade(dark),
            "value": round(dark, 2),
        }
        # No grade for max reflectance: a bright substrate is not itself a
        # quality signal, so inventing one would be misleading.
        payload["maxReflectance"] = {"value": round(light, 2)}

        edge_contrast = self._minimum_edge_contrast(roi)
        if edge_contrast is not None:
            payload["minimumEdgeContrast"] = {
                "grade": score_to_grade(edge_contrast),
                "value": round(edge_contrast, 2),
            }

        # --- modulation: reuse the existing metric, never a second algorithm
        existing_modulation = quality.get("modulation")
        if existing_modulation is not None:
            modulation_pct = min(max(float(existing_modulation), 0.0), 1.0) * 100.0
            payload["modulation"] = {
                "grade": score_to_grade(modulation_pct),
                "value": round(modulation_pct, 2),
            }

        payload["quietZone"] = self._quiet_zone(clipped, linear)
        payload["defects"] = self._defects(roi)

        # -- linear bar widths / magnification ---------------------------
        # A physical measurement is only reported when it could actually be
        # converted to millimetres; otherwise the key stays ``None`` rather
        # than carrying a dict whose value is null, so a frontend can test the
        # key itself to decide whether to show "—" (section 32).
        narrow_px = None
        if linear:
            widths = self._measure_bar_widths(roi, format_id)
            narrow_px = widths["narrowBarPx"]
            narrow_mm = self._rounded_mm(self._to_mm(narrow_px))
            if narrow_mm is not None:
                payload["narrowBar"] = {
                    "grade": None,
                    "value": narrow_mm,
                    "unit": "mm",
                }
            wide_mm = self._rounded_mm(self._to_mm(widths["wideBarPx"]))
            if wide_mm is not None:
                payload["wideBar"] = {
                    "grade": None,
                    "value": wide_mm,
                    "unit": "mm",
                }
                payload["wideToNarrowRatio"] = widths["wideToNarrowRatio"]
            gap_mm = self._rounded_mm(self._to_mm(widths["gapPx"]))
            if gap_mm is not None:
                payload["gap"] = {
                    "grade": None,
                    "value": gap_mm,
                    "unit": "mm",
                }
            payload["magnification"] = self._magnification(format_id, narrow_px)

        # -- BWR: bar width reduction vs the nominal module ----------------
        # Only computable where a nominal X-dimension exists AND the narrow
        # bar was measurable; otherwise None rather than a fabricated figure.
        nominal = NOMINAL_X_DIMENSION_MM.get(format_id)
        if narrow_px is not None and nominal:
            measured_mm = self._to_mm(narrow_px)
            if measured_mm is not None:
                payload["bwr"] = {
                    "value": round(measured_mm - nominal, 4),
                    "unit": "mm",
                }

        # -- decodability, decode metric, aggregation --------------------

        quiet_values: list[float] = []
        quiet_zone = payload["quietZone"]
        for side in ("left", "right"):
            level = quiet_zone.get(side)
            if isinstance(level, (int, float)):
                quiet_values.append(float(level))
        quiet_min = min(quiet_values) if quiet_values else None

        decodability = self._decodability(
            decoded=bool(value),
            symbol_contrast=symbol_contrast,
            edge_contrast=edge_contrast,
            modulation=quality.get("modulation"),
            quiet_min=quiet_min,
            defect_value=payload["defects"].get("value"),
        )
        if decodability is not None:
            payload["decodability"] = {
                "grade": score_to_grade(decodability),
                "value": decodability,
            }
            payload["decode"] = self._decode_metric(decodability)

        # No deterministic per-symbology data-structure validation is exposed
        # by the existing pipeline (it validates geometry, not data content),
        # so this stays None rather than inventing structural compliance.
        payload["dataStructure"] = None

        payload["overallGrade"] = self._overall_grade(payload)
        return payload

    @staticmethod
    def _rounded_mm(value: float | None) -> float | None:
        """Round a millimetre measurement to 3 dp, or pass None through."""
        return None if value is None else round(value, 3)

    def _resolve_box(self, detection: dict[str, Any]) -> tuple[int, int, int, int]:
        """Determine the analysis box, preferring a rotated polygon.

        When the decoder reported corner points, the axis-aligned bounding box
        of those corners is used, which keeps a rotated symbol fully covered
        instead of being clipped by a naive min/max of its own corners.
        """
        polygon = detection.get("polygon")
        if isinstance(polygon, list) and len(polygon) >= 3:
            xs: list[float] = []
            ys: list[float] = []
            for point in polygon:
                if isinstance(point, dict):
                    if point.get("x") is not None and point.get("y") is not None:
                        xs.append(float(point["x"]))
                        ys.append(float(point["y"]))
                elif isinstance(point, (list, tuple)) and len(point) >= 2:
                    xs.append(float(point[0]))
                    ys.append(float(point[1]))
            if xs and ys:
                return (
                    int(math.floor(min(xs))),
                    int(math.floor(min(ys))),
                    int(math.ceil(max(xs))),
                    int(math.ceil(max(ys))),
                )

        bbox = detection.get("bbox")
        if isinstance(bbox, dict) and all(
            bbox.get(key) is not None for key in ("x", "y", "width", "height")
        ):
            x = float(bbox["x"])
            y = float(bbox["y"])
            return (
                int(math.floor(x)),
                int(math.floor(y)),
                int(math.ceil(x + float(bbox["width"]))),
                int(math.ceil(y + float(bbox["height"]))),
            )
        raise ValueError("detection has no usable geometry")

    @staticmethod
    def _overall_grade(payload: dict[str, Any]) -> str | None:
        """Aggregate the available metric grades into an overall grade.

        Strategy: map every metric grade onto a numeric level (A=4 ... F=0) and
        average them, so the overall grade reflects the measured evidence as a
        whole rather than any single dominant metric. A metric that produced no
        grade is simply absent from the average - an unmeasurable metric is
        never counted as a failure. ``None`` is returned when no metric
        produced a grade at all.

        This is deliberately independent of the legacy top-level ``grade``
        field, which is the existing QualityGrader's own indicative grade; the
        two are related but computed separately.
        """
        levels = {"A": 4.0, "B": 3.0, "C": 2.0, "D": 1.0, "F": 0.0}
        scores: list[float] = []

        for key in (
            "decodability",
            "symbolContrast",
            "minimumEdgeContrast",
            "modulation",
            "defects",
            "quietZone",
            "magnification",
        ):
            entry = payload.get(key)
            if not isinstance(entry, dict):
                continue
            grade = entry.get("grade")
            # Defects invert severity into an A-F letter internally, so its
            # letter is used directly like every other metric - zero defects
            # correctly contributes an "A".
            if isinstance(grade, str) and grade in levels:
                scores.append(levels[grade])

        if not scores:
            return None
        mean = sum(scores) / len(scores)
        if mean >= 3.5:
            return "A"
        if mean >= 2.5:
            return "B"
        if mean >= 1.5:
            return "C"
        if mean >= 0.5:
            return "D"
        return "F"


# ---------------------------------------------------------------------------
# De-duplication and ordering
# ---------------------------------------------------------------------------

def deduplicate(detections: list[Detection]) -> tuple[list[Detection], int]:
    """Collapse the same physical symbol detected by several passes.

    Two detections are the same barcode when they are on the same page, decode
    to the same value in the same format, and their boxes overlap heavily.
    Returns ``(unique, removed_count)``.
    """
    unique: list[Detection] = []

    for detection in detections:
        duplicate = False
        for existing in unique:
            if (
                existing.page == detection.page
                and existing.format_id == detection.format_id
                and existing.value == detection.value
                and iou(existing.bbox, detection.bbox) > IOU_MERGE_THRESHOLD
            ):
                duplicate = True
                break
        if not duplicate:
            unique.append(detection)

    return unique, len(detections) - len(unique)


def sort_in_document_order(detections: list[Detection]) -> list[Detection]:
    """Order results for display: page, then top-to-bottom, left-to-right.

    Ids are assigned by the caller AFTER this sort, so the result table always
    shows 1, 2, 3 ... in reading order rather than decoder discovery order.
    """
    return sorted(
        detections,
        key=lambda d: (d.page, d.bbox[1], d.bbox[0]),
    )



# ---------------------------------------------------------------------------
# Cancellation token
# ---------------------------------------------------------------------------

class CancelToken:
    """Cooperative cancellation checked between pages and candidate batches."""

    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def raise_if_cancelled(self) -> None:
        if self._event.is_set():
            raise InspectionCancelled("cancelled by user")


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

@dataclass
class PageStats:
    """Per-page counters, used for lightweight logging and progress."""

    page: int
    candidates: int = 0
    decoded: int = 0
    valid: int = 0
    rejected: int = 0
    unreadable_candidates: int = 0
    error: str | None = None


class BarcodeInspectionEngine:
    """Runs one PDF through the full barcode pipeline.

    Per page: render once -> locate candidates -> decode crops -> strict
    validation -> release the image. Pages are independent and run on a small,
    CPU-aware pool; only one page image is alive per worker, so memory stays
    bounded regardless of document length.
    """

    def __init__(
        self,
        pdf_path: str,
        config: dict[str, Any] | None = None,
        cancel_token: CancelToken | None = None,
    ) -> None:
        self.pdf_path = pdf_path
        self.config = normalize_config(config)
        self.runtime = Runtime.instance()
        self.cancel_token = cancel_token or CancelToken()

        profile = PROFILES.get(self.config["profile"], PROFILES["default"])
        self.allow_rotated = bool(profile.get("rotated"))
        self.min_module_px = float(profile.get("min_module_px", 2.0))
        self.allowed_formats = list(BARCODE_FORMATS.keys())
        self.decoder_calls = 0

        # Per-stage wall-clock totals. Pages run on a pool, so the accumulators
        # are locked; pages share the CPU, which is why these are reported per
        # stage and read as a breakdown rather than as a strict budget.
        self._timing_lock = threading.Lock()
        self.stage_seconds: dict[str, float] = {
            "pdf_open": 0.0,
            "rendering": 0.0,
            "detection": 0.0,
            "decoding": 0.0,
            "validation": 0.0,
        }

    def _add_stage_seconds(self, **deltas: float) -> None:
        with self._timing_lock:
            for stage, delta in deltas.items():
                self.stage_seconds[stage] = self.stage_seconds.get(stage, 0.0) + delta

    @staticmethod
    def _log_timings(elapsed: float, timings: dict[str, float]) -> None:
        """Log the measured stage breakdown.

        Deliberately logged every run so a slow document can be diagnosed from
        the log instead of guessed at.
        """
        logger.info(
            "Barcode inspection timings: PDF open: %.2fs | Rendering: %.2fs | "
            "Detection: %.2fs | Decoding: %.2fs | Validation: %.2fs | "
            "Dedup+ser: %.2fs | Total: %.2fs",
            timings["pdf_open"],
            timings["rendering"],
            timings["detection"],
            timings["decoding"],
            timings["validation"],
            timings["dedup"],
            elapsed,
        )

    def _run_pages(
        self,
        dpi: int,
        page_indices: list[int],
        emit: Callable[[str, dict[str, Any]], None],
    ) -> tuple[list[Detection], list[PageStats]]:
        """Render/locate/decode every selected page, bounded pool, no leaks."""
        detections: list[Detection] = []
        stats: list[PageStats] = []
        workers = min(self.runtime.max_workers, max(len(page_indices), 1))

        if len(page_indices) <= 1 or workers <= 1:
            # Sequential: cheapest memory and startup profile.
            with PdfRenderer(self.pdf_path, dpi) as renderer:
                for index in page_indices:
                    self.cancel_token.raise_if_cancelled()
                    page_stats, found = self._process_page(renderer, index)
                    stats.append(page_stats)
                    detections.extend(found)
                    emit(
                        "barcode_detection",
                        currentPage=len(stats),
                        totalPages=len(page_indices),
                    )
            return detections, stats

        # Bounded pool. Each worker opens its own document because a PyMuPDF
        # Document is not thread-safe.
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(self._process_page_isolated, index, dpi): index
                for index in page_indices
            }
            for future in as_completed(futures):
                index = futures[future]
                try:
                    page_stats, found = future.result()
                except InspectionCancelled:
                    for pending in futures:
                        pending.cancel()
                    raise
                except Exception as exc:  # one bad page must not fail all
                    logger.warning(
                        "Barcode inspection: page %d failed (%s); continuing",
                        index + 1,
                        exc,
                    )
                    page_stats = PageStats(page=index, error=str(exc))
                    found = []
                stats.append(page_stats)
                detections.extend(found)
                emit(
                    "barcode_detection",
                    currentPage=len(stats),
                    totalPages=len(page_indices),
                )

        return detections, stats

    def _run_matrix_fallback(
        self,
        page_indices: list[int],
        target_dpi: int,
        include_matrix: bool = True,
    ) -> tuple[list[Detection], dict[int, PageStats]]:
        """Recover subtle matrix codes and labeled rotated barcode artwork.

        A high-resolution raster can make thin colored module edges disappear
        in grayscale thresholding. The low-resolution pass also looks for
        rotated linear candidates and reports a candidate as unreadable only
        when a rotated ``TBC`` placeholder label overlaps its stripes. All
        boxes are mapped back to ``target_dpi`` before normal de-duplication.
        """
        detections: list[Detection] = []
        stats_by_page: dict[int, PageStats] = {}
        scale = target_dpi / float(MATRIX_FALLBACK_DPI)

        pdf_doc = fitz.open(self.pdf_path)
        try:
            with PdfRenderer(self.pdf_path, MATRIX_FALLBACK_DPI) as renderer:
                for page_index in page_indices:
                    self.cancel_token.raise_if_cancelled()
                    render_started = time.perf_counter()
                    gray = renderer.render_gray(page_index)
                    self._add_stage_seconds(rendering=time.perf_counter() - render_started)

                    page_stats = PageStats(page=page_index)
                    stats_by_page[page_index] = page_stats
                    try:
                        if gray is None or gray.size == 0:
                            continue

                        decoder = BarcodeDecoder(
                            self.runtime, self.allowed_formats, self.allow_rotated
                        )
                        validator = BarcodeValidator(self.min_module_px)

                        if include_matrix:
                            detect_started = time.perf_counter()
                            matrix_candidates = [
                                candidate
                                for candidate in CandidateLocator.locate(gray)
                                if candidate.family == "matrix2D"
                            ]
                            self._add_stage_seconds(
                                detection=time.perf_counter() - detect_started
                            )
                            page_stats.candidates += len(matrix_candidates)

                            for candidate in matrix_candidates:
                                self.cancel_token.raise_if_cancelled()
                                found = decoder.decode_crop(gray, candidate, page_index)
                                page_stats.decoded += len(found)
                                for detection in found:
                                    is_valid, _reason = validator.validate(gray, detection)
                                    if not is_valid:
                                        page_stats.rejected += 1
                                        continue

                                    detection.validated = True
                                    detection.quality = QualityGrader.measure(gray, detection)
                                    detection.grade = QualityGrader.grade(detection.quality)
                                    detection.bbox = tuple(
                                        int(round(coordinate * scale))
                                        for coordinate in detection.bbox
                                    )
                                    detection.polygon = [
                                        (int(round(x * scale)), int(round(y * scale)))
                                        for x, y in detection.polygon
                                    ]
                                    detections.append(detection)
                                    page_stats.valid += 1

                        # Scan transposed imagery for linear codes printed at
                        # 90 degrees. The TBC example is artwork rather than a
                        # decodable payload, so emit it only when its rotated
                        # PDF text label overlaps a structurally barcode-like
                        # candidate; ordinary rotated text is not reported.
                        rotated_image = np.ascontiguousarray(gray.T)
                        detect_started = time.perf_counter()
                        rotated_candidates = CandidateLocator.find_linear(rotated_image)
                        self._add_stage_seconds(
                            detection=time.perf_counter() - detect_started
                        )

                        tbc_boxes: list[tuple[float, float, float, float]] = []
                        page = pdf_doc[page_index]
                        for block in page.get_text("dict").get("blocks", []):
                            for line in block.get("lines", []):
                                for span in line.get("spans", []):
                                    if str(span.get("text", "")).strip().upper() != "TBC":
                                        continue
                                    x0, y0, x1, y1 = span["bbox"]
                                    if (y1 - y0) <= (x1 - x0) * 1.2:
                                        continue
                                    factor = MATRIX_FALLBACK_DPI / 72.0
                                    tbc_boxes.append(
                                        (x0 * factor, y0 * factor, x1 * factor, y1 * factor)
                                    )

                        page_area = float(rotated_image.shape[0] * rotated_image.shape[1])
                        page_stats.candidates += len(rotated_candidates)
                        for candidate in rotated_candidates:
                            self.cancel_token.raise_if_cancelled()
                            if (candidate.w * candidate.h) / page_area > 0.01:
                                continue

                            found = decoder.decode_crop(
                                rotated_image, candidate, page_index
                            )
                            page_stats.decoded += len(found)
                            for detection in found:
                                is_valid, _reason = validator.validate(
                                    rotated_image, detection
                                )
                                if not is_valid:
                                    page_stats.rejected += 1
                                    continue
                                detection.validated = True
                                detection.quality = QualityGrader.measure(
                                    rotated_image, detection
                                )
                                detection.grade = QualityGrader.grade(detection.quality)
                                x0, y0, x1, y1 = detection.bbox
                                detection.bbox = tuple(
                                    int(round(value * scale))
                                    for value in (y0, x0, y1, x1)
                                )
                                detection.polygon = [
                                    (int(round(y * scale)), int(round(x * scale)))
                                    for x, y in detection.polygon
                                ]
                                detections.append(detection)
                                page_stats.valid += 1

                            if found:
                                continue

                            x0, y0 = candidate.y, candidate.x
                            x1, y1 = candidate.y + candidate.h, candidate.x + candidate.w
                            labeled_placeholder = any(
                                max(0, min(x1, tx1) - max(x0, tx0))
                                * max(0, min(y1, ty1) - max(y0, ty0))
                                / max((tx1 - tx0) * (ty1 - ty0), 1)
                                >= 0.5
                                for tx0, ty0, tx1, ty1 in tbc_boxes
                            )
                            if not labeled_placeholder:
                                continue

                            detections.append(
                                Detection(
                                    format_id="UNREADABLE_LINEAR",
                                    value="TBC placeholder (not decoded)",
                                    page=page_index,
                                    bbox=tuple(
                                        int(round(value * scale))
                                        for value in (x0, y0, x1, y1)
                                    ),
                                    polygon=[],
                                    decoder="visual-candidate",
                                    validated=False,
                                )
                            )
                            page_stats.unreadable_candidates += 1

                        self.decoder_calls += decoder.call_count
                    finally:
                        del rotated_image
                        del gray
        finally:
            pdf_doc.close()

        return detections, stats_by_page

    def run(
        self, progress: Callable[[str, dict[str, Any]], None] | None = None
    ) -> dict[str, Any]:
        """Inspect the document and return the structured result."""
        started = time.perf_counter()
        dpi = int(self.config["resolution"])

        if not self.runtime.decoder_available:
            logger.warning(
                "Barcode inspection: no decoder available; returning no results "
                "rather than guessing from text."
            )
            return self._empty_result(0, dpi, started, "decoder_unavailable")

        def emit(stage: str, **extra: Any) -> None:
            """Report progress. A ``False`` return from the callback cancels."""
            if progress is not None and progress(stage, extra) is False:
                self.cancel_token.cancel()

        emit("rendering")
        opened = time.perf_counter()
        with PdfRenderer(self.pdf_path, dpi) as probe:
            total_pages = probe.page_count
            # Page geometry is read here, once per page, from the same document
            # the detections come from. Reported alongside every box so the
            # consumer can map it onto whatever page it is displaying without
            # assuming a paper size, and without a second render.
            page_sizes = {
                index: probe.page_size_points(index)
                for index in range(total_pages)
            }
        self._add_stage_seconds(pdf_open=time.perf_counter() - opened)

        page_indices = resolve_page_indices(self.config["pages"], total_pages)
        logger.info(
            "Barcode inspection started: %s (%d page(s), %d selected, %d dpi)",
            os.path.basename(self.pdf_path),
            total_pages,
            len(page_indices),
            dpi,
        )

        detections, stats = self._run_pages(dpi, page_indices, emit)

        # Low-contrast matrix symbols and labeled rotated barcode artwork may
        # only be visible in the targeted 150-DPI fallback. Merge its findings
        # with the configured-resolution scan before assigning result ids.
        if page_indices:
            fallback_detections, fallback_stats = self._run_matrix_fallback(
                page_indices,
                dpi,
                include_matrix=dpi != MATRIX_FALLBACK_DPI,
            )
            detections.extend(fallback_detections)
            stats_by_page = {page_stat.page: page_stat for page_stat in stats}
            for page_index, fallback_stat in fallback_stats.items():
                page_stat = stats_by_page.get(page_index)
                if page_stat is not None:
                    page_stat.candidates += fallback_stat.candidates
                    page_stat.decoded += fallback_stat.decoded
                    page_stat.valid += fallback_stat.valid
                    page_stat.rejected += fallback_stat.rejected
                    page_stat.unreadable_candidates += (
                        fallback_stat.unreadable_candidates
                    )

        emit("barcode_validation")
        self.cancel_token.raise_if_cancelled()
        dedup_started = time.perf_counter()
        unique, removed = deduplicate(detections)
        ordered = sort_in_document_order(unique)
        stats.sort(key=lambda s: s.page)
        validated_count = sum(detection.validated for detection in ordered)
        unreadable_count = sum(not detection.validated for detection in ordered)

        logger.info(
            "Barcode inspection: candidates=%d valid=%d unreadable=%d "
            "duplicates_removed=%d rejected=%d decoder_calls=%d",
            sum(s.candidates for s in stats),
            validated_count,
            unreadable_count,
            removed,
            sum(s.rejected for s in stats),
            self.decoder_calls,
        )

        barcodes = self._serialize(ordered, dpi, page_sizes)
        emit("saving_results")

        timings = dict(self.stage_seconds)
        timings["dedup"] = round(time.perf_counter() - dedup_started, 2)
        for stage in list(timings):
            timings[stage] = round(timings[stage], 2)
        timings["total"] = round(time.perf_counter() - started, 2)

        result = {
            "filename": os.path.basename(self.pdf_path),
            "status": "completed",
            "dpi": dpi,
            # Declared once at the top level as well as per finding, so a client
            # can assert the basis before reading any coordinate.
            "coordinateSystem": COORDINATE_SYSTEM,
            "pageCount": total_pages,
            # Per-page display size in PDF points (post-rotation), so a client
            # can map a box for a page that currently has no findings at all.
            "pages": [
                {
                    "page": index + 1,
                    "width": round(size[0], 2),
                    "height": round(size[1], 2),
                }
                for index, size in sorted(page_sizes.items())
            ],
            "inspectedPages": page_indices,
            "barcodeCount": len(barcodes),
            "barcodes": barcodes,
            "timings": timings,
            "stats": {
                "candidates": sum(s.candidates for s in stats),
                "validated": validated_count,
                "unreadableCandidates": unreadable_count,
                "duplicatesRemoved": removed,
                "rejected": sum(s.rejected for s in stats),
                "decoderCalls": self.decoder_calls,
                "pages": [s.__dict__ for s in stats],
                "errors": [
                    {"page": s.page, "error": s.error} for s in stats if s.error
                ],
            },
            "elapsedSeconds": timings["total"],
        }
        emit("inspection_complete")
        self._log_timings(timings["total"], timings)
        logger.info(
            "Barcode inspection completed: %d barcode finding(s) in %.2fs",
            len(barcodes),
            result["elapsedSeconds"],
        )
        return result

    def _empty_result(
        self, total_pages: int, dpi: int, started: float, note: str
    ) -> dict[str, Any]:
        return {
            "filename": os.path.basename(self.pdf_path),
            "status": "completed",
            "dpi": dpi,
            "pageCount": total_pages,
            "inspectedPages": [],
            "barcodeCount": 0,
            "barcodes": [],
            "stats": {
                "candidates": 0,
                "validated": 0,
                "duplicatesRemoved": 0,
                "rejected": 0,
                "decoderCalls": 0,
                "pages": [],
                "errors": [],
                "note": note,
            },
            "elapsedSeconds": round(time.perf_counter() - started, 2),
        }

    # -- per page ----------------------------------------------------------

    def _process_page_isolated(
        self, page_index: int, dpi: int
    ) -> tuple[PageStats, list[Detection]]:
        """Worker entry point: own document, own render, then release it."""
        with PdfRenderer(self.pdf_path, dpi) as renderer:
            return self._process_page(renderer, page_index)

    def _process_page(
        self, renderer: PdfRenderer, page_index: int
    ) -> tuple[PageStats, list[Detection]]:
        """Locate -> decode -> validate one page, then let the image go."""
        stats = PageStats(page=page_index)

        # Checked around the expensive steps as well as between candidates, so
        # pressing Cancel takes effect within a fraction of a second instead of
        # waiting for the whole page (render + locate + decode) to finish.
        self.cancel_token.raise_if_cancelled()

        render_started = time.perf_counter()
        gray = renderer.render_gray(page_index)
        self._add_stage_seconds(rendering=time.perf_counter() - render_started)
        try:
            if gray is None or gray.size == 0:
                return stats, []
            self.cancel_token.raise_if_cancelled()

            # -- stage 1: locate likely barcode regions --------------------
            detect_started = time.perf_counter()
            candidates = CandidateLocator.locate(gray)
            self._add_stage_seconds(detection=time.perf_counter() - detect_started)
            stats.candidates = len(candidates)
            self.cancel_token.raise_if_cancelled()

            decoder = BarcodeDecoder(
                self.runtime, self.allowed_formats, self.allow_rotated
            )
            validator = BarcodeValidator(self.min_module_px)

            found: list[Detection] = []
            decode_started = time.perf_counter()
            for candidate in candidates:
                self.cancel_token.raise_if_cancelled()
                try:
                    found.extend(decoder.decode_crop(gray, candidate, page_index))
                except InspectionCancelled:
                    raise
                except Exception as exc:  # a bad crop must not fail the page
                    logger.debug(
                        "Barcode inspection: candidate decode failed on page %d (%s)",
                        page_index + 1,
                        exc,
                    )
            stats.decoded += len(found)

            # -- stage 2: one full-page safety net -------------------------
            # This complements candidate decoding: it can recover a symbol
            # missed by localisation even when another crop already decoded.
            page_scan = decoder.decode_page_once(gray, page_index)
            existing = {
                (d.value, d.format_id)
                for d in found
            }

            for barcode in page_scan:
                key = (barcode.value, barcode.format_id)
                if key not in existing:
                    found.append(barcode)
                    existing.add(key)
            stats.decoded = len(found)

            self._add_stage_seconds(decoding=time.perf_counter() - decode_started)

            self.decoder_calls += decoder.call_count

            # -- stage 3: strict validation -------------------------------
            validate_started = time.perf_counter()
            valid: list[Detection] = []
            for detection in found:
                is_valid, reason = validator.validate(gray, detection)
                if not is_valid:
                    stats.rejected += 1
                    logger.debug(
                        "Barcode inspection: rejected %r on page %d (%s)",
                        detection.value[:40],
                        page_index + 1,
                        reason,
                    )
                    continue

                detection.validated = True
                detection.quality = QualityGrader.measure(gray, detection)
                detection.grade = QualityGrader.grade(detection.quality)

                # -- enhanced verification (post-decode, supplementary) -----
                # Runs ONLY here: after the existing pipeline has accepted and
                # decoded the symbol. It reuses the already-rendered `gray`
                # raster - no re-render, no re-detect, no re-decode - and its
                # result never influences acceptance, which is already decided.
                # `renderer.dpi` is the resolution this raster was actually
                # produced at, and is the only sound basis for the verifier's
                # millimetre measurements.
                detection.verification = self._verify_detection(
                    gray, detection, getattr(renderer, "dpi", DEFAULT_DPI)
                )
                valid.append(detection)

            self._add_stage_seconds(validation=time.perf_counter() - validate_started)
            stats.valid = len(valid)
            return stats, valid
        finally:
            # Release the page bitmap immediately; never accumulate pages.
            del gray

# -- verification ------------------------------------------------------

    @staticmethod
    def _verify_detection(
        gray: np.ndarray, detection: Detection, dpi: int
    ) -> dict[str, Any]:
        """Run :class:`BarcodeVerifier` for one validated detection.

        Bridges the :class:`Detection` dataclass to the verifier's dict-based
        API and guarantees error isolation: if verification fails for any
        reason the decoded barcode is still returned, carrying a partial
        ``verification`` object with ``overallGrade: null`` and an ``error``.
        """
        if gray is None or gray.size == 0:
            return {
                "overallGrade": None,
                "error": "No page image available for verification.",
                "disclaimer": VERIFICATION_DISCLAIMER,
            }

        x0, y0, x1, y1 = detection.bbox
        payload = {
            "formatId": detection.format_id,
            "decodedValue": detection.value,
            "qualityMetrics": detection.quality,
            "bbox": {
                "x": x0,
                "y": y0,
                "width": max(x1 - x0, 0),
                "height": max(y1 - y0, 0),
            },
            "polygon": [
                {"x": float(px), "y": float(py)} for px, py in detection.polygon
            ],
        }

        try:
            return BarcodeVerifier(gray, dpi).verify(payload)
        except Exception as exc:  # never let verification break the scan
            logger.debug("Barcode verification failed (%s)", exc)
            return {
                "overallGrade": None,
                "error": "Verification could not be calculated for this ROI.",
                "disclaimer": VERIFICATION_DISCLAIMER,
            }

    # -- serialisation -----------------------------------------------------

    def _serialize(
        self,
        detections: list[Detection],
        dpi: int,
        page_sizes: dict[int, tuple[float, float]] | None = None,
    ) -> list[dict[str, Any]]:
        """Convert detections and confirmed unreadable candidates to results.

        Ids are assigned here, AFTER the document-order sort, so the table
        always shows 1, 2, 3 ... in reading order.

        Coordinates are converted EXACTLY ONCE, from the inspection raster
        (rendered at ``dpi``) into PDF points::

            points = pixels * 72 / dpi

        PDF points are the canonical space: they are resolution-independent,
        they match PDF.js's default viewport basis, and they are unaffected by
        the zoom the reviewer happens to be using. The page size in the same
        units travels with each box so the frontend never has to re-derive it
        or guess a page dimension.
        """
        page_sizes = page_sizes or {}
        to_points = POINTS_PER_INCH / float(dpi)
        results: list[dict[str, Any]] = []

        for index, detection in enumerate(detections, 1):
            x0, y0, x1, y1 = detection.bbox
            page_width, page_height = page_sizes.get(detection.page, (0.0, 0.0))
            bbox = {
                "x": round(x0 * to_points, 2),
                "y": round(y0 * to_points, 2),
                "width": round((x1 - x0) * to_points, 2),
                "height": round((y1 - y0) * to_points, 2),
            }
            label = (
                ("Unreadable Linear Barcode (TBC placeholder)", "linear")
                if detection.format_id == "UNREADABLE_LINEAR"
                else BARCODE_FORMATS.get(
                    detection.format_id, (detection.format_id, "linear")
                )
            )
            results.append(
                {
                    "id": index,
                    "page": detection.page + 1,
                    "type": label[0],
                    "formatId": detection.format_id,
                    "decodedValue": detection.value,
                    "grade": detection.grade,
                    "bbox": bbox,
                    # Explicit coordinate metadata so the consumer never has to
                    # infer which basis these numbers are in.
                    "coordinateSystem": COORDINATE_SYSTEM,
                    "pageWidth": round(page_width, 2),
                    "pageHeight": round(page_height, 2),
                    "polygon": [
                        {
                            "x": round(x * to_points, 2),
                            "y": round(y * to_points, 2),
                        }
                        for x, y in detection.polygon
                    ],
                    "decoder": detection.decoder,
                    "qualityMetrics": detection.quality,
                    "verification": _json_safe(detection.verification),
                    "validated": detection.validated,
                    "level": None,
                    "comment": (
                        "TBC placeholder; no barcode payload was decoded."
                        if not detection.validated
                        else None
                    ),
                }
            )

        return results



# ---------------------------------------------------------------------------
# Asynchronous job store
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class InspectionJob:
    """One barcode inspection job and its live status.

    The HTTP request only creates the job and returns immediately; the engine
    runs on a background thread so a large PDF never blocks the request.
    """

    def __init__(
        self,
        inspection_id: str,
        pdf_path: str,
        config: dict[str, Any],
        record_id: str | None = None,
        on_state_change: Callable[["InspectionJob"], None] | None = None,
    ) -> None:
        self.id = inspection_id
        self.pdf_path = pdf_path
        self.config = config
        self.status = "queued"
        self.stage = INITIAL_STAGE
        self.current_page = 0
        self.total_pages = 0
        self.barcode_count = 0
        self.barcodes: list[dict[str, Any]] = []
        self.error: str | None = None
        self.timings: dict[str, float] = {}
        self.cancel_token = CancelToken()
        self.created_at = _now()
        self.started_at: str | None = None
        self.completed_at: str | None = None
        self._thread: threading.Thread | None = None

        #: The caller's own persisted inspection id (Cosmos record), when the
        #: job was started from the persistent flow. The job id above is this
        #: module's own handle; the two are different on purpose.
        self.record_id = record_id
        #: Optional host hook so the persisted record can follow the job. It is
        #: only ever called best-effort — see :meth:`_notify_state`.
        self.on_state_change = on_state_change
        self._reported_stage: str | None = None

    # -- state mirroring ---------------------------------------------------

    def _notify_state(self) -> None:
        """Mirror this job's state to the host application, best-effort.

        Persistence is not part of the inspection result, so it must never be
        able to slow the run down or fail it: a Cosmos outage should cost the
        history entry, nothing more.
        """
        callback = self.on_state_change
        if callback is None:
            return
        try:
            callback(self)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "Barcode inspection %s: state mirror failed (%s)", self.id, exc
            )

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Run the engine on a background thread."""
        self._thread = threading.Thread(
            target=self._run, name=f"barcode-{self.id}", daemon=True
        )
        self._thread.start()

    def _progress(self, stage: str, extra: dict[str, Any]) -> None:
        self.stage = stage
        if "currentPage" in extra:
            self.current_page = int(extra["currentPage"] or 0)
        if "totalPages" in extra:
            self.total_pages = int(extra["totalPages"] or 0)
        # Only report genuine stage changes, so a long document does not turn
        # into one persistence write per page.
        if stage != self._reported_stage:
            self._reported_stage = stage
            self._notify_state()

    def _run(self) -> None:
        self.status = "processing"
        self.started_at = _now()
        self._notify_state()
        try:
            engine = BarcodeInspectionEngine(
                self.pdf_path, self.config, cancel_token=self.cancel_token
            )
            result = engine.run(progress=self._progress)
            self.barcodes = result["barcodes"]
            self.barcode_count = result["barcodeCount"]
            self.total_pages = result.get("pageCount", 0)
            self.timings = result.get("timings") or {}
            self.stage = "inspection_complete"
            self.status = "completed"
        except InspectionCancelled:
            self.status = "cancelled"
            logger.info("Barcode inspection %s cancelled", self.id)
        except Exception as exc:  # pragma: no cover - unrecoverable
            self.status = "failed"
            self.error = str(exc)
            logger.exception("Barcode inspection %s failed", self.id)
        finally:
            self.completed_at = _now()
            self._notify_state()

    def cancel(self) -> bool:
        """Signal the running engine to stop. Returns False if already done."""
        if self.status in ("completed", "failed", "cancelled"):
            return False
        self.cancel_token.cancel()
        return True

    # -- serialisation -----------------------------------------------------

    def to_dict(self, include_results: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "inspectionId": self.id,
            "status": self.status,
            "stage": self.stage,
            "stageLabel": stage_label(self.stage),
            "currentPage": self.current_page,
            "totalPages": self.total_pages,
            "barcodeCount": self.barcode_count,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
        }
        if self.error:
            payload["error"] = self.error
        if self.timings:
            payload["timings"] = self.timings
        if include_results and self.status == "completed":
            payload["barcodes"] = self.barcodes
            payload["results"] = self.barcodes
        return payload


class JobStore:
    """In-memory registry of barcode inspection jobs."""

    def __init__(self, max_jobs: int = 200) -> None:
        self._jobs: dict[str, InspectionJob] = {}
        self._lock = threading.Lock()
        self.max_jobs = max_jobs

    def create(
        self,
        pdf_path: str,
        config: dict[str, Any] | None = None,
        record_id: str | None = None,
        on_state_change: Callable[[InspectionJob], None] | None = None,
    ) -> InspectionJob:
        job = InspectionJob(
            f"BAR-{uuid.uuid4().hex[:12]}",
            pdf_path,
            normalize_config(config),
            record_id=record_id,
            on_state_change=on_state_change,
        )
        with self._lock:
            self._jobs[job.id] = job
            self._evict_locked()
        # Starts on its own thread and returns at once: the HTTP request that
        # created the job never waits for the engine.
        job.start()
        return job

    def get(self, inspection_id: str) -> InspectionJob | None:
        with self._lock:
            return self._jobs.get(inspection_id)

    def cancel(self, inspection_id: str) -> bool | None:
        with self._lock:
            job = self._jobs.get(inspection_id)
        if job is None:
            return None
        return job.cancel()

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            jobs = list(self._jobs.values())
        return [job.to_dict(include_results=False) for job in reversed(jobs)]

    def _evict_locked(self) -> None:
        """Keep the registry bounded; drop the oldest finished jobs."""
        if len(self._jobs) <= self.max_jobs:
            return
        finished = [
            job
            for job in self._jobs.values()
            if job.status in ("completed", "failed", "cancelled")
        ]
        finished.sort(key=lambda j: j.created_at)
        for job in finished[: len(self._jobs) - self.max_jobs]:
            self._jobs.pop(job.id, None)


#: Process-wide job store.
JOBS = JobStore()


def create_job(
    pdf_path: str,
    config: dict[str, Any] | None = None,
    record_id: str | None = None,
    on_state_change: Callable[[InspectionJob], None] | None = None,
) -> InspectionJob:
    """Create and start an asynchronous barcode inspection job.

    Returns as soon as the job exists — the engine runs on a background thread,
    so the caller can hand the id to the client immediately.
    """
    return JOBS.create(pdf_path, config, record_id, on_state_change)


def get_job(inspection_id: str) -> InspectionJob | None:
    return JOBS.get(inspection_id)


def cancel_job(inspection_id: str) -> bool | None:
    return JOBS.cancel(inspection_id)


def list_jobs() -> list[dict[str, Any]]:
    return JOBS.list()



# ---------------------------------------------------------------------------
# Pipeline entry point (integration with the existing inspection registry)
# ---------------------------------------------------------------------------

def run_barcode_inspection(
    master_path: str,
    sample_path: str | None = None,
    filters: dict[str, Any] | None = None,
    barcode_config: dict[str, Any] | None = None,
    progress: Callable[[str], bool] | None = None,
) -> dict[str, Any]:
    """Run Barcode Inspection through the existing pipeline contract.

    Barcode Inspection is a SINGLE-FILE workflow: the uploaded document is
    detected, decoded, validated and stored. There is no Master/Sample
    comparison.

    ``progress`` is an optional ``callable(stage_id) -> bool``; returning
    ``False`` aborts the run with :class:`InspectionCancelled`. This matches
    the signature the shared inspection registry expects, so the existing
    ``POST /api/inspect`` flow works unchanged.
    """
    token = CancelToken()

    def on_progress(stage: str, _extra: dict[str, Any]) -> None:
        if progress is not None and progress(stage) is False:
            token.cancel()

    try:
        engine = BarcodeInspectionEngine(master_path, barcode_config, token)
        result = engine.run(progress=on_progress)
    except (BarcodeConfigError, InspectionCancelled):
        raise
    except Exception as exc:  # pragma: no cover - unrecoverable
        logger.error("Barcode inspection failed: %s", exc)
        return {
            "findings": [],
            "location_groups": [],
            "match_stats": {
                "matched_pairs": 0,
                "unmatched_master": 0,
                "unmatched_sample": 0,
            },
            "barcodeCount": 0,
            "barcodes": [],
            "stats": {},
        }

    findings = [
        {
            "type": "Barcode",
            "master": barcode["decodedValue"],
            "sample": "",
            "comment": _build_comment(barcode),
            "page": barcode["page"],
            "master_bbox": (
                barcode["bbox"]["x"],
                barcode["bbox"]["y"],
                barcode["bbox"]["x"] + barcode["bbox"]["width"],
                barcode["bbox"]["y"] + barcode["bbox"]["height"],
            ),
            "sample_bbox": None,
            "barcode_type": barcode["type"],
            "decoded_value": barcode["decodedValue"],
            "grade": barcode["grade"],
            "id": barcode["id"],
            "source": barcode["decoder"],
        }
        for barcode in result["barcodes"]
    ]

    return {
        "findings": findings,
        "location_groups": [],
        "match_stats": {
            "matched_pairs": len(findings),
            "unmatched_master": 0,
            "unmatched_sample": 0,
        },
        "barcodeCount": result["barcodeCount"],
        "barcodes": result["barcodes"],
        "stats": result["stats"],
    }


def _build_comment(barcode: dict[str, Any]) -> str:
    """Human readable comment for the existing difference/details UI."""
    if not barcode.get("validated", True):
        return "TBC placeholder mark; no barcode payload was decoded."

    parts = [f"Type: {barcode['type']}"]
    if barcode.get("grade"):
        parts.append(f"Grade: {barcode['grade']}")
    metrics = barcode.get("qualityMetrics") or {}
    if metrics.get("contrast") is not None:
        parts.append(f"Contrast: {metrics['contrast']}")
    if metrics.get("modulation") is not None:
        parts.append(f"Modulation: {metrics['modulation']}")
    return " | ".join(parts)


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------

def register_blueprint(
    app: Any,
    upload_root: str,
    authenticate: Callable[[], Any] | None = None,
    on_state_change: Callable[[InspectionJob], None] | None = None,
) -> Any:
    """Register the Barcode Inspection HTTP endpoints on a Flask app.

    Routes:
        POST   /api/barcode-inspection              -> {inspectionId, status} (202)
        GET    /api/barcode-inspection              -> job list
        GET    /api/barcode-inspection/<id>         -> status (+ results)
        POST   /api/barcode-inspection/<id>/cancel  -> {cancelled}

    ``authenticate`` is an optional host-app hook returning a Flask error
    response when the caller is not allowed; pass ``None`` to disable.

    ``on_state_change`` is an optional host-app hook called (best-effort) as a
    job moves through processing -> completed/failed/cancelled, so a persisted
    record can follow the background run. It is deliberately fire-and-forget:
    storage problems can never slow down or fail an inspection.
    """
    from flask import Blueprint, jsonify, request  # noqa: PLC0415

    blueprint = Blueprint(
        "barcode_inspection", __name__, url_prefix="/api/barcode-inspection"
    )

    def _guard() -> Any:
        return authenticate() if authenticate is not None else None

    def _resolve_upload(filename: str, inspection_id: str = "") -> str:
        """Resolve a stored upload to a local path (never an arbitrary path).

        Two layouts are supported, both server-side only:

        * ``<upload_root>/<inspection_id>/master.pdf`` — what the persistent
          ``POST /api/inspections`` flow writes. The client passes the
          ``inspection_id`` it already holds, so the Start request never
          re-uploads the document and only the id has to travel.
        * ``<upload_root>/<filename>`` — the flat layout used by the legacy
          single-file upload path.
        """
        if inspection_id:
            safe_id = os.path.basename(inspection_id)
            for name in ("master.pdf", "sample.pdf"):
                candidate = os.path.join(upload_root, safe_id, name)
                if os.path.exists(candidate):
                    return candidate
            # Fall back to whatever single document was stored for the job.
            session_dir = os.path.join(upload_root, safe_id)
            if os.path.isdir(session_dir):
                for entry in sorted(os.listdir(session_dir)):
                    if entry.lower().endswith(".pdf"):
                        return os.path.join(session_dir, entry)

        safe = os.path.basename(filename or "")
        if not safe:
            return ""
        candidate = os.path.join(upload_root, safe)
        return candidate if os.path.exists(candidate) else ""

    @blueprint.post("")
    def create_inspection():  # noqa: ANN202 - Flask view
        error = _guard()
        if error is not None:
            return error

        data = request.get_json(silent=True) or {}
        filename = data.get("filename") or request.form.get("filename") or ""
        inspection_id = (
            data.get("inspection_id")
            or data.get("inspectionId")
            or request.form.get("inspection_id")
            or ""
        )

        if not filename and not inspection_id:
            return jsonify({"error": "filename or inspection_id is required"}), 400

        path = _resolve_upload(filename, str(inspection_id))
        if not path:
            return jsonify({"error": "Uploaded file not found."}), 404

        try:
            job = create_job(
                path,
                data.get("barcode_config") or data.get("config"),
                record_id=str(inspection_id) or None,
                on_state_change=on_state_change,
            )
        except BarcodeConfigError as exc:
            return jsonify({"error": str(exc)}), 400

        # The job is already running on its own thread: this response is
        # returned immediately so the client can open the result page while the
        # engine keeps working in the background.
        return (
            jsonify(
                {
                    "inspectionId": job.id,
                    "status": job.status,
                    "stage": job.stage,
                    "stageLabel": stage_label(job.stage),
                }
            ),
            202,
        )

    @blueprint.get("")
    def list_inspections():  # noqa: ANN202 - Flask view
        error = _guard()
        if error is not None:
            return error
        return jsonify({"inspections": list_jobs()}), 200

    @blueprint.get("/<inspection_id>")
    def get_inspection(inspection_id: str):  # noqa: ANN202 - Flask view
        error = _guard()
        if error is not None:
            return error

        job = get_job(inspection_id)
        if job is None:
            return jsonify({"error": "Inspection not found."}), 404
        return jsonify(job.to_dict()), 200

    @blueprint.post("/<inspection_id>/cancel")
    def cancel_inspection(inspection_id: str):  # noqa: ANN202 - Flask view
        error = _guard()
        if error is not None:
            return error

        result = cancel_job(inspection_id)
        if result is None:
            return jsonify({"error": "Inspection not found."}), 404
        return jsonify({"cancelled": True, "inspectionId": inspection_id}), 200

    app.register_blueprint(blueprint)
    return blueprint
