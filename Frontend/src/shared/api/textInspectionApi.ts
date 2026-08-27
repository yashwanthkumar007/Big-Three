import axios from "axios";
import { generateInspectionSessionId } from "@/shared/utils/inspectionSessionId";
import type { InspectionType } from "@/store/uploadStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type TextInspectionStatus =
  | "idle"
  | "uploading"
  | "inspecting"
  | "completed"
  | "failed";

export type TextInspectionUploadProgress = {
  status: string;
  progress?: number;
};

export type TextInspectionApiOptions = {
  onStatus?: (status: TextInspectionUploadProgress) => void;
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

export type TextInspectionResult = {
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

export async function startTextInspection(
  masterFile: File,
  sampleFile: File,
  options: TextInspectionApiOptions = {}
): Promise<TextInspectionResult> {
  const sessionId =
    options.sessionId ?? generateSessionId(options.inspectionType);

  const setStatus = (status: string, progress?: number) => {
    options.onStatus?.({ status, progress });
  };

  setStatus("Uploading files...", 10);

  const uploadFile = async (file: File, side: "master" | "sample") => {
    const formData = new FormData();
    formData.append("session_id", sessionId);
    formData.append("side", side);
    formData.append("file", file);

    await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  };

  try {
    await uploadFile(masterFile, "master");
    setStatus("Loading Master...", 40);

    await uploadFile(sampleFile, "sample");
    setStatus("Loading Sample...", 65);

    setStatus("Comparing text...", 80);

    const response = await axios.post(`${API_BASE_URL}/api/inspect`, {
      session_id: sessionId,
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
    const message =
      axiosError?.response?.data?.error ??
      "Text inspection failed. Please try again.";

    console.error("Text inspection API error:", error);
    throw new Error(message, { cause: error });
  }
}