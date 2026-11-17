import os
import sys
import tempfile
import unittest
import zipfile

import fitz

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.pipelines.comparison_pipeline import run_text_inspection


def write_docx(path, paragraphs, numbered_paragraphs=()):
    paragraph_xml = "".join(
        (
            '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/>'
            '<w:numId w:val="1"/></w:numPr></w:pPr>'
            if paragraph_number in numbered_paragraphs
            else "<w:p>"
        )
        + f"<w:r><w:t>{text}</w:t></w:r></w:p>"
        for paragraph_number, text in enumerate(paragraphs)
    )
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/'
        'wordprocessingml/2006/main"><w:body>'
        f"{paragraph_xml}"
        "</w:body></w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document_xml)
        if numbered_paragraphs:
            archive.writestr(
                "word/numbering.xml",
                '<w:numbering xmlns:w="http://schemas.openxmlformats.org/'
                'wordprocessingml/2006/main">'
                '<w:abstractNum w:abstractNumId="0">'
                '<w:lvl w:ilvl="0"><w:start w:val="1"/>'
                '<w:numFmt w:val="decimal"/>'
                '<w:lvlText w:val="%1."/></w:lvl>'
                '</w:abstractNum><w:num w:numId="1">'
                '<w:abstractNumId w:val="0"/>'
                '</w:num></w:numbering>',
            )


def write_pdf(path, pages, footer_label=None):
    document = fitz.open()
    for page_text in pages:
        page = document.new_page(width=400, height=1000)
        y = 40
        for text in page_text:
            page.insert_text((20, y), text, fontsize=11)
            y += 24
        if footer_label:
            page.insert_text((20, 720), footer_label, fontsize=14)
        page.insert_text((20, 900), "Approval date 1234", fontsize=8)
    document.save(path)
    document.close()


class DocxPdfTextComparisonTests(unittest.TestCase):
    def test_compares_body_text_across_pages_and_ignores_production_panel(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            master_path = os.path.join(temp_dir, "master.docx")
            sample_path = os.path.join(temp_dir, "sample.pdf")
            write_docx(
                master_path,
                ["Retired", "Medicine is safe.", "Expected section."],
            )
            write_pdf(
                sample_path,
                [["Medicine is safer."], ["Expected section.", "Additional"]],
            )

            result = run_text_inspection(master_path, sample_path)
            reverse_result = run_text_inspection(sample_path, master_path)

        self.assertEqual(
            [finding["type"] for finding in result["findings"]],
            ["Deletion", "Change", "Insertion"],
        )
        self.assertEqual(result["findings"][0]["master"], "Retired")
        self.assertEqual(result["findings"][1]["master"], "safe")
        self.assertEqual(result["findings"][1]["sample"], "safer")
        self.assertEqual(result["findings"][2]["sample"], "Additional")
        self.assertNotIn(
            "Approval",
            " ".join(
                f"{finding['master']} {finding['sample']}"
                for finding in result["findings"]
            ),
        )
        self.assertEqual(result["match_stats"]["matched_pairs"], 4)
        self.assertEqual(
            [finding["type"] for finding in reverse_result["findings"]],
            ["Insertion", "Change", "Deletion"],
        )
        self.assertEqual(reverse_result["findings"][0]["sample"], "Retired")
        self.assertEqual(reverse_result["findings"][1]["master"], "safer")
        self.assertEqual(reverse_result["findings"][1]["sample"], "safe")
        self.assertEqual(reverse_result["findings"][2]["master"], "Additional")

    def test_keeps_findings_for_frontend_filters(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            master_path = os.path.join(temp_dir, "master.docx")
            sample_path = os.path.join(temp_dir, "sample.pdf")
            write_docx(master_path, ["Master text."])
            write_pdf(sample_path, [["Master text.", "Added text."]])

            result = run_text_inspection(
                master_path,
                sample_path,
                filters={"insertion": False},
            )

        self.assertEqual(len(result["findings"]), 1)
        self.assertEqual(result["findings"][0]["type"], "Insertion")
        self.assertEqual(result["findings"][0]["sample"], "Added text")
        self.assertEqual(result["match_stats"]["unmatched_sample"], 2)

    def test_excludes_page_footer_and_unstructured_production_text(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            master_path = os.path.join(temp_dir, "master.docx")
            sample_path = os.path.join(temp_dir, "sample.pdf")
            write_docx(master_path, ["Master text."])
            write_pdf(
                sample_path,
                [["Master text."]],
                footer_label="Page 1 of 2",
            )

            result = run_text_inspection(
                master_path,
                sample_path,
                filters={"insertion": False},
            )

        self.assertFalse(
            any("Page 1 of 2" in finding["sample"] for finding in result["findings"])
        )
        self.assertFalse(
            any("Approval" in finding["sample"] for finding in result["findings"])
        )

    def test_matches_automatic_docx_numbering(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            master_path = os.path.join(temp_dir, "master.docx")
            sample_path = os.path.join(temp_dir, "sample.pdf")
            write_docx(
                master_path,
                ["First contents entry", "Second contents entry"],
                numbered_paragraphs={0, 1},
            )
            write_pdf(
                sample_path,
                [["1. First contents entry", "2. Second contents entry"]],
            )

            result = run_text_inspection(master_path, sample_path)

        self.assertEqual(result["findings"], [])

    def test_supplied_pair_returns_the_five_expected_findings(self):
        backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        master_path = os.path.join(
            backend_dir,
            "ie-pl-h-4377-CEP update_del McDermott-clean.docx",
        )
        sample_path = os.path.join(
            backend_dir,
            "4036385_Entecavir Viatris_0.5 mg_1 mg_30_PIL_P1.pdf",
        )

        result = run_text_inspection(
            master_path,
            sample_path,
            filters={"insertion": False, "deletion": False},
        )

        self.assertEqual(len(result["findings"]), 5)
        deletion = [
            finding for finding in result["findings"]
            if finding["type"] == "Deletion"
        ]
        insertions = [
            finding for finding in result["findings"]
            if finding["type"] == "Insertion"
        ]
        self.assertEqual(len(deletion), 1)
        self.assertEqual(deletion[0]["master"], "B PACKAGE LEAFLET")
        self.assertEqual(len(insertions), 4)
        self.assertEqual(insertions[0]["sample"], "entecavir")
        self.assertEqual(
            insertions[1]["sample"],
            "Viatris 4036385 75111617",
        )
        self.assertGreater(len(insertions[2]["sample"].splitlines()), 20)
        self.assertGreater(len(insertions[3]["sample"].splitlines()), 20)
        self.assertIn("Date / Remarks", insertions[2]["sample"])
        self.assertIn("Printed Literature", insertions[2]["sample"])
        self.assertIn("Reference SOP-000459814", insertions[2]["sample"])
        self.assertIn("Date / Remarks", insertions[3]["sample"])
        self.assertNotEqual(insertions[2]["sample"], "Production artwork table")
        self.assertNotEqual(insertions[3]["sample"], "Production artwork table")
        self.assertTrue(
            all(
                finding["comment"]
                == "Additional production artwork table in sample"
                for finding in insertions[2:]
            )
        )
        self.assertEqual(
            [finding["page"] for finding in insertions],
            [0, 1, 0, 1],
        )
        self.assertEqual(
            [finding["type"] for finding in result["findings"]],
            ["Deletion", "Insertion", "Insertion", "Insertion", "Insertion"],
        )
        self.assertAlmostEqual(insertions[0]["sample_bbox"][1], 237.0, delta=2)
        self.assertGreater(insertions[1]["sample_bbox"][0], 470)
        self.assertLess(insertions[1]["sample_bbox"][2], 530)
        self.assertGreater(insertions[1]["sample_bbox"][1], 1140)
        for table_finding in insertions[2:]:
            self.assertLess(table_finding["sample_bbox"][0], 40)
            self.assertGreater(table_finding["sample_bbox"][2], 550)
            self.assertGreater(table_finding["sample_bbox"][1], 1270)
            self.assertLess(table_finding["sample_bbox"][3], 1640)
        self.assertFalse(
            any(
                finding["sample"].startswith("Page ")
                for finding in result["findings"]
            )
        )


if __name__ == "__main__":
    unittest.main()
