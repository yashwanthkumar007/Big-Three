"""Tests for the single-file Barcode Inspection backend.

The engine is one module (``Backend/barcode_inspection.py``); these tests
cover its config, validator, de-duplication, ordering, cancellation, grading
and end-to-end behaviour (text must never become a barcode).
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import barcode_inspection as bi
from barcode_inspection import (
    BarcodeConfigError,
    BarcodeInspectionEngine,
    Candidate,
    CancelToken,
    Detection,
    InspectionCancelled,
    Runtime,
    deduplicate,
    normalize_config,
    resolve_page_indices,
    sort_in_document_order,
    stage_label,
)


class ConfigurationTests(unittest.TestCase):
    def test_defaults(self):
        config = normalize_config(None)
        self.assertEqual(config["profile"], "default")
        self.assertEqual(config["resolution"], 300)
        self.assertTrue(config["enableOverprint"])
        self.assertEqual(config["pages"], "all")

    def test_unknown_profile_falls_back(self):
        self.assertEqual(normalize_config({"profile": "nope"})["profile"], "default")

    def test_resolution_must_be_supported(self):
        self.assertEqual(normalize_config({"resolution": 600})["resolution"], 600)
        self.assertEqual(normalize_config({"resolution": 999})["resolution"], 300)
        self.assertEqual(normalize_config({"resolution": "400"})["resolution"], 400)

    def test_pages_accept_all_single_and_list(self):
        self.assertEqual(normalize_config({"pages": "all"})["pages"], "all")
        self.assertEqual(normalize_config({"pages": 2})["pages"], 2)
        self.assertEqual(normalize_config({"pages": [1, 3, 3]})["pages"], [1, 3])

    def test_empty_page_selection_is_rejected(self):
        with self.assertRaises(BarcodeConfigError):
            normalize_config({"pages": []})

    def test_page_indices_are_one_based(self):
        self.assertEqual(resolve_page_indices("all", 3), [0, 1, 2])
        self.assertEqual(resolve_page_indices([1, 3], 3), [0, 2])
        self.assertEqual(resolve_page_indices(9, 3), [])

    def test_stage_labels_never_mention_master_sample_or_difference(self):
        for label in bi.STAGE_LABELS.values():
            lowered = label.lower()
            for word in ("master", "sample", "difference", "compar"):
                self.assertNotIn(word, lowered)

    def test_unknown_stage_falls_back_to_detection(self):
        self.assertEqual(stage_label(None), "Barcode Detection")
        self.assertEqual(stage_label("barcode_decoding"), "Barcode Decoding")


class RuntimeTests(unittest.TestCase):
    def test_runtime_is_initialised_once(self):
        first = Runtime.instance()
        second = Runtime.instance()
        self.assertIs(first, second)
        self.assertTrue(first.decoder_available, "zxing-cpp must be installed")
        self.assertGreaterEqual(first.max_workers, 1)
        self.assertLessEqual(first.max_workers, 4)

    def test_format_resolution_covers_the_catalogued_formats(self):
        resolved = Runtime.instance().resolve_formats(list(bi.BARCODE_FORMATS.keys()))
        self.assertIsNotNone(resolved)
        self.assertGreaterEqual(len(resolved), 10)


class DecodeVariantTests(unittest.TestCase):
    def test_decode_variants_try_original_before_enhancements(self):
        import numpy as np

        image = np.tile(np.arange(64, dtype=np.uint8), (48, 1))
        variants = BarcodeDecoder._decode_variants(image)

        self.assertEqual(variants[0][0], "original")
        self.assertIs(variants[0][1], image)
        self.assertEqual(
            [name for name, _variant in variants[1:]],
            ["clahe", "otsu", "adaptive", "sharpen", "contrast"],
        )
        self.assertTrue(all(variant.shape == image.shape for _, variant in variants))

    def test_affine_mapping_restores_crop_coordinates_and_offset(self):
        import cv2

        detection = Detection(
            format_id="QR_CODE", value="payload", page=0,
            bbox=(10, 20, 30, 40),
            polygon=[(10, 20), (30, 20), (30, 40), (10, 40)],
            decoder="test",
        )
        transform = cv2.getRotationMatrix2D((50, 50), 5, 1.0)

        mapped = BarcodeDecoder._map_detections([detection], transform, (100, 200))

        self.assertIs(mapped[0], detection)
        self.assertEqual(detection.page, 0)
        self.assertTrue(all(x >= 100 and y >= 200 for x, y in detection.polygon))
        x0, y0, x1, y1 = detection.bbox
        self.assertEqual(x0, min(point[0] for point in detection.polygon))
        self.assertEqual(y0, min(point[1] for point in detection.polygon))
        self.assertEqual(x1, max(point[0] for point in detection.polygon))
        self.assertEqual(y1, max(point[1] for point in detection.polygon))



class ValidationTests(unittest.TestCase):
    """The layer that stops ordinary text becoming a barcode."""

    def setUp(self):
        self.validator = bi.BarcodeValidator()
        self.detector = bi.Detection(
            format_id="CODE_39", value="FORGENERALABACAVIR", page=0,
            bbox=(10, 90, 390, 110), polygon=[], decoder="test",
        )

    def test_sentence_payload_is_rejected(self):
        import numpy as np

        image = np.zeros((200, 400, 3), np.uint8)
        self.detector.value = "CALL THE NEAREST HOSPITAL"
        valid, reason = self.validator.validate(image, self.detector)
        self.assertFalse(valid)
        self.assertEqual(reason, "payload_contains_whitespace")

    def test_wide_flat_text_strip_is_rejected(self):
        import numpy as np

        # A line of text: a short, very wide, low bar-count strip.
        image = np.full((200, 400, 3), 255, np.uint8)
        for x in range(10, 390, 9):
            image[90:110, x:x + 4] = 0

        valid, reason = self.validator.validate(image, self.detector)
        self.assertFalse(valid)
        self.assertIn(
            reason.split("(")[0],
            {
                "aspect_too_low",
                "aspect_too_high",
                "too_few_bar_runs",
                "insufficient_quiet_zone",
                "irregular_bar_widths",
            },
        )

    def test_empty_payload_is_rejected(self):
        import numpy as np

        image = np.zeros((200, 400, 3), np.uint8)
        self.detector.value = ""
        valid, reason = self.validator.validate(image, self.detector)
        self.assertFalse(valid)
        self.assertEqual(reason, "empty_payload")

    def test_low_contrast_is_rejected(self):
        import numpy as np

        image = np.full((200, 400, 3), 120, np.uint8)
        valid, reason = self.validator.validate(image, self.detector)
        self.assertFalse(valid)
        self.assertEqual(reason, "insufficient_contrast")

    def test_realistic_barcode_region_is_accepted(self):
        import numpy as np

        image = np.full((300, 600), 255, np.uint8)
        # A dense, regular run of bars with clear quiet zones either side.
        for index, x in enumerate(range(120, 480)):
            if index % 3 != 0:
                image[120:240, x] = 0

        self.detector.bbox = (120, 120, 480, 240)
        valid, reason = self.validator.validate(image, self.detector)
        self.assertTrue(valid, f"expected valid, got {reason}")


class DedupAndOrderTests(unittest.TestCase):
    @staticmethod
    def _detection(value, bbox, page=0, fmt="EAN_13"):
        return Detection(
            format_id=fmt, value=value, page=page, bbox=bbox, polygon=[],
            decoder="test", validated=True,
        )

    def test_duplicates_are_collapsed(self):
        first = self._detection("5016695007878", (10, 10, 110, 90))
        # The same symbol found again a few pixels away.
        second = self._detection("5016695007878", (12, 11, 112, 91))
        elsewhere = self._detection("5016695007878", (400, 400, 500, 480))

        unique, removed = deduplicate([first, second, elsewhere])
        self.assertEqual(len(unique), 2)
        self.assertEqual(removed, 1)

    def test_different_values_are_not_merged(self):
        a = self._detection("111", (10, 10, 110, 90))
        b = self._detection("222", (10, 10, 110, 90))
        unique, removed = deduplicate([a, b])
        self.assertEqual(len(unique), 2)
        self.assertEqual(removed, 0)

    def test_sort_is_page_then_y_then_x(self):
        ordered = sort_in_document_order([
            self._detection("d", (0, 10, 5, 30), page=1),
            self._detection("c", (0, 200, 5, 220), page=0),
            self._detection("b", (100, 50, 105, 70), page=0),
            self._detection("a", (0, 50, 5, 70), page=0),
        ])
        self.assertEqual(
            [(i.page, i.bbox[0], i.bbox[1]) for i in ordered],
            [(0, 0, 50), (0, 100, 50), (0, 0, 200), (1, 0, 10)],
        )

    def test_iou_of_disjoint_boxes_is_zero(self):
        self.assertEqual(bi.iou((0, 0, 10, 10), (100, 100, 110, 110)), 0.0)



class GradingTests(unittest.TestCase):
    def test_no_metrics_means_no_grade(self):
        self.assertIsNone(bi.QualityGrader.grade({}))

    def test_grade_comes_from_measurements(self):
        strong = {
            "modulation": 0.95, "edgeSharpness": 500.0,
            "quietZoneLeft": 1.0, "quietZoneRight": 1.0, "coverage": 0.5,
        }
        weak = {
            "modulation": 0.2, "edgeSharpness": 5.0,
            "quietZoneLeft": 0.1, "quietZoneRight": 0.1, "coverage": 0.95,
        }
        self.assertIn(bi.QualityGrader.grade(strong), {"A", "B"})
        self.assertIn(bi.QualityGrader.grade(weak), {"D", "F"})

    def test_measured_metrics_are_labelled_as_indicative(self):
        import numpy as np

        image = np.full((200, 400), 255, np.uint8)
        for index, x in enumerate(range(120, 380)):
            if index % 3 != 0:
                image[100:200, x] = 0

        detection = Detection(
            format_id="EAN_13", value="5016695007878", page=0,
            bbox=(120, 100, 380, 200), polygon=[], decoder="test",
        )
        metrics = bi.QualityGrader.measure(image, detection)
        self.assertIn("not ISO/IEC", metrics["standard"])
        for key in ("contrast", "modulation", "edgeSharpness", "coverage"):
            self.assertIn(key, metrics)


class CancellationTests(unittest.TestCase):
    def test_token_starts_uncancelled(self):
        token = CancelToken()
        self.assertFalse(token.cancelled)
        token.raise_if_cancelled()

    def test_token_raises_when_cancelled(self):
        token = CancelToken()
        token.cancel()
        self.assertTrue(token.cancelled)
        with self.assertRaises(InspectionCancelled):
            token.raise_if_cancelled()


class LocatorTests(unittest.TestCase):
    def test_blank_page_yields_no_candidates(self):
        import numpy as np

        blank = np.full((1200, 900), 255, np.uint8)
        self.assertEqual(bi.CandidateLocator.locate(blank), [])

    def test_candidate_exposes_box(self):
        candidate = Candidate(10, 20, 100, 40, "linear")
        self.assertEqual(candidate.box, (10, 20, 110, 60))


class _PdfFixture(unittest.TestCase):
    """Builds single-file PDFs containing real generated barcodes."""

    def setUp(self):
        # Unique per test so a lingering handle on one fixture can never block
        # (or corrupt) another test's file.
        suffix = f"{id(self):x}"
        self.SYMBOL = f"_test_sym_{suffix}.png"
        self.PDF = f"_test_fixture_{suffix}.pdf"

    def _cleanup(self):
        # A background job may still hold the file briefly; retry.
        for name in (self.SYMBOL, self.PDF):
            for _attempt in range(20):
                if not os.path.exists(name):
                    break
                try:
                    os.remove(name)
                    break
                except OSError:
                    import time

                    time.sleep(0.1)

    def build(self, barcodes, text=None, pages=1):
        import cv2
        import fitz
        import numpy as np
        import zxingcpp

        doc = fitz.open()
        for _page_index in range(pages):
            page = doc.new_page(width=595, height=842)
            for fmt_name, value, x, y in barcodes:
                symbol = zxingcpp.write_barcode(
                    getattr(zxingcpp.BarcodeFormat, fmt_name), value
                )
                array = np.asarray(symbol)
                h, w = array.shape[:2]
                padded = np.full((h + 120, w + 120), 255, np.uint8)
                padded[60:60 + h, 60:60 + w] = array
                cv2.imwrite(self.SYMBOL, padded)
                page.insert_image(
                    fitz.Rect(x, y, x + padded.shape[1], y + padded.shape[0]),
                    filename=self.SYMBOL,
                )
            if text:
                page.insert_text((50, 830), text)
        doc.save(self.PDF)
        doc.close()
        self.addCleanup(self._cleanup)
        return self.PDF



class EndToEndTests(_PdfFixture):
    """Real decoding: text must not be reported, real barcodes must be."""

    TEXT = (
        "FOR GENERAL INFORMATION CALL THE NEAREST HOSPITAL IF YOUR DOCTOR "
        "IS NOT AVAILABLE WRITE YOUR DOCTORS DETAILS YOU SHOULD IMMEDIATELY "
        "CONTACT CARTON 6X10 SKLD"
    )

    def test_ordinary_text_is_not_reported_as_a_barcode(self):
        path = self.build([], text=self.TEXT)
        result = bi.run_barcode_inspection(path)
        self.assertEqual(result["barcodeCount"], 0)
        self.assertEqual(result["findings"], [])

    def test_single_real_barcode(self):
        path = self.build([("EAN13", "5016695007878", 50, 200)], text=self.TEXT)
        result = bi.run_barcode_inspection(path)

        self.assertEqual(result["barcodeCount"], 1)
        barcode = result["barcodes"][0]
        self.assertEqual(barcode["decodedValue"], "5016695007878")
        self.assertEqual(barcode["type"], "EAN-13")
        self.assertEqual(barcode["id"], 1)
        self.assertTrue(barcode["validated"])
        self.assertGreater(barcode["bbox"]["width"], 0)

    def test_acceptance_reference_scenario(self):
        """The reference scenario: real barcodes + the offending text block.

        The count must equal the number of genuine symbols (never 100+ text
        "Code 39" hits) and the ids must run 1..N in document order.
        """
        path = self.build(
            [
                ("Code128", "LAETUS-1747-1196", 50, 120),   # upper symbol
                ("EAN13", "5016695007878", 50, 420),       # lower symbol
            ],
            text=self.TEXT,
        )
        result = bi.run_barcode_inspection(path)
        barcodes = result["barcodes"]

        self.assertEqual(result["barcodeCount"], len(barcodes))
        self.assertEqual([b["id"] for b in barcodes], list(range(1, len(barcodes) + 1)))
        self.assertEqual(len(barcodes), 2)
        self.assertEqual(barcodes[0]["decodedValue"], "LAETUS-1747-1196")
        self.assertEqual(barcodes[1]["decodedValue"], "5016695007878")
        # No sentence fragments leaked in as Code 39 payloads.
        for barcode in barcodes:
            self.assertNotIn(" ", barcode["decodedValue"])
            self.assertTrue(barcode["validated"])

    def test_ids_are_sequential_in_document_order(self):
        """The LOWER barcode is placed first but must still get id 1."""
        path = self.build([
            ("EAN13", "5016695007878", 50, 500),       # added first, lower
            ("Code128", "LAETUS-1747-1196", 50, 100),  # added second, upper
        ])
        barcodes = bi.run_barcode_inspection(path)["barcodes"]

        self.assertEqual(len(barcodes), 2)
        self.assertEqual([b["id"] for b in barcodes], [1, 2])
        # Reading order: the upper symbol is id 1.
        self.assertEqual(barcodes[0]["decodedValue"], "LAETUS-1747-1196")
        self.assertEqual(barcodes[1]["decodedValue"], "5016695007878")
        self.assertLess(barcodes[0]["bbox"]["y"], barcodes[1]["bbox"]["y"])

    def test_result_shape_matches_frontend_contract(self):
        path = self.build([("EAN13", "5016695007878", 50, 200)])
        barcode = bi.run_barcode_inspection(path)["barcodes"][0]

        for key in (
            "id", "page", "type", "decodedValue", "grade", "bbox",
            "polygon", "level", "comment", "validated",
        ):
            self.assertIn(key, barcode)
        for key in ("x", "y", "width", "height"):
            self.assertIn(key, barcode["bbox"])

    def test_page_selection_limits_inspection(self):
        path = self.build(
            [("EAN13", "5016695007878", 50, 200)], text=self.TEXT, pages=3
        )
        result = BarcodeInspectionEngine(path, {"pages": [2]}).run()
        self.assertEqual(result["inspectedPages"], [1])
        self.assertEqual(result["pageCount"], 3)

    def test_progress_reports_stages(self):
        path = self.build([("EAN13", "5016695007878", 50, 200)])
        seen = []
        BarcodeInspectionEngine(path).run(
            progress=lambda stage, _extra: seen.append(stage)
        )
        self.assertIn("rendering", seen)
        self.assertIn("barcode_detection", seen)
        self.assertIn("barcode_validation", seen)
        self.assertEqual(seen[-1], "inspection_complete")

    def test_cancellation_stops_the_run(self):
        path = self.build([("EAN13", "5016695007878", 50, 200)])

        def progress(stage, _extra):
            return stage != "barcode_detection"

        with self.assertRaises(InspectionCancelled):
            BarcodeInspectionEngine(path).run(progress=progress)

    def test_stats_report_the_pipeline_books(self):
        path = self.build([("EAN13", "5016695007878", 50, 200)], text=self.TEXT)
        stats = bi.run_barcode_inspection(path)["stats"]
        for key in ("candidates", "validated", "duplicatesRemoved", "rejected"):
            self.assertIn(key, stats)
        self.assertEqual(stats["validated"], 1)


class JobStoreTests(_PdfFixture):
    def test_job_runs_asynchronously_and_completes(self):
        import time

        path = self.build([("EAN13", "5016695007878", 50, 200)])
        job = bi.create_job(path)
        self.addCleanup(lambda: bi.JOBS._jobs.pop(job.id, None))

        # The engine runs on a background thread, so the job may already have
        # moved past "queued" by the time we look.
        self.assertIn(job.status, ("queued", "processing"))
        for _attempt in range(120):
            if job.status in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.25)

        self.assertEqual(job.status, "completed")
        self.assertEqual(job.barcode_count, 1)
        payload = job.to_dict()
        self.assertEqual(payload["inspectionId"], job.id)
        self.assertEqual(len(payload["results"]), 1)
        self.assertEqual(bi.get_job(job.id), job)

    def test_cancel_is_reported_for_unknown_job(self):
        self.assertIsNone(bi.cancel_job("does-not-exist"))


if __name__ == "__main__":
    # When executed directly, run everything and print a compact summary.
    import io
    import time
    import unittest

    started = time.perf_counter()
    suite = unittest.TestLoader().loadTestsFromModule(sys.modules[__name__])
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)

    with open("_test_summary.txt", "w", encoding="utf-8") as handle:
        handle.write(
            f"ran={result.testsRun} errors={len(result.errors)} "
            f"failures={len(result.failures)} "
            f"seconds={time.perf_counter() - started:.1f}\n"
        )
        for test, trace in result.errors + result.failures:
            handle.write(f"\n--- {test}\n{trace[-700:]}\n")

