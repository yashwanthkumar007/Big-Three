import type { InspectionType } from "@/store/uploadStore";

/**
 * Session ID prefix for every inspection type.
 *
 * Adding a new inspection type only requires a new entry here —
 * the ID generation itself stays fully dynamic.
 */
export const INSPECTION_SESSION_PREFIXES: Record<InspectionType, string> = {
  text: "TXT",
  graphics: "GRP",
  spelling: "SPL",
  braille: "BRL",
  barcode: "BAR",
  notes: "NTS",
};

/** Zero-pads a number to two digits (e.g. 5 -> "05"). */
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Formats the given date/time as YYYYMMDDHHMMSS in local time,
 * e.g. 2026-08-26 15:30:45 -> "20260826153045".
 */
export function formatTimestampId(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

/**
 * Generates a dynamic, human-readable inspection session ID of the form
 * `<PREFIX>-<YYYYMMDDHHMMSS>`, e.g. "TXT-20260826153045".
 *
 * Works for ANY inspection type — never hardcoded to one inspection.
 */
export function generateInspectionSessionId(
  inspectionType: InspectionType | string
): string {
  const prefix =
    INSPECTION_SESSION_PREFIXES[inspectionType as InspectionType] ??
    String(inspectionType).slice(0, 3).toUpperCase();

  return `${prefix}-${formatTimestampId()}`;
}
