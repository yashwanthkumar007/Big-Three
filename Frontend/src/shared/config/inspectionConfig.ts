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
    ".pdf", ".ai",
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
 * Human-readable file types for each inspection type, derived from
 * `INSPECTION_FILE_TYPES` (never hard-coded at the call site).
 *
 * Example: `["PDF", "AI"]` — used for the "Supported file types" line and
 * for building validation messages.
 */
export function getFileTypeLabels(
  inspectionType: InspectionType | string | null | undefined,
): string[] {
  return getFileTypesForInspection(inspectionType).map((extension) =>
    extension.replace(/^\./, "").toUpperCase()
  );
}

/**
 * Comma-separated supported-type list, e.g. "PDF, AI".
 */
export function getSupportedFileTypesLabel(
  inspectionType: InspectionType | string | null | undefined,
): string {
  return getFileTypeLabels(inspectionType).join(", ");
}

/**
 * Accepted MIME types per extension. Used for MIME-level validation in
 * addition to the extension check. Browsers frequently report an empty or
 * generic MIME type for Illustrator files, so the empty string is allowed.
 */
export const INSPECTION_MIME_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".ai": ["application/postscript", "application/illustrator", "application/octet-stream", ""],
  ".doc": ["application/msword", "application/octet-stream", ""],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream", ""],
  ".txt": ["text/plain", "text/csv", "application/octet-stream", ""],
  ".rtf": ["application/rtf", "text/rtf", "text/plain", "application/octet-stream", ""],
  ".xml": ["text/xml", "application/xml", "text/plain", "application/octet-stream", ""],
  ".xls": ["application/vnd.ms-excel", "application/octet-stream", ""],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream", ""],
  ".svg": ["image/svg+xml", "text/xml", "text/plain", "application/octet-stream", ""],
  ".eps": ["application/postscript", "application/octet-stream", ""],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".tiff": ["image/tiff"],
  ".tif": ["image/tiff"],
  ".gif": ["image/gif"],
  ".bmp": ["image/bmp", "image/x-ms-bmp"],
  ".brf": ["text/plain", "application/octet-stream", ""],
};

/** Maximum upload size in bytes (10 GB). */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

/** Human-readable maximum size used in the UI and validation messages. */
export const MAX_UPLOAD_SIZE_LABEL = "10GB";

/**
 * Backward-compatible alias for code that only knows about text inspection.
 */
export const TEXT_INSPECTION_FILE_TYPES = INSPECTION_FILE_TYPES.text;
