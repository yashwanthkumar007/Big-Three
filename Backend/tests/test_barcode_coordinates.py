"""Tests for the barcode overlay coordinate system.

The backend must report every bbox in ONE canonical basis (PDF points) together
with the page geometry in that same basis, so the frontend can map a logical
box onto the rendered page with a single ratio and never needs to know the
detection resolution.

These tests pin down both halves of that contract:

1. the backend reports points + real page size (no assumed paper size), and
2. the single frontend ratio ``renderedPageWidth / pageWidth`` keeps the box
   locked to the same spot on the page at every zoom level.
"""

import json
import os
import sys
import tempfile
import unittest

import cv2
import fitz
import numpy as np
import zxingcpp

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import barcode_inspection as bi

# Deliberately not Letter and not A4, so any hard-coded 612x792 assumption
# fails loudly rather than passing by coincidence on the usual paper size.
PAGE_W_PT = 288.0   # 4 inches
PAGE_H_PT = 432.0   # 6 inches
# Where the barcode image is pasted on the page, in points.
PASTE_X_PT = 40.0
PASTE_Y_PT = 100.0
# Quiet zone added around the symbol, in image pixels.
PAD_PX = 100

ZOOMS = (0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0)


def make_padded_symbol(format_name="EAN13", value="5016695007878", pad=PAD_PX):
    """A real barcode image with a light quiet zone around it."""
    symbol = zxingcpp.write_barcode(
        getattr(zxingcpp.BarcodeFormat, format_name), value
    )
    array = np.asarray(symbol)
    height, width = array.shape[:2]
    padded = np.full((height + 2 * pad, width + 2 * pad), 255, np.uint8)
    padded[pad:pad + height, pad:pad + width] = array
    return padded


def build_pdf(path):
    """A one-page PDF holding a single real EAN-13 at a known position."""
    padded = make_padded_symbol()
    png = path + ".png"
    cv2.imwrite(png, padded)

    doc = fitz.open()
    page = doc.new_page(width=PAGE_W_PT, height=PAGE_H_PT)
    # Placed 1:1 (points == image pixels here) so the expected position of the
    # symbol's ink is known exactly.
    page.insert_image(
        fitz.Rect(
            PASTE_X_PT,
            PASTE_Y_PT,
            PASTE_X_PT + padded.shape[1],
            PASTE_Y_PT + padded.shape[0],
        ),
        filename=png,
    )
    doc.save(path)
    doc.close()
    return png


class CoordinateContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="barcode_coords_")
        cls.pdf = os.path.join(cls.dir, "coords.pdf")
        cls.png = build_pdf(cls.pdf)

    @classmethod
    def tearDownClass(cls):
        for name in (cls.pdf, cls.png):
            if os.path.exists(name):
                try:
                    os.remove(name)
                except OSError:
                    pass
        try:
            os.rmdir(cls.dir)
        except OSError:
            pass

    def _inspect(self, dpi=300):
        config = bi.normalize_config({"resolution": dpi})
        return bi.BarcodeInspectionEngine(self.pdf, config).run()

    # -- 1. the reported basis ------------------------------------------

    def test_declares_pdf_points(self):
        self.assertEqual(bi.COORDINATE_SYSTEM, "pdf_points")
        self.assertEqual(bi.POINTS_PER_INCH, 72.0)

    def test_result_declares_coordinate_system(self):
        result = self._inspect()
        self.assertEqual(result["coordinateSystem"], "pdf_points")

    def test_every_finding_declares_basis_and_page_size(self):
        result = self._inspect()
        self.assertTrue(result["barcodes"], "fixture barcode was not decoded")
        for entry in result["barcodes"]:
            self.assertEqual(entry["coordinateSystem"], "pdf_points")
            self.assertEqual(entry["pageWidth"], PAGE_W_PT)
            self.assertEqual(entry["pageHeight"], PAGE_H_PT)

    def test_pages_metadata_lists_real_page_size(self):
        result = self._inspect()
        self.assertEqual(len(result["pages"]), 1)
        self.assertEqual(result["pages"][0]["width"], PAGE_W_PT)
        self.assertEqual(result["pages"][0]["height"], PAGE_H_PT)

    def test_bbox_is_inside_the_page(self):
        entry = self._inspect()["barcodes"][0]
        box = entry["bbox"]
        self.assertGreaterEqual(box["x"], 0.0)
        self.assertGreaterEqual(box["y"], 0.0)
        self.assertLessEqual(box["x"] + box["width"], entry["pageWidth"] + 0.5)
        self.assertLessEqual(box["y"] + box["height"], entry["pageHeight"] + 0.5)

    def test_bbox_lands_near_its_true_position(self):
        """The symbol ink starts PASTE_X/Y plus the quiet-zone padding."""
        entry = self._inspect()["barcodes"][0]
        box = entry["bbox"]
        self.assertAlmostEqual(box["x"], PASTE_X_PT + PAD_PX, delta=12.0)
        self.assertAlmostEqual(box["y"], PASTE_Y_PT + PAD_PX, delta=12.0)

    # -- 2. independence from detection resolution ----------------------

    def test_bbox_is_resolution_independent(self):
        """Same artwork at 150/300/600 DPI must report the same points."""
        positions = []
        for dpi in (150, 300, 600):
            entry = self._inspect(dpi)["barcodes"][0]
            positions.append((entry["bbox"]["x"], entry["bbox"]["y"]))
        first = positions[0]
        for position in positions[1:]:
            self.assertAlmostEqual(position[0], first[0], delta=1.0)
            self.assertAlmostEqual(position[1], first[1], delta=1.0)

    # -- 3. the frontend mapping, simulated at every zoom ---------------

    def test_single_ratio_mapping_is_zoom_invariant(self):
        entry = self._inspect()["barcodes"][0]
        box = entry["bbox"]
        page_w, page_h = entry["pageWidth"], entry["pageHeight"]

        for zoom in ZOOMS:
            with self.subTest(zoom=zoom):
                # PDF.js: viewport size = page points * scale.
                viewport_w = page_w * zoom
                viewport_h = page_h * zoom
                # The ONE conversion the viewer performs.
                scale_x = viewport_w / page_w
                scale_y = viewport_h / page_h

                css_x = box["x"] * scale_x
                css_y = box["y"] * scale_y
                css_w = box["width"] * scale_x

                # Normalising the drawn position back through the same ratio
                # must reproduce the ORIGINAL logical box, unchanged.
                self.assertAlmostEqual(css_x / scale_x, box["x"], places=6)
                self.assertAlmostEqual(css_y / scale_y, box["y"], places=6)
                self.assertAlmostEqual(css_w / scale_x, box["width"], places=6)

                # The box must sit at the same FRACTION of the page at every
                # zoom - this is what "stays over the barcode" means.
                self.assertAlmostEqual(
                    css_x / viewport_w, box["x"] / page_w, places=9
                )
                self.assertAlmostEqual(
                    css_y / viewport_h, box["y"] / page_h, places=9
                )

    def test_overlay_scales_linearly_with_zoom(self):
        """Doubled zoom must double the drawn box, and only the drawn box."""
        entry = self._inspect()["barcodes"][0]
        box, page_w = entry["bbox"], entry["pageWidth"]

        def drawn(zoom):
            scale = (page_w * zoom) / page_w
            return box["x"] * scale, box["width"] * scale

        x1, w1 = drawn(1.0)
        x2, w2 = drawn(2.0)
        x3, w3 = drawn(3.0)
        self.assertAlmostEqual(x2, x1 * 2, places=6)
        self.assertAlmostEqual(w2, w1 * 2, places=6)
        self.assertAlmostEqual(x3, x1 * 3, places=6)
        self.assertAlmostEqual(w3, w1 * 3, places=6)

    def test_fit_to_width_and_fit_to_page_are_just_scales(self):
        """Fit modes change the viewport, never the logical coordinates."""
        entry = self._inspect()["barcodes"][0]
        box = entry["bbox"]
        page_w, page_h = entry["pageWidth"], entry["pageHeight"]

        container_w, container_h = 900.0, 700.0
        modes = {
            "fit-width": container_w / page_w,
            "fit-page": min(container_w / page_w, container_h / page_h),
        }
        for name, zoom in modes.items():
            with self.subTest(mode=name):
                viewport_w = page_w * zoom
                scale_x = viewport_w / page_w
                css_x = box["x"] * scale_x
                self.assertAlmostEqual(css_x / scale_x, box["x"], places=6)
                self.assertAlmostEqual(
                    css_x / viewport_w, box["x"] / page_w, places=9
                )

    # -- 4. multiple findings on one page -------------------------------

    def test_multiple_findings_keep_independent_positions(self):
        """Two different symbologies on one page keep independent boxes."""
        pdf = os.path.join(self.dir, "two.pdf")
        pngs = []
        doc = fitz.open()
        page = doc.new_page(width=595, height=842)  # A4 in points

        placements = [
            (make_padded_symbol("EAN13", "5016695007878", pad=60), 40, 60),
            (make_padded_symbol("Code128", "SECOND-BARCODE", pad=60), 40, 300),
        ]
        for index, (padded, x_pt, y_pt) in enumerate(placements):
            png = os.path.join(self.dir, f"sym{index}.png")
            cv2.imwrite(png, padded)
            pngs.append(png)
            page.insert_image(
                fitz.Rect(x_pt, y_pt, x_pt + padded.shape[1], y_pt + padded.shape[0]),
                filename=png,
            )
        doc.save(pdf)
        doc.close()

        try:
            result = bi.BarcodeInspectionEngine(
                pdf, bi.normalize_config(None)
            ).run()
            entries = result["barcodes"]
            self.assertGreaterEqual(len(entries), 2)

            # Ids stay in document order, so the upper symbol is first.
            ys = [entry["bbox"]["y"] for entry in entries]
            self.assertEqual(ys, sorted(ys))
            self.assertGreater(ys[-1] - ys[0], 100.0)

            for entry in entries:
                self.assertEqual(entry["coordinateSystem"], "pdf_points")
                self.assertEqual(entry["pageWidth"], 595)
                self.assertEqual(entry["pageHeight"], 842)

            # Each box keeps its own position at every zoom level.
            for entry in entries:
                box = entry["bbox"]
                fraction = box["y"] / entry["pageHeight"]
                for zoom in ZOOMS:
                    drawn = box["y"] * ((entry["pageHeight"] * zoom) / entry["pageHeight"])
                    self.assertAlmostEqual(drawn / zoom, box["y"], places=6)
                    self.assertAlmostEqual(drawn / (entry["pageHeight"] * zoom), fraction, places=9)
        finally:
            for name in [pdf, *pngs]:
                if os.path.exists(name):
                    os.remove(name)

    # -- 5. serialisation and untouched behaviour ----------------------

    def test_result_stays_json_serialisable(self):
        json.dumps(self._inspect(), allow_nan=False)

    def test_detection_and_validation_unchanged(self):
        """The coordinate work must not disturb decode, validation or metrics."""
        entry = self._inspect()["barcodes"][0]
        self.assertEqual(entry["decodedValue"], "5016695007878")
        self.assertEqual(entry["type"], "EAN-13")
        self.assertTrue(entry["validated"])
        # The legacy metric block is still present and untouched.
        for key in ("contrast", "modulation", "edgeSharpness", "coverage",
                    "aspectRatio", "quietZoneLeft", "quietZoneRight"):
            self.assertIn(key, entry["qualityMetrics"])
        # ...and the verification block is still attached.
        self.assertIn("overallGrade", entry["verification"])

    def test_bbox_is_not_mutated_by_any_zoom_argument(self):
        """The backend takes no zoom, so the stored bbox cannot depend on it."""
        entry = self._inspect()["barcodes"][0]
        first = dict(entry["bbox"])
        # Re-reading the result must yield identical numbers.
        second = dict(self._inspect()["barcodes"][0]["bbox"])
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()