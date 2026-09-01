import axios from "axios";
import { generateInspectionSessionId } from "@/shared/utils/inspectionSessionId";
import {
  INSPECTION_ERROR_PREFIX,
  getInspectionLabel,
} from "@/shared/config/inspectionConfig";
import type { InspectionType } from "@/store/uploadStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Upload / inspection lifecycle state — generic across ALL inspection
 * types (text, graphics, spelling, braille, barcode, notes, …).
 */
export type InspectionApiStatus =
  | "idle"
  | "uploading"
  | "inspecting"
  | "completed"
  | "failed";

export type InspectionUploadProgress = {
  status: string;
  progress?: number;
};

export type InspectionApiOptions = {
  onStatus?: (status: InspectionUploadProgress) => void;
  sessionId?: string;
  /** Inspection type used to build the dynamic session ID prefix (TXT/GRP/…). */
  inspectionType?: InspectionType;
  /** Difference Filter payload forwarded to the backend `/api/inspect` call. */
  differenceFilters?: Record<string, boolean>;
};

/* -------------------------------------------------------------------------- */
/*                        Backend Report Types                                */
/* -------------------------------------------------------------------------- */

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Finding = {
  id: number;
  type: string;
  master: string;
  sample: string;
  comment: string;
  page: number;
  master_box: BoundingBox | null;
  sample_box: BoundingBox | null;
  source: string;
};

export type ReportPage = {
  page: number;
  master_image?: string;
  master_width?: number;
  master_height?: number;
  sample_image?: string;
  sample_width?: number;
  sample_height?: number;
};

export type InspectionReport = {
  dpi: number;
  pages: ReportPage[];
  findings: Finding[];
  suppressed_shifts: { shift: string; count: number }[];
};

/**
 * Result returned by `startInspection` — generic, not tied to Text.
 */
export type InspectionRunResult = {
  sessionId: string;
  report: InspectionReport;
};

/**
 * Generates the dynamic inspection session ID (e.g. "TXT-20260826153045").
 * The prefix is derived from the inspection type, so it works for every
 * inspection — never hardcoded to Text only.
 */
const generateSessionId = (inspectionType?: string) =>
  generateInspectionSessionId(inspectionType ?? "text");


export type ShareInspectionReportParams = {
  recipientEmail: string;
  sessionId: string;
  masterFileName: string;
  sampleFileName: string;
  reportPdf: Blob;
};

export type ShareInspectionReportResult = {
  success: boolean;
  message?: string;
};

/**
 * Shares the inspection report PDF by sending it to the backend,
 * which emails it to the recipient as an attachment.
 */
export async function shareInspectionReport({
  recipientEmail,
  sessionId,
  masterFileName,
  sampleFileName,
  reportPdf,
}: ShareInspectionReportParams): Promise<ShareInspectionReportResult> {
  console.log("[SHARE REPORT] Sending email request");

  const formData = new FormData();
  formData.append("recipientEmail", recipientEmail);
  formData.append("sessionId", sessionId);
  formData.append("masterFileName", masterFileName);
  formData.append("sampleFileName", sampleFileName);
  formData.append(
    "reportPdf",
    reportPdf,
    `inspection-report-${sessionId}.pdf`
  );

  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/inspection/share`,
      formData
      // NOTE: Do NOT set Content-Type manually — Axios/browser
      // handles the multipart boundary automatically.
    );

    console.log("[SHARE REPORT] Email sent successfully");
    return {
      success: true,
      message: response.data?.message ?? "Inspection report shared successfully.",
    };
  } catch (error: unknown) {
    const axiosError = error as {
      response?: { data?: { error?: string } };
    };
    const message =
      axiosError?.response?.data?.error ??
      "Failed to share the inspection report. Please try again.";

    console.error("[SHARE REPORT] Email request failed:", error);
    throw new Error(message, { cause: error });
  }
}

/**
 * Uploads a single file (master or sample) to the backend.
 * Reused by `startInspection` below — the upload endpoint is already
 * inspection-agnostic; it only needs the session_id and side.
 */
const uploadFile = async (
  file: File,
  sessionId: string,
  side: "master" | "sample",
) => {
  const formData = new FormData();
  formData.append("session_id", sessionId);
  formData.append("side", side);
  formData.append("file", file);

    await axios.post(`${API_BASE_URL}/api/upload`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

/**
 * Runs a generic inspection (text, graphics, spelling, braille, barcode,
 * notes, or any future type registered on the backend).
 *
 * The function is fully dynamic:
 *   • The session ID prefix is derived from `inspectionType`.
 *   • The `/api/inspect` payload includes `inspection_type` so the
 *     backend dispatches to the correct pipeline.
 *   • Status messages and error text adapt to the inspection type.
 *
 * To support a new inspection type, just add it to `InspectionType`
 * in `uploadStore.ts` and register a pipeline on the backend — no
 * changes needed here.
 */
export async function startInspection(
  masterFile: File,
  sampleFile: File,
  options: InspectionApiOptions = {}
): Promise<InspectionRunResult> {
  const inspectionType = options.inspectionType ?? "text";
  const label = getInspectionLabel(inspectionType);
  const errorPrefix = INSPECTION_ERROR_PREFIX[inspectionType as InspectionType] ??
    `${label} failed`;

  const sessionId =
    options.sessionId ?? generateSessionId(inspectionType);

  const setStatus = (status: string, progress?: number) => {
    options.onStatus?.({ status, progress });
  };

  setStatus(`Uploading files...`, 10);

  try {
    await uploadFile(masterFile, sessionId, "master");
    setStatus(`Loading ${label} — Master...`, 40);

    await uploadFile(sampleFile, sessionId, "sample");
    setStatus(`Loading ${label} — Sample...`, 65);

    setStatus(`Comparing ${label.toLowerCase()}...`, 80);

    const response = await axios.post(`${API_BASE_URL}/api/inspect`, {
      session_id: sessionId,
      inspection_type: inspectionType,
      ...(options.differenceFilters
        ? { filters: options.differenceFilters }
        : {}),
    });

    setStatus("Preparing results...", 100);

    return {
      sessionId,
      report: response.data as InspectionReport,
    };
  } catch (error: unknown) {
    const axiosError = error as {
      response?: { data?: { error?: string } };
    };
    const backendMessage =
      axiosError?.response?.data?.error ?? "Unknown error from the server.";

    const message = `${errorPrefix}. ${backendMessage}`;

    console.error(`[${label}] API error:`, error);
    throw new Error(message, { cause: error });
  }
}

/* -------------------------------------------------------------------------- */
/* Backward-compatibility re-exports                                          */
/* -------------------------------------------------------------------------- */
/*
 * Old code that hasn't been migrated yet can still import the old names.
 * Remove these aliases once all consumers have been updated.
 */
export type TextInspectionResult = InspectionRunResult;
export type TextInspectionApiOptions = InspectionApiOptions;
export type TextInspectionUploadProgress = InspectionUploadProgress;
export type TextInspectionStatus = InspectionApiStatus;
export const startTextInspection = startInspection;