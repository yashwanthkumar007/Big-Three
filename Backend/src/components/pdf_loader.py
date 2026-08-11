"""
Low-level PDF loading. Opens a PDF file and returns the document object.
Kept separate from text_extractor.py so extraction logic isn't tied to
how the file was obtained (local path now; could be Blob Storage later).
"""

import fitz  # PyMuPDF
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from src.exception import PDFLoadError
from src.logger import logger


def load_pdf(pdf_path: str):
    """
    Opens a PDF file and returns the PyMuPDF document object.
    Raises PDFLoadError if the file can't be opened.
    """
    try:
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF not found at path: {pdf_path}")
        doc = fitz.open(pdf_path)
        logger.info(f"Loaded PDF: {pdf_path} ({len(doc)} page(s))")
        return doc
    except Exception as e:
        raise PDFLoadError(f"Failed to load PDF at {pdf_path}: {str(e)}", sys)
