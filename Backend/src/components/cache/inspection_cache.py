"""
Inspection Extraction Cache — disk-backed, fingerprint-validated cache for
PDF extraction results so the same PDF is only ever parsed ONCE per session
workflow (initial inspection + subsequent Crop Compare requests).

Design:
  - Cache files live under <Backend>/cache/extractions/ and are plain
    pickles, one per (pdf fingerprint, payload kind).
  - A fingerprint is built from the PDF's absolute path + file size +
    modification time. If a PDF changes, the fingerprint changes and the
    stale entry is never used (and is overwritten on next save).
  - Payload kinds:
      "lines"                 -> the extract_lines() DataFrame
      "table_rows_<page>"     -> extract_table_rows() output for one page
  - Sessions are represented by the PDF path (webapp_uploads/<session_id>/
    master.pdf|sample.pdf), so master and sample are cached independently
    and crop requests resolve the same entries without any session plumbing.

All accessors are defensive: any cache read/write failure falls back to
behaving as if the cache is empty — extraction correctness is never
affected by cache problems.
"""

import os
import pickle
import hashlib
import time

from src.logger import logger

# <Backend>/cache/extractions  (this file is src/components/cache/x.py)
CACHE_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "cache", "extractions",
)

# Entries older than this are ignored/evicted. Long enough to cover a full
# inspection session plus many crop queries, short enough that disk usage
# stays bounded.
CACHE_TTL_SECONDS = 6 * 3600


def _fingerprint(pdf_path: str) -> str:
    """Stable fingerprint of a PDF: absolute path + size + mtime (ns)."""
    st = os.stat(pdf_path)
    raw = f"{os.path.abspath(pdf_path)}|{st.st_size}|{st.st_mtime_ns}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _cache_path(pdf_path: str, kind: str) -> str:
    return os.path.join(CACHE_ROOT, f"{_fingerprint(pdf_path)}__{kind}.pkl")


def _is_fresh(path: str) -> bool:
    try:
        return (time.time() - os.path.getmtime(path)) < CACHE_TTL_SECONDS
    except OSError:
        return False


def save_extraction(session_id: str, document_type: str, pdf_path: str, lines) -> None:
    """Saves the extracted lines DataFrame for one document of a session."""
    save_lines(pdf_path, lines)


def load_extraction(session_id: str, document_type: str, pdf_path: str):
    """Loads the extracted lines DataFrame, or None on any miss/failure."""
    return load_lines(pdf_path)


def has_valid_extraction(session_id: str, document_type: str, pdf_path: str) -> bool:
    return has_lines(pdf_path)


def clear_extraction(session_id: str, document_type: str, pdf_path: str) -> None:
    clear_pdf(pdf_path)


def save_lines(pdf_path: str, lines_df) -> None:
    try:
        os.makedirs(CACHE_ROOT, exist_ok=True)
        tmp = _cache_path(pdf_path, "lines") + ".tmp"
        with open(tmp, "wb") as fh:
            pickle.dump(lines_df, fh, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, _cache_path(pdf_path, "lines"))
        logger.info(f"[PERF] Extraction cache saved: lines ({len(lines_df)} row(s)) for {pdf_path}")
    except Exception as e:
        logger.warning(f"Extraction cache save failed for {pdf_path}: {e}")

def load_lines(pdf_path: str):
    """Returns the cached lines DataFrame, or None on miss/stale/failure."""
    path = _cache_path(pdf_path, "lines")
    if not _is_fresh(path):
        return None
    try:
        with open(path, "rb") as fh:
            df = pickle.load(fh)
        logger.info(f"[PERF] Extraction cache hit: lines ({len(df)} row(s)) for {pdf_path}")
        return df
    except Exception as e:
        logger.warning(f"Extraction cache load failed for {pdf_path}: {e}")
        return None


def has_lines(pdf_path: str) -> bool:
    return load_lines(pdf_path) is not None


def save_table_rows(pdf_path: str, page_number: int, rows: list) -> None:
    try:
        os.makedirs(CACHE_ROOT, exist_ok=True)
        tmp = _cache_path(pdf_path, f"table_rows_{page_number}") + ".tmp"
        with open(tmp, "wb") as fh:
            pickle.dump(rows, fh, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, _cache_path(pdf_path, f"table_rows_{page_number}"))
        logger.info(f"[PERF] Extraction cache saved: table_rows page={page_number} ({len(rows)} row(s)) for {pdf_path}")
    except Exception as e:
        logger.warning(f"Extraction cache save failed for {pdf_path}: {e}")


def load_table_rows(pdf_path: str, page_number: int):
    """Returns cached table rows for a page, or None on miss/stale/failure."""
    path = _cache_path(pdf_path, f"table_rows_{page_number}")
    if not _is_fresh(path):
        return None
    try:
        with open(path, "rb") as fh:
            rows = pickle.load(fh)
        logger.info(f"[PERF] Extraction cache hit: table_rows page={page_number} ({len(rows)} row(s)) for {pdf_path}")
        return rows
    except Exception as e:
        logger.warning(f"Extraction cache load failed for {pdf_path}: {e}")
        return None


def get_or_extract_lines(pdf_path: str, extract_fn):
    """
    Returns cached lines if a valid entry exists, otherwise calls
    extract_fn(pdf_path) once and caches the result. Single entry point for
    both the full pipeline and Crop Compare, so a crop request never
    re-parses the full PDF when the initial inspection already populated
    the cache.
    """
    t0 = time.perf_counter()
    cleanup_expired()
    cached = load_lines(pdf_path)
    if cached is not None:
        logger.info(f"[PERF] {pdf_path}: using cached extraction ({time.perf_counter() - t0:.2f}s)")
        return cached
    logger.info(f"[PERF] {pdf_path}: cache miss - rebuilding extraction")
    lines_df = extract_fn(pdf_path)
    logger.info(f"[PERF] {pdf_path}: extraction completed in {time.perf_counter() - t0:.2f}s")
    save_lines(pdf_path, lines_df)
    return lines_df


def get_or_extract_table_rows(pdf_path: str, page_number: int, extract_fn):
    """Same contract as get_or_extract_lines, for per-page table rows."""
    cached = load_table_rows(pdf_path, page_number)
    if cached is not None:
        logger.info(f"[PERF] {pdf_path}: using cached table rows (page {page_number})")
        return cached
    logger.info(f"[PERF] {pdf_path}: cache miss - rebuilding table rows (page {page_number})")
    rows = extract_fn(pdf_path, page_number)
    save_table_rows(pdf_path, page_number, rows)
    return rows


def clear_pdf(pdf_path: str) -> None:
    """Removes every cache entry belonging to one PDF."""
    try:
        fp = _fingerprint(pdf_path)
    except OSError:
        return
    if not os.path.isdir(CACHE_ROOT):
        return
    removed = 0
    for name in os.listdir(CACHE_ROOT):
        if name.startswith(fp):
            try:
                os.remove(os.path.join(CACHE_ROOT, name))
                removed += 1
            except OSError:
                pass
    if removed:
        logger.info(f"[PERF] Extraction cache cleared: {removed} file(s) for {pdf_path}")


def clear_all() -> None:
    """Removes the entire extraction cache directory contents."""
    if not os.path.isdir(CACHE_ROOT):
        return
    count = 0
    for name in os.listdir(CACHE_ROOT):
        try:
            os.remove(os.path.join(CACHE_ROOT, name))
            count += 1
        except OSError:
            pass
    if count:
        logger.info(f"[PERF] Extraction cache cleared: {count} file(s)")


def cleanup_expired() -> None:
    """Evicts stale entries. Safe to call opportunistically."""
    if not os.path.isdir(CACHE_ROOT):
        return
    now = time.time()
    for name in os.listdir(CACHE_ROOT):
        path = os.path.join(CACHE_ROOT, name)
        try:
            if (now - os.path.getmtime(path)) >= CACHE_TTL_SECONDS:
                os.remove(path)
        except OSError:
            pass
