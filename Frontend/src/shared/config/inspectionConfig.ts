import type { InspectionType } from "@/store/uploadStore";

/**
 * InspectionConfig — the single source of truth for everything that
 * varies per inspection type on the frontend.
 *
 * Adding a NEW inspection type only requires:
 *   1. Add the type to `InspectionType` in `uploadStore.ts`
 *   2. Add an entry below for the label, file-types, and error prefix
 *   3. Add a session-prefix entry in `inspectionSessionId.ts`
 *   4. Register a pipeline on the backend (`src/inspection_registry.py`)
 *
 * No other file needs to change.
 */

/** Human-readable label shown in the sidebar, loading screen, etc. */
export const INSPECTION_LABELS: Record<InspectionType, string> = {
  text: "Text Inspection",
  graphics: "Graphics Inspection",
  spelling: "Spelling Inspection",
  braille: "Braille Inspection",
  barcode: "Barcode Inspection",
  notes: "Notes Inspection",
};

/**
 * File extensions allowed for each inspection type.
 * Used by UploadCard / fileValidation to validate uploads.
 */
export const INSPECTION_FILE_TYPES: Record<InspectionType, string[]> = {
  text: [
    ".pdf", ".doc", ".docx", ".txt", ".rtf",
    ".xml", ".xls", ".xlsx", ".ai",
  ],
  graphics: [
    ".pdf", ".ai", ".eps", ".svg",
    ".png", ".jpg", ".jpeg", ".tiff", ".tif",
  ],
  spelling: [
    ".pdf", ".doc", ".docx", ".txt",
  ],
  braille: [
    ".pdf", ".brf", ".txt",
  ],
  barcode: [
    ".pdf", ".png", ".jpg", ".jpeg",
    ".gif", ".bmp", ".tiff", ".tif",
  ],
  notes: [
    ".pdf", ".doc", ".docx", ".txt",
  ],
};

/**
 * Error message prefix shown to the user when an inspection fails.
 * Combined with the backend error text.
 */
export const INSPECTION_ERROR_PREFIX: Record<InspectionType, string> = {
  text: "Text inspection failed",
  graphics: "Graphics inspection failed",
  spelling: "Spelling inspection failed",
  braille: "Braille inspection failed",
  barcode: "Barcode inspection failed",
  notes: "Notes inspection failed",
};

/**
 * Generic, human-readable label for an inspection type.
 * Falls back to a capitalised type name if the type is unknown.
 */
export function getInspectionLabel(
  inspectionType: InspectionType | string | null | undefined,
): string {
  if (!inspectionType) {
    return "Inspection";
  }
  return (
    INSPECTION_LABELS[inspectionType as InspectionType] ??
    `${inspectionType.charAt(0).toUpperCase()}${inspectionType.slice(1)} Inspection`
  );
}

/**
 * File types allowed for a given inspection type, falling back to
 * the text inspection types when the type is unknown.
 */
export function getFileTypesForInspection(
  inspectionType: InspectionType | string | null | undefined,
): string[] {
  if (!inspectionType) {
    return INSPECTION_FILE_TYPES.text;
  }
  return INSPECTION_FILE_TYPES[inspectionType as InspectionType] ??
    INSPECTION_FILE_TYPES.text;
}

/**
 * Backward-compatible alias for code that only knows about text inspection.
 */
export const TEXT_INSPECTION_FILE_TYPES = INSPECTION_FILE_TYPES.text;
