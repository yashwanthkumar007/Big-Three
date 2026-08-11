import { create } from "zustand";
import type { InspectionReport } from "@/shared/api/textInspectionApi";

export type InspectionType =
  | "text"
  | "graphics"
  | "spelling"
  | "braille"
  | "barcode"
  | "notes";

export type InspectionStatus =
  | "idle"
  | "uploading"
  | "inspecting"
  | "completed"
  | "failed";

interface UploadState {
  masterFile: File | null;
  sampleFile: File | null;
  inspectionType: InspectionType | null;
  inspectionStatus: InspectionStatus;
  inspectionReport: InspectionReport | null;
  sessionId: string | null;
  error: string | null;

  setMasterFile: (file: File | null) => void;
  setSampleFile: (file: File | null) => void;
  setInspectionType: (type: InspectionType) => void;
  setInspectionStatus: (status: InspectionStatus) => void;
  setInspectionReport: (report: InspectionReport | null) => void;
  setSessionId: (sessionId: string | null) => void;
  setError: (error: string | null) => void;

  clearMasterFile: () => void;
  clearSampleFile: () => void;
  clearAll: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  masterFile: null,
  sampleFile: null,
  inspectionType: null,
  inspectionStatus: "idle",
  inspectionReport: null,
  sessionId: null,
  error: null,

  setMasterFile: (file) =>
    set({
      masterFile: file,
    }),

  setSampleFile: (file) =>
    set({
      sampleFile: file,
    }),

  setInspectionType: (type) =>
    set({
      inspectionType: type,
    }),

  setInspectionStatus: (status) =>
    set({
      inspectionStatus: status,
    }),

  setInspectionReport: (report) =>
    set({
      inspectionReport: report,
    }),

  setSessionId: (sessionId) =>
    set({
      sessionId,
    }),

  setError: (error) =>
    set({
      error,
    }),

  clearMasterFile: () =>
    set({
      masterFile: null,
    }),

  clearSampleFile: () =>
    set({
      sampleFile: null,
    }),

  clearAll: () =>
    set({
      masterFile: null,
      sampleFile: null,
      inspectionType: null,
      inspectionStatus: "idle",
      inspectionReport: null,
      sessionId: null,
      error: null,
    }),
}));