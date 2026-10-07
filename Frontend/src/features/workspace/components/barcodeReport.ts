import jsPDF from "jspdf";

import type { BarcodeFinding } from "./BarcodeInspectionResults";
import { logAuditEvent } from "@/features/admin/systemApi";

/* Brand colours reused from the existing report generator. */
const BRAND_PRIMARY: [number, number, number] = [42, 39, 110]; // #2A276E
const TEXT_COLOR: [number, number, number] = [62, 66, 74];
const LIGHT_BG: [number, number, number] = [243, 245, 247];
const WHITE: [number, number, number] = [255, 255, 255];

const PAGE_WIDTH = 210;
const MARGIN = 14;

type DownloadBarcodeReportParams = {
  inspectionId: string;
  /** The single uploaded inspection file. */
  fileName: string;
  barcodes: BarcodeFinding[];
  commentSelections: Record<number, string>;
  levelSelections: Record<number, string>;
};

/**
 * Generates the Barcode Inspection PDF report.
 *
 * Reuses the application's existing jsPDF setup and brand colours, and reports
 * exactly what the result table shows: filename, barcode count and one row per
 * barcode (ID, type, decoded value, grade, level, comment, page).
 */
export function downloadBarcodeReport({
  inspectionId,
  fileName,
  barcodes,
  commentSelections,
  levelSelections,
}: DownloadBarcodeReportParams): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  /* Title band */
  doc.setFillColor(...BRAND_PRIMARY);
  doc.rect(0, 0, PAGE_WIDTH, 34, "F");

  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Barcode Inspection Report", MARGIN, 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Inspection ID: ${inspectionId}`, MARGIN, 23);
  doc.text(
    `Generated: ${new Date().toLocaleString()}`,
    MARGIN,
    29,
  );

  /* Inspection summary */
  let y = 44;

  doc.setTextColor(...BRAND_PRIMARY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Inspection", MARGIN, y);

  y += 7;
  doc.setFillColor(...LIGHT_BG);
  doc.roundedRect(MARGIN, y - 5, PAGE_WIDTH - MARGIN * 2, 22, 2, 2, "F");

  doc.setTextColor(...TEXT_COLOR);
  doc.setFontSize(9);
  doc.text(`Filename: ${fileName}`, MARGIN + 4, y + 1);
  doc.text(
    `Barcodes: ${barcodes.length}`,
    MARGIN + 4,
    y + 7,
  );
  doc.text(`Inspection ID: ${inspectionId}`, MARGIN + 4, y + 13);

  /* Barcode results table */
  y += 26;
  doc.setTextColor(...BRAND_PRIMARY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Barcode Results", MARGIN, y);

  const columns = ["ID", "Type", "Decoded Value", "Grade", "Level", "Comment", "Page"];
  const columnWidths = [10, 26, 52, 12, 18, 40, 12];
  const rowHeight = 7;

  const drawHeader = (startY: number) => {
    doc.setFillColor(...BRAND_PRIMARY);
    doc.rect(MARGIN, startY, PAGE_WIDTH - MARGIN * 2, rowHeight, "F");

    doc.setTextColor(...WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);

    let x = MARGIN + 2;
    columns.forEach((column, index) => {
      doc.text(column, x, startY + rowHeight / 2 + 1);
      x += columnWidths[index];
    });
    return startY + rowHeight;
  };

  y += 6;
  y = drawHeader(y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  if (barcodes.length === 0) {
    doc.setTextColor(...TEXT_COLOR);
    doc.text("No barcodes were detected in this document.", MARGIN + 2, y + 4);
    y += 10;
  }

  barcodes.forEach((barcode, index) => {
    if (y + rowHeight > 285) {
      doc.addPage();
      y = 20;
      y = drawHeader(y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
    }

    if (index % 2 === 1) {
      doc.setFillColor(...LIGHT_BG);
      doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, rowHeight, "F");
    }

    const level = levelSelections[barcode.id] ?? "";
    const comment = commentSelections[barcode.id] ?? "";

    const values = [
      String(barcode.id),
      barcode.type || "-",
      barcode.decodedValue || "-",
      barcode.grade || "-",
      level || "None",
      comment || "None",
      String(barcode.page + 1),
    ];

    doc.setTextColor(...TEXT_COLOR);
    let x = MARGIN + 2;
    values.forEach((value, valueIndex) => {
      // The decoded value can be long — truncate to keep the row on one line.
      const maxChars = Math.floor(columnWidths[valueIndex] / 1.7);
      const text =
        value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
      doc.text(text, x, y + rowHeight / 2 + 1);
      x += columnWidths[valueIndex];
    });

    y += rowHeight;
  });

  /* Save */
  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  doc.save(`barcode-inspection-report-${safeName}.pdf`);

  void logAuditEvent({
    event: "BARCODE_REPORT_GENERATED",
    action: "Download Barcode Report",
    module: "Barcode Inspection",
    description: `Barcode report generated. Inspection ID=${inspectionId}`,
    inspectionId,
    metadata: { barcodeCount: barcodes.length, fileName },
  });
}
