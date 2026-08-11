export const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB

export const TEXT_INSPECTION_FILE_TYPES = [
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".rtf",
  ".xml",
  ".xls",
  ".xlsx",
  ".ai"
];

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