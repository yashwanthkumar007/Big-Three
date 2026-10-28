import axios from "axios";
import { generateInspectionSessionId } from "@/shared/utils/inspectionSessionId";
import {
  INSPECTION_ERROR_PREFIX,
  getInspectionLabel,
} from "@/shared/config/inspectionConfig";
import type { InspectionType } from "@/store/uploadStore";
import type { BarcodeConfig } from "@/shared/config/barcodeInspectionConfig";
import type { BrailleInspectionOptions } from "@/shared/config/brailleInspectionConfig";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const INSPECTION_UPLOAD_TIMEOUT_MS = 120_000;
const BARCODE_JOB_CREATE_TIMEOUT_MS = 30_000;
const BARCODE_JOB_POLL_TIMEOUT_MS = 15_000;

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
  /**
   * Barcode Inspection configuration (profile, resolution, formats, options,
   * 3D/depth, pages, quality checks) sent as `barcode_config`. Only the
   * Barcode pipeline consumes it.
   */
  barcodeConfig?: BarcodeConfig;
  /** Braille settings currently supported by the Braille pipeline. */
  brailleConfig?: Pick<BrailleInspectionOptions, "language">;
  /**
   * Persistent inspection id (created via `createInspection`). When provided,
   * it is used as the engine session id, the file re-upload is skipped (the
   * files were already persisted server-side), and the run is tracked in
   * Cosmos DB (submitted → processing → completed/failed).
   */
  inspectionId?: string;
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
  status?: string | null;
  page: number;
  master_box: BoundingBox | null;
  sample_box: BoundingBox | null;
  source: string;
  barcode_type?: string | null;
  decoded_value?: string | null;
  grade?: string | null;
  braille_metrics?: {
    lines?: number;
    characters?: number;
    dots?: number;
    dot_h_mm?: number | null;
    dot_v_mm?: number | null;
    character_mm?: number | null;
    word_mm?: number | null;
    line_mm?: number | null;
  } | null;
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
  metadata?: { language?: string };
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


/* -------------------------------------------------------------------------- */
/*                   Persistent Inspections (Cosmos DB + Blob)                */
/* -------------------------------------------------------------------------- */

export type InspectionFileMeta = {
  fileId: string;
  fileName: string;
  fileType: string;
  blobPath: string;
  size: number;
};

export type InspectionMeta = {
  inspectionId: string;
  userId: string;
  accountType: string;
  inspectionType: string;
  status: "uploaded" | "submitted" | "processing" | "completed" | "failed" | "cancelled";
  masterFile: InspectionFileMeta | null;
  sampleFile: InspectionFileMeta | null;
  /**
   * Barcode Inspection is a SINGLE-FILE workflow: this is the one uploaded
   * document the barcode job operates on (no Master/Sample pair).
   */
  inspectionFile?: InspectionFileMeta | null;
  /**
   * Real processing stage reported by the engine, e.g. "barcode_detection",
   * "barcode_decoding", "barcode_validation", "saving_results".
   */
  stage?: string | null;
  createdAt: string | null;
  uploadedAt: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedReason?: string | null;
  resultId: string | null;
  result?: { resultId: string; report: InspectionReport };
};

/**
 * Identity header for the current authenticated user. The email is used ONLY
 * as a login identifier — the backend resolves the real identity/accountType
 * from its own database and enforces ownership server-side.
 */
const identityHeaders = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem("user");
    const email = raw ? (JSON.parse(raw)?.email as string | undefined) : undefined;
    return email ? { "X-User-Email": email } : {};
  } catch {
    return {};
  }
};

/**
 * Creates a persistent inspection: uploads the provided document files to
 * the backend (Azure Blob Storage) and registers the inspection in Cosmos DB.
 * Returns the server-issued inspection metadata.
 */
export async function createInspection(
  masterFile: File,
  sampleFile: File | null,
  inspectionType: string
): Promise<InspectionMeta> {
  const formData = new FormData();
  formData.append("master", masterFile);
  if (sampleFile) {
    formData.append("sample", sampleFile);
  }
  formData.append("inspectionType", inspectionType);

  const response = await axios.post(
    `${API_BASE_URL}/api/inspections`,
    formData,
    {
      headers: { "Content-Type": "multipart/form-data", ...identityHeaders() },
      timeout: INSPECTION_UPLOAD_TIMEOUT_MS,
    }
  );
  return response.data as InspectionMeta;
}

/**
 * Cancels a running inspection (owner-verified on the backend).
 *
 * The uploaded file and the inspection record are preserved; only the run is
 * stopped, so the user returns to the document viewer and can start again.
 */
export async function cancelInspection(
  inspectionId: string,
): Promise<{ cancelled: boolean; inspectionId: string; alreadyFinished?: boolean }> {
  const response = await axios.post(
    `${API_BASE_URL}/api/inspections/${encodeURIComponent(inspectionId)}/cancel`,
    {},
    { headers: identityHeaders() }
  );
  return response.data as {
    cancelled: boolean;
    inspectionId: string;
    alreadyFinished?: boolean;
  };
}

/** Lists ONLY the current user's inspections (newest first). */
export async function fetchMyInspections(limit?: number): Promise<InspectionMeta[]> {
  const response = await axios.get(`${API_BASE_URL}/api/inspections`, {
    headers: identityHeaders(),
    params: limit ? { limit } : undefined,
  });
  return response.data as InspectionMeta[];
}

/** Fetches a single inspection — owner-verified on the backend. */
export async function fetchInspection(inspectionId: string): Promise<InspectionMeta> {
  const response = await axios.get(
    `${API_BASE_URL}/api/inspections/${encodeURIComponent(inspectionId)}`,
    { headers: identityHeaders() }
  );
  return response.data as InspectionMeta;
}

/* -------------------------------------------------------------------------- */
/*              Barcode Inspection background job (live status + results)     */
/* -------------------------------------------------------------------------- */
/*
 * Barcode Inspection runs as a background job so Start can return immediately
 * and the result page can open while the engine is still working:
 *
 *   POST /api/barcode-inspection            -> 202 + { inspectionId, status }
 *   GET  /api/barcode-inspection/<id>       -> live status, then the results
 *   POST /api/barcode-inspection/<id>/cancel
 *
 * The id here is the JOB id, which is a different handle from the persisted
 * inspection id above. The persisted id is what the job is started from.
 */

/** One validated barcode, as reported by the engine. */
export type BarcodeJobResult = {
  id: number;
  /** 1-based page the barcode was found on. */
  page: number;
  /** Detected symbology, e.g. "EAN-13". */
  type: string;
  formatId: string;
  decodedValue: string;
  grade: string | null;
  /** Box in the 150-DPI space the viewer draws overlays in. */
  bbox: BoundingBox;
  polygon: { x: number; y: number }[];
  decoder: string;
  qualityMetrics?: Record<string, unknown> | null;
  /**
   * Basis every `bbox` on this result is expressed in. Currently always
   * `"pdf_points"` (72 pt = 1 inch, origin top-left, y growing downwards).
   *
   * The frontend maps a box onto the rendered page with a SINGLE ratio:
   * `scaleX = viewport.width / pageWidth`. It must NOT additionally multiply
   * by the zoom, because the viewport already encodes the zoom.
   */
  coordinateSystem?: string;
  /** Display size of the page in the same units as `bbox` (post-rotation). */
  pageWidth?: number;
  pageHeight?: number;
  /**
   * Heuristic verification payload from the engine's BarcodeVerifier.
   *
   * Every field is nullable by design: the engine returns `null` for any
   * metric it could not measure reliably rather than inventing a number, so
   * the UI must render those as "N/A". Absent entirely on older results.
   */
  verification?: BarcodeVerification | null;
  validated: boolean;
  level?: string | null;
  comment?: string | null;
};

/**
 * One graded verification metric, e.g. symbol contrast.
 *
 * `grade` is null when the engine produced no grade for the metric (some
 * metrics, such as max reflectance, are values without a meaningful grade).
 */
export type BarcodeVerificationMetric = {
  grade: string | null;
  value: number | null;
  unit?: string;
};

/** A metric reported as a bare value with no grade, e.g. max reflectance. */
export type BarcodeVerificationValue = {
  value: number | null;
  unit?: string;
};

/**
 * Quiet zone: left/right for linear symbols, or all four sides under `other`
 * for 2D symbols.
 */
export type BarcodeVerificationQuietZone = {
  grade: string | null;
  left: number | null;
  right: number | null;
  other?: {
    left: number | null;
    right: number | null;
    top: number | null;
    bottom: number | null;
  } | null;
};

/** Heuristic verification block attached to each validated barcode. */
export type BarcodeVerification = {
  overallGrade: string | null;
  decodability: BarcodeVerificationMetric | null;
  magnification: BarcodeVerificationMetric | null;
  symbolContrast: BarcodeVerificationMetric | null;
  minimumEdgeContrast: BarcodeVerificationMetric | null;
  modulation: BarcodeVerificationMetric | null;
  /** Defect severity: LOWER is better, so 0 grades best. */
  defects: BarcodeVerificationMetric | null;
  /** Heuristic decode indicator on a 0-4 scale. */
  decode: BarcodeVerificationMetric | null;
  quietZone: BarcodeVerificationQuietZone | null;
  narrowBar: BarcodeVerificationMetric | null;
  /** Null for fixed-width symbologies, which encode no wide element. */
  wideBar: BarcodeVerificationMetric | null;
  /** Plain number, not an object: null when not measurable. */
  wideToNarrowRatio: number | null;
  gap: BarcodeVerificationMetric | null;
  /** Null unless deterministic structural validation exists. */
  dataStructure: BarcodeVerificationMetric | null;
  minReflectance: BarcodeVerificationMetric | null;
  maxReflectance: BarcodeVerificationValue | null;
  /** Bar width reduction/increase in mm. */
  bwr: BarcodeVerificationValue | null;
  /** Present when verification could not be completed for this ROI. */
  error?: string;
  disclaimer?: string;
};

export type BarcodeJobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export type BarcodeJob = {
  inspectionId: string;
  status: BarcodeJobStatus;
  /** Real engine stage id, e.g. "barcode_detection". */
  stage: string;
  /** Human label for the stage, e.g. "Barcode Detection". */
  stageLabel: string;
  currentPage: number;
  totalPages: number;
  barcodeCount: number;
  error?: string | null;
  /** Only present once the job has completed. */
  barcodes?: BarcodeJobResult[];
};

/**
 * Creates the barcode job and returns at once. The engine keeps running on the
 * backend; this call never waits for the document to be processed.
 */
export async function createBarcodeInspection(
  inspectionId: string,
  barcodeConfig?: BarcodeConfig,
): Promise<{ inspectionId: string; status: BarcodeJobStatus; stage: string }> {
  const response = await axios.post(
    `${API_BASE_URL}/api/barcode-inspection`,
    {
      inspection_id: inspectionId,
      ...(barcodeConfig ? { barcode_config: barcodeConfig } : {}),
    },
    { headers: identityHeaders(), timeout: BARCODE_JOB_CREATE_TIMEOUT_MS },
  );
  return response.data as { inspectionId: string; status: BarcodeJobStatus; stage: string };
}

/** Polls the live job status. Results are attached once it has completed. */
export async function fetchBarcodeInspection(jobId: string): Promise<BarcodeJob> {
  const response = await axios.get(
    `${API_BASE_URL}/api/barcode-inspection/${encodeURIComponent(jobId)}`,
    { headers: identityHeaders(), timeout: BARCODE_JOB_POLL_TIMEOUT_MS },
  );
  return response.data as BarcodeJob;
}

/**
 * Stops a running barcode job. The engine checks this cooperatively, so the
 * job settles into `cancelled` shortly after the call returns.
 */
export async function cancelBarcodeInspection(
  jobId: string,
): Promise<{ cancelled: boolean; inspectionId: string }> {
  const response = await axios.post(
    `${API_BASE_URL}/api/barcode-inspection/${encodeURIComponent(jobId)}/cancel`,
    {},
    { headers: identityHeaders() },
  );
  return response.data as { cancelled: boolean; inspectionId: string };
}

/**
 * Fetches the actual master/sample file bytes for a persisted inspection
 * (owner-verified on the backend) and reconstructs a real File object so the
 * existing PDF viewer / InspectionResults component can render it.
 *
 * Returns null if the fetch fails (e.g. not found, unauthorized, unavailable).
 */
export async function fetchInspectionFile(
  inspectionId: string,
  side: "master" | "sample",
  fileName: string
): Promise<File | null> {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/inspections/${encodeURIComponent(inspectionId)}/file`,
      {
        headers: identityHeaders(),
        params: { side },
        responseType: "blob",
      }
    );
    const blob = response.data as Blob;
        const type = String(response.headers["content-type"] ?? "application/pdf");
    return new File([blob], fileName, { type });
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */

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
  sampleFile: File | null,
  options: InspectionApiOptions = {}
): Promise<InspectionRunResult> {
  const inspectionType = options.inspectionType ?? "text";
  const label = getInspectionLabel(inspectionType);
  const errorPrefix = INSPECTION_ERROR_PREFIX[inspectionType as InspectionType] ??
    `${label} failed`;

  const sessionId =
    options.inspectionId ?? options.sessionId ?? generateSessionId(inspectionType);

  const setStatus = (status: string, progress?: number) => {
    options.onStatus?.({ status, progress });
  };

  setStatus(`Uploading files...`, 10);

  try {
    if (options.inspectionId) {
      // Persistent run: the files were already uploaded to Azure Blob
      // Storage and local engine copies written by POST /api/inspections,
      // so skip the transient upload calls.
      setStatus(`Loading ${label} files...`, 40);
    } else {
      await uploadFile(masterFile, sessionId, "master");
      setStatus(`Loading ${label} — Master...`, 40);

      if (sampleFile) {
        await uploadFile(sampleFile, sessionId, "sample");
      }
    }
    setStatus(`Comparing ${label.toLowerCase()}...`, 80);

    const response = await axios.post(`${API_BASE_URL}/api/inspect`, {
      session_id: sessionId,
      inspection_type: inspectionType,
      ...(options.inspectionId ? { inspection_id: options.inspectionId } : {}),
      ...(options.differenceFilters
        ? { filters: options.differenceFilters }
        : {}),
      ...(inspectionType === "barcode" && options.barcodeConfig
        ? { barcode_config: options.barcodeConfig }
        : {}),
      ...(inspectionType === "braille" && options.brailleConfig
        ? { braille_config: options.brailleConfig }
        : {}),
    }, {
      // /api/inspect may associate the run with a persisted inspection,
      // which requires the authenticated identity header.
      headers: identityHeaders(),
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
/* -------------------------------------------------------------------------- */
/*                        Crop Compare (region-scoped run)                    */
/* -------------------------------------------------------------------------- */

export type CropFinding = {
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

export type CropRunResult = {
  findings: CropFinding[];
  match_stats: {
    matched_pairs: number;
    unmatched_master: number;
    unmatched_sample: number;
  };
  region: { page: number; box_px: BoundingBox };
  log_file?: string | null;
};

export type CropInspectOptions = {
  /**
   * Engine session id (fresh run). For a persisted inspection, pass
   * `inspectionId` instead — the backend owner-verifies it and downloads
   * the master/sample files from Blob Storage if the local engine copy
   * is missing, so Crop Compare works on reopened results too.
   */
  sessionId?: string;
  inspectionId?: string;
  /** 0-based page number the crop was drawn on. */
  page: number;
  /** Crop box in DPI-150 pixel space (same space as finding boxes). */
  box: BoundingBox;
};

/**
 * Runs the crop-scoped Text Inspection on a region of a single page and
 * returns findings in the same pixel-space shape as the full run.
 */
export async function cropInspect(
  options: CropInspectOptions
): Promise<CropRunResult> {
  const response = await axios.post(
    `${API_BASE_URL}/api/crop_inspect`,
    {
      ...(options.sessionId ? { session_id: options.sessionId } : {}),
      ...(options.inspectionId ? { inspection_id: options.inspectionId } : {}),
      page: options.page,
      box: options.box,
    },
    {
      // Persisted-inspection resolution requires the authenticated
      // identity header (same requirement as /api/inspect).
      headers: identityHeaders(),
    }
  );
  return response.data as CropRunResult;
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