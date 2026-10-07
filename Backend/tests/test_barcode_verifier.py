"""Tests for the enhanced BarcodeVerifier layer.

The verifier is a POST-DECODE analysis layer: these tests build synthetic
symbols and confirm the metrics are computed, that unmeasurable metrics return
None instead of fabricated values, that failures are isolated, and that the
existing ``qualityMetrics`` contract is untouched.
"""

import json
import os
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import barcode_inspection as bi
from barcode_inspection import BarcodeVerifier, score_to_grade


def make_linear_symbol(module_px=8, height=60, quiet=40):
    """Draw a synthetic linear symbol (dark bars on light paper)."""
    image = np.full((height + quiet * 2, 1200), 255, np.uint8)
    x = quiet
    # Alternating bar/space widths, including a deliberate wide element.
    pattern = [1, 1, 2, 1, 3, 1, 1, 2, 2, 1, 3, 2, 1, 1, 1, 2]
    for index, run in enumerate(pattern):
        width = run * module_px
        if index % 2 == 0:  # bars on even indices
            image[quiet:quiet + height, x:x + width] = 0
        x += width
    return image, (quiet, quiet, x, quiet + height)


def make_detection(format_id, box, value="5016695007878",
                   modulation=0.9, polygon=True):
    """Build a detection payload shaped like a serialised result."""
    payload = {
        "formatId": format_id,
        "decodedValue": value,
        "qualityMetrics": {"modulation": modulation},
        "bbox": {
            "x": box[0],
            "y": box[1],
            "width": box[2] - box[0],
            "height": box[3] - box[1],
        },
    }
    if polygon:
        payload["polygon"] = [
            {"x": box[0], "y": box[1]},
            {"x": box[2], "y": box[1]},
            {"x": box[2], "y": box[3]},
            {"x": box[0], "y": box[3]},
        ]
    return payload


class GradeHelperTests(unittest.TestCase):
    def test_grade_boundaries(self):
        self.assertEqual(score_to_grade(100), "A")
        self.assertEqual(score_to_grade(80), "A")
        self.assertEqual(score_to_grade(79.99), "B")
        self.assertEqual(score_to_grade(70), "B")
        self.assertEqual(score_to_grade(60), "C")
        self.assertEqual(score_to_grade(50), "D")
        self.assertEqual(score_to_grade(49.99), "F")
        self.assertEqual(score_to_grade(0), "F")

    def test_none_and_nan_are_not_failures(self):
        self.assertIsNone(score_to_grade(None))
        self.assertIsNone(score_to_grade(float("nan")))
        self.assertIsNone(score_to_grade(float("inf")))


class VerifierOutputTests(unittest.TestCase):
    """Cases 1-6: the supported symbologies."""

    LINEAR = ("EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "CODE_39")

    def test_linear_symbologies_produce_verification(self):
        for format_id in self.LINEAR:
            with self.subTest(format_id=format_id):
                image, box = make_linear_symbol()
                result = BarcodeVerifier(image, 300.0).verify(
                    make_detection(format_id, box)
                )
                self.assertIsNotNone(result["overallGrade"])
                self.assertEqual(result["disclaimer"], bi.VERIFICATION_DISCLAIMER)
                self.assertIsNotNone(result["symbolContrast"]["value"])
                self.assertIsNotNone(result["decodability"]["value"])
                self.assertIsNotNone(result["narrowBar"]["value"])

    def test_ean13_metrics_are_populated(self):
        """Case 1: EAN-13 returns the full documented metric set."""
        image, box = make_linear_symbol()
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box)
        )
        for key in ("overallGrade", "decodability", "magnification",
                    "symbolContrast", "minimumEdgeContrast", "modulation",
                    "defects", "decode", "quietZone", "narrowBar", "wideBar",
                    "wideToNarrowRatio", "gap", "dataStructure",
                    "minReflectance", "maxReflectance", "bwr"):
            self.assertIn(key, result)
        self.assertEqual(result["minReflectance"]["value"], 0.0)
        self.assertEqual(result["maxReflectance"]["value"], 100.0)

    def test_data_matrix_has_no_linear_metrics(self):
        """Case 6: a 2D symbol must not report linear-only measurements."""
        image = np.full((160, 160), 255, np.uint8)
        image[20:140, 20:140] = 0
        for y in range(30, 130, 12):
            image[y:y + 4, 30:130] = 255
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("DATA_MATRIX", (20, 20, 140, 140))
        )
        self.assertIsNone(result["narrowBar"])
        self.assertIsNone(result["wideBar"])
        self.assertIsNone(result["magnification"])
        self.assertIsNone(result["bwr"]["value"])
        # A 2D symbol reports its quiet zone on all four sides.
        self.assertIn("other", result["quietZone"])


class UnsupportedMetricTests(unittest.TestCase):
    """Cases 7 / section 32: unsupported metrics must be None, not invented."""

    def test_fixed_width_symbology_has_no_wide_bar(self):
        """EAN-13 is fixed-width: wideBar/ratio/gap must be None."""
        image, box = make_linear_symbol()
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box)
        )
        self.assertIsNone(result["wideBar"])
        self.assertIsNone(result["wideToNarrowRatio"])
        self.assertIsNone(result["gap"])

    def test_code39_does_report_wide_bar(self):
        """Case 5: Code 39 encodes wide elements, so they are measured."""
        image, box = make_linear_symbol()
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("CODE_39", box)
        )
        self.assertIsNotNone(result["wideBar"])
        self.assertIsNotNone(result["wideToNarrowRatio"])

    def test_data_structure_is_never_invented(self):
        image, box = make_linear_symbol()
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box)
        )
        self.assertIsNone(result["dataStructure"])

    def test_missing_dpi_yields_no_physical_measurements(self):
        """Without a usable DPI, millimetre values must be None."""
        image, box = make_linear_symbol()
        for dpi in (0, -1, None, float("nan")):
            with self.subTest(dpi=dpi):
                result = BarcodeVerifier(image, dpi).verify(
                    make_detection("EAN_13", box)
                )
                self.assertIsNone(result["narrowBar"])
                self.assertIsNone(result["bwr"]["value"])
                self.assertIsNone(result["magnification"])

    def test_pixel_to_millimetre_uses_supplied_dpi(self):
        """mm = px * 25.4 / dpi: doubling the DPI halves the millimetre value."""
        image, box = make_linear_symbol(module_px=8)
        at_300 = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box))
        at_600 = BarcodeVerifier(image, 600.0).verify(
            make_detection("EAN_13", box))
        # 8 px of module: 8 * 25.4 / 300 and 8 * 25.4 / 600.
        self.assertAlmostEqual(at_300["narrowBar"]["value"], 0.677, places=3)
        self.assertAlmostEqual(at_600["narrowBar"]["value"], 0.339, places=3)


class DefectTests(unittest.TestCase):
    """Cases 7/17: defects are lower-is-better and graded inverted."""

    def test_clean_symbol_has_no_defects_and_grades_best(self):
        image, box = make_linear_symbol()
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box))
        self.assertEqual(result["defects"]["value"], 0.0)
        self.assertEqual(result["defects"]["grade"], "A")

    def test_zero_defects_is_not_graded_bad(self):
        """Guards the lower-is-better inversion."""
        image, box = make_linear_symbol()
        verifier = BarcodeVerifier(image, 300.0)
        defects = verifier._defects(image[box[1]:box[3], box[0]:box[2]])
        if defects["value"] == 0.0:
            self.assertEqual(defects["grade"], "A")

    def test_broken_bar_is_detected(self):
        """A missing bar raises the defect count above zero."""
        image, box = make_linear_symbol()
        roi = image[box[1]:box[3], box[0]:box[2]]
        roi[10:25, 40:90] = 255  # erase a slice across part of the height
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box))
        self.assertGreater(result["defects"]["value"], 0.0)


class LowContrastTests(unittest.TestCase):
    """Case 9: a washed-out symbol must score worse than a clean one."""

    def test_low_contrast_scores_below_clean(self):
        image, box = make_linear_symbol()
        clean = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box))

        washed = np.clip(
            image.astype(np.float32) * 0.30 + 130.0, 0, 255
        ).astype(np.uint8)
        poor = BarcodeVerifier(washed, 300.0).verify(
            make_detection("EAN_13", box))

        self.assertLess(
            poor["symbolContrast"]["value"],
            clean["symbolContrast"]["value"],
        )
        self.assertEqual(poor["symbolContrast"]["grade"], "F")


class QuietZoneTests(unittest.TestCase):
    """Case 10: an insufficient quiet zone must be reported as such."""

    def test_absent_quiet_zone_side_is_none_or_low(self):
        image, box = make_linear_symbol(quiet=0)
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box))
        quiet = result["quietZone"]
        self.assertTrue(
            quiet["left"] is None or quiet["left"] < 100.0,
            f"expected no clean left quiet zone, got {quiet['left']}",
        )

    def test_generous_quiet_zone_scores_full(self):
        image, box = make_linear_symbol(quiet=40)
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box))
        self.assertEqual(result["quietZone"]["left"], 100.0)
        self.assertEqual(result["quietZone"]["right"], 100.0)


class RotatedSymbolTests(unittest.TestCase):
    """Case 8: a rotated symbol is analysed via its polygon."""

    def test_rotated_polygon_is_used(self):
        image, _ = make_linear_symbol()
        rotated = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
        payload = make_detection("EAN_13", (10, 10, 200, 400), polygon=False)
        # A diagonal quadrilateral rather than an axis-aligned rectangle.
        payload["polygon"] = [
            {"x": 40.0, "y": 10.0},
            {"x": 60.0, "y": 300.0},
            {"x": 140.0, "y": 290.0},
            {"x": 120.0, "y": 20.0},
        ]
        result = BarcodeVerifier(rotated, 300.0).verify(payload)
        self.assertIn("overallGrade", result)
        self.assertIn("symbolContrast", result)
        json.dumps(result)  # must not raise

    def test_bbox_fallback_when_no_polygon(self):
        image, box = make_linear_symbol()
        result = BarcodeVerifier(image, 300.0).verify(
            make_detection("EAN_13", box, polygon=False))
        self.assertIsNotNone(result["symbolContrast"]["value"])


class ErrorIsolationTests(unittest.TestCase):
    """Cases 7/27: verification must never break the inspection."""

    def test_blank_roi_returns_null_skeleton(self):
        """A ROI too small to measure returns nulls, not invented values."""
        blank = np.full((300, 400), 255, np.uint8)
        result = BarcodeVerifier(blank, 300.0).verify(
            make_detection("EAN_13", (10, 10, 14, 14)))
        self.assertIsNone(result["overallGrade"])
        self.assertIsNone(result["narrowBar"])
        self.assertIn("error", result)
        json.dumps(result)

    def test_blank_region_does_not_crash(self):
        """A featureless but measurable region is still reported safely."""
        blank = np.full((300, 400), 255, np.uint8)
        result = BarcodeVerifier(blank, 300.0).verify(
            make_detection("EAN_13", (10, 10, 30, 30)))
        json.dumps(result)
        self.assertIn("overallGrade", result)

    def test_non_dict_detection_is_handled(self):
        image, _ = make_linear_symbol()
        for bad in (None, "nonsense", 42, []):
            with self.subTest(bad=bad):
                result = BarcodeVerifier(image, 300.0).verify(bad)
                self.assertIsNone(result["overallGrade"])
                self.assertIn("error", result)

    def test_missing_geometry_is_handled(self):
        image, _ = make_linear_symbol()
        result = BarcodeVerifier(image, 300.0).verify(
            {"formatId": "EAN_13", "decodedValue": "1"})
        self.assertIsNone(result["overallGrade"])
        self.assertIn("error", result)

    def test_empty_image_is_handled(self):
        empty = np.zeros((0, 0), np.uint8)
        result = BarcodeVerifier(empty, 300.0).verify(
            make_detection("EAN_13", (0, 0, 10, 10)))
        self.assertIsNone(result["overallGrade"])


class DeterminismAndSerialisationTests(unittest.TestCase):
    """Cases 7/23: deterministic values and valid JSON."""

    def test_repeated_runs_are_identical(self):
        image, box = make_linear_symbol()
        verifier = BarcodeVerifier(image, 300.0)
        first = json.dumps(verifier.verify(make_detection("EAN_13", box)),
                           sort_keys=True)
        second = json.dumps(verifier.verify(make_detection("EAN_13", box)),
                            sort_keys=True)
        self.assertEqual(first, second)

    def test_payload_is_json_serialisable(self):
        image, box = make_linear_symbol()
        for format_id in ("EAN_13", "CODE_39", "DATA_MATRIX"):
            with self.subTest(format_id=format_id):
                result = BarcodeVerifier(image, 300.0).verify(
                    make_detection(format_id, box))
                # allow_nan=False proves no NaN/Infinity leaked into the payload.
                json.dumps(result, allow_nan=False)


class JsonSafeTests(unittest.TestCase):
    """Case 23: NumPy scalars and NaN/Infinity are coerced."""

    def test_numpy_scalars_become_python_types(self):
        converted = bi._json_safe({
            "f32": np.float32(1.5),
            "i32": np.int32(3),
            "bool": np.bool_(True),
            "nested": [np.float64(2.5)],
        })
        self.assertIsInstance(converted["f32"], float)
        self.assertIsInstance(converted["i32"], int)
        self.assertIsInstance(converted["bool"], bool)
        self.assertNotIsInstance(converted["bool"], np.bool_)
        self.assertIsInstance(converted["nested"][0], float)

    def test_nan_and_inf_become_null(self):
        converted = bi._json_safe({
            "nan": float("nan"),
            "inf": float("inf"),
            "ninf": float("-inf"),
        })
        self.assertIsNone(converted["nan"])
        self.assertIsNone(converted["inf"])
        self.assertIsNone(converted["ninf"])


class BackwardCompatibilityTests(unittest.TestCase):
    """Cases 6/25: the existing contract must survive."""

    def test_detection_has_verification_field(self):
        detection = bi.Detection(
            format_id="EAN_13", value="5016695007878", page=0,
            bbox=(0, 0, 10, 10), polygon=[], decoder="zxing-cpp",
        )
        self.assertEqual(detection.verification, {})
        self.assertEqual(detection.quality, {})

    def test_existing_quality_metrics_are_untouched(self):
        """QualityGrader output must keep its exact existing keys."""
        image, box = make_linear_symbol()
        detection = bi.Detection(
            format_id="EAN_13", value="5016695007878", page=0,
            bbox=box, polygon=[], decoder="zxing-cpp",
        )
        quality = bi.QualityGrader.measure(image, detection)
        for key in ("contrast", "modulation", "edgeSharpness", "coverage",
                    "aspectRatio", "quietZoneLeft", "quietZoneRight"):
            self.assertIn(key, quality)
        self.assertIsNotNone(bi.QualityGrader.grade(quality))

    def test_verify_detection_bridges_dataclass(self):
        image, box = make_linear_symbol()
        detection = bi.Detection(
            format_id="EAN_13", value="5016695007878", page=0,
            bbox=box,
            polygon=[(box[0], box[1]), (box[2], box[1]),
                     (box[2], box[3]), (box[0], box[3])],
            decoder="zxing-cpp", validated=True,
            quality={"modulation": 0.9},
        )
        result = bi.BarcodeInspectionEngine._verify_detection(
            image, detection, 300)
        self.assertIn("overallGrade", result)
        json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()