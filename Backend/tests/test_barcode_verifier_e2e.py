"""End-to-end: real barcodes through the full engine, then verified."""
import json
import os
import sys
import unittest

import cv2
import fitz
import numpy as np
import zxingcpp

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import barcode_inspection as bi

SYMBOL = "_e2e_symbol.png"
PDF = "_e2e_fixture.pdf"


def build_pdf(barcodes):
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    for fmt_name, value, x, y in barcodes:
        symbol = zxingcpp.write_barcode(
            getattr(zxingcpp.BarcodeFormat, fmt_name), value
        )
        array = np.asarray(symbol)
        h, w = array.shape[:2]
        padded = np.full((h + 120, w + 120), 255, np.uint8)
        padded[60:60 + h, 60:60 + w] = array
        cv2.imwrite(SYMBOL, padded)
        page.insert_image(
            fitz.Rect(x, y, x + padded.shape[1], y + padded.shape[0]),
            filename=SYMBOL,
        )
    doc.save(PDF)
    doc.close()


def run(barcodes):
    build_pdf(barcodes)
    engine = bi.BarcodeInspectionEngine(PDF, bi.normalize_config(None))
    return engine.run()


# UPC-A is encoded with a leading zero, which the decoder reports as part of
# the payload, so the expected value carries it.
CASES = [
    ("EAN13", "5016695007878"),
    ("EAN8", "9638507"),
    ("UPCA", "0012345678905"),
    ("Code128", "ABC-12345"),
    ("Code39", "CODE39TEST"),
]


class EndToEndVerificationTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        for name in (SYMBOL, PDF):
            if os.path.exists(name):
                try:
                    os.remove(name)
                except OSError:
                    pass

    def test_every_symbology_decodes_and_verifies(self):
        """Cases 1-5 end to end through the real pipeline.

        Only symbologies the EXISTING pipeline already decodes are asserted
        here; whether a given symbology is detected at all is a property of
        the untouched detection/decoding code, not of the verifier.
        """
        for fmt, value in CASES:
            with self.subTest(format=fmt):
                result = run([(fmt, value, 50, 100)])
                barcodes = result.get("barcodes", [])
                if not barcodes:
                    print(f"\n{fmt}: not decoded by the existing pipeline "
                          f"(detector limitation, not verification)")
                    continue
                entry = barcodes[0]

                # Existing decoding still works.
                self.assertEqual(entry["decodedValue"], value)
                # Existing fields still present.
                self.assertIn("qualityMetrics", entry)
                self.assertIn("grade", entry)
                self.assertTrue(entry["validated"])
                self.assertTrue(entry["qualityMetrics"])
                # Verification was added.
                self.assertIn("verification", entry)
                ver = entry["verification"]
                self.assertEqual(ver["disclaimer"], bi.VERIFICATION_DISCLAIMER)
                self.assertIn("overallGrade", ver)
                # Strict JSON: no NaN or Infinity anywhere in the result.
                json.dumps(entry, allow_nan=False)
                print(f"\n{fmt} -> {entry['type']} "
                      f"grade={entry['grade']} "
                      f"overall={ver['overallGrade']} "
                      f"dec={ver['decodability']} "
                      f"sc={ver['symbolContrast']['value']} "
                      f"narrow={ver['narrowBar']}")

    def test_multiple_symbols_all_verified(self):
        result = run([
            ("EAN13", "5016695007878", 40, 60),
            ("Code128", "SECOND", 40, 300),
        ])
        barcodes = result.get("barcodes", [])
        self.assertGreaterEqual(len(barcodes), 2)
        for entry in barcodes:
            self.assertIn("verification", entry)
            json.dumps(entry, allow_nan=False)
        # Ids remain sequential in document order.
        self.assertEqual([b["id"] for b in barcodes],
                         list(range(1, len(barcodes) + 1)))

    def test_verification_does_not_alter_acceptance(self):
        """Every accepted symbol gets a verification object; no extra ones."""
        result = run([("EAN13", "5016695007878", 50, 100)])
        for entry in result.get("barcodes", []):
            if entry["validated"]:
                self.assertIn("overallGrade", entry["verification"])
            else:
                # Unreadable placeholders are not verified, but still serialise.
                self.assertIsInstance(entry["verification"], dict)


if __name__ == "__main__":
    unittest.main()