import axios from "axios";

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

const generateSessionId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `text-inspection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export async function startTextInspection(
  masterFile: File,
  sampleFile: File,
  options: TextInspectionApiOptions = {}
): Promise<TextInspectionResult> {
  const sessionId = options.sessionId ?? generateSessionId();

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