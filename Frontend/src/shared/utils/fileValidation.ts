import {
  INSPECTION_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
  MAX_UPLOAD_SIZE_LABEL,
  getFileTypeLabels,
  getFileTypesForInspection,
} from "@/shared/config/inspectionConfig";

export const MAX_FILE_SIZE = MAX_UPLOAD_SIZE_BYTES; // 10 GB

/**
 * File extensions allowed for each inspection type.
 * Imported from the centralized config — adding a new inspection
 * type only requires an entry in `inspectionConfig.ts`.
 *
 * `getFileTypesForInspection` is re-exported here for convenience so
 * callers (e.g. UploadCard) import both the validation helpers and the
 * per-inspection file types from a single module.
 */
export {
  INSPECTION_FILE_TYPES,
  INSPECTION_MIME_TYPES,
  getFileTypesForInspection,
  getFileTypeLabels,
  getSupportedFileTypesLabel,
  MAX_UPLOAD_SIZE_BYTES,
  MAX_UPLOAD_SIZE_LABEL,
  TEXT_INSPECTION_FILE_TYPES,
} from "@/shared/config/inspectionConfig";

export interface ValidationResult {
  isValid: boolean;
  error: string;
}

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");

  if (index === -1) {
    return "";
  }

  return fileName.substring(index).toLowerCase();
}

export function validateFileType(
  file: File,
  allowedExtensions: string[]
): ValidationResult {
  const extension = getFileExtension(file.name);

  if (!allowedExtensions.includes(extension)) {
    return {
      isValid: false,
      error: `Unsupported file type (${extension}).`
    };
  }

  return {
    isValid: true,
    error: ""
  };
}

export function validateFileSize(file: File): ValidationResult {
  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: "File size exceeds the maximum limit of 10 GB."
    };
  }

  return {
    isValid: true,
    error: ""
  };
}

export function validateFile(
  file: File,
  allowedExtensions: string[]
): ValidationResult {
  const typeValidation = validateFileType(
    file,
    allowedExtensions
  );

  if (!typeValidation.isValid) {
    return typeValidation;
  }

  const sizeValidation = validateFileSize(file);

  if (!sizeValidation.isValid) {
    return sizeValidation;
  }

  return {
    isValid: true,
    error: ""
  };
}

/* -------------------------------------------------------------------------- */
/*              Rich validation (dedicated upload screens)                     */
/* -------------------------------------------------------------------------- */

/**
 * Builds the "Unsupported file type" message from the actual configuration,
 * e.g. "Unsupported file type. Please upload a PDF or AI file."
 */
export function buildUnsupportedTypeMessage(
  inspectionType: string
): string {
  const labels = getFileTypeLabels(inspectionType);
  const list =
    labels.length <= 1
      ? labels[0] ?? ""
      : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;

  return `Unsupported file type. Please upload a ${list} file.`;
}

/** Builds the size message from the configured maximum. */
export function buildFileSizeMessage(): string {
  return `File size exceeds the maximum allowed size of ${MAX_UPLOAD_SIZE_LABEL}.`;
}

/** Rejects zero-byte files. */
export function validateFileNotEmpty(file: File): ValidationResult {
  if (file.size === 0) {
    return {
      isValid: false,
      error: "The selected file is empty. Please choose a valid file."
    };
  }

  return { isValid: true, error: "" };
}

/**
 * MIME check for a file whose extension is already allowed. When the
 * extension has no MIME entry, or the browser reports an empty/generic type,
 * the check passes so legitimate files are never blocked.
 */
export function validateFileMimeType(
  file: File,
  allowedExtensions: string[]
): ValidationResult {
  const extension = getFileExtension(file.name);

  if (!allowedExtensions.includes(extension)) {
    // Extension failure is reported separately by validateFileType.
    return { isValid: true, error: "" };
  }

  const allowedMimes = INSPECTION_MIME_TYPES[extension];

  if (!allowedMimes || !file.type) {
    return { isValid: true, error: "" };
  }

  if (!allowedMimes.includes(file.type.toLowerCase())) {
    return {
      isValid: false,
      error: `Unsupported file content type (${file.type}).`
    };
  }

  return { isValid: true, error: "" };
}

/**
 * Full validation used by the dedicated Barcode upload screen.
 * Checks, in order: non-empty -> extension -> MIME -> size.
 *
 * Unlike `validateFile`, messages are user-facing and generated from the
 * Barcode Inspection configuration rather than hard-coded per screen.
 */
export function validateInspectionFile(
  file: File,
  inspectionType: string
): ValidationResult {
  const emptyCheck = validateFileNotEmpty(file);

  if (!emptyCheck.isValid) {
    return emptyCheck;
  }

  const allowedExtensions = getFileTypesForInspection(inspectionType);

  const typeCheck = validateFileType(file, allowedExtensions);

  if (!typeCheck.isValid) {
    return {
      isValid: false,
      error: buildUnsupportedTypeMessage(inspectionType)
    };
  }

  const mimeCheck = validateFileMimeType(file, allowedExtensions);

  if (!mimeCheck.isValid) {
    return mimeCheck;
  }

  const sizeCheck = validateFileSize(file);

  if (!sizeCheck.isValid) {
    return {
      isValid: false,
      error: buildFileSizeMessage()
    };
  }

  return { isValid: true, error: "" };
}

/**
 * Formats a byte count for display, e.g. 1536 -> "1.5 KB".
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);

  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}