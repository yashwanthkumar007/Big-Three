import { create } from "zustand";
import type { InspectionReport } from "@/shared/api/inspectionApi";
import {
  createDefaultBarcodeConfig,
  type BarcodeConfig,
} from "@/shared/config/barcodeInspectionConfig";

export type InspectionType =
  | "text"
  | "graphics"
  | "spelling"
  | "braille"
  | "barcode"
  | "notes";

/**
 * Difference Filter state — mirrors the Inspection sidebar's
 * "Difference Filter" checkboxes. Persisted in the shared store so the
 * selected filters are available when the inspection is triggered AND
 * when the results are rendered.
 */
export type DifferenceFilters = {
  case: boolean;
  change: boolean;
  deletion: boolean;
  hyphen: boolean;
  insertion: boolean;
  location: boolean;
  bold: boolean;
  italic: boolean;
  color: boolean;
  fontType: boolean;
  mixedFont: boolean;
  space: boolean;
  size: boolean;
  underline: boolean;
};

export const DEFAULT_DIFFERENCE_FILTERS: DifferenceFilters = {
  case: true,
  change: true,
  deletion: true,
  hyphen: true,
  insertion: true,
  location: true,
  bold: false,
  italic: false,
  color: false,
  fontType: false,
  mixedFont: false,
  space: true,
  size: true,
  underline: false,
};

export type InspectionStatus =
  | "idle"
  | "uploading"
  | "inspecting"
  | "completed"
  | "failed";

/** Recursively optional view of a type, used for configuration patches. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? DeepPartial<T[K]>
    : T[K] extends (infer U)[]
      ? U[]
      : T[K];
};

/** Deeply merges a patch into a target object without mutating either. */
const deepMerge = <T,>(target: T, patch: DeepPartial<T>): T => {
  const output = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }
    const current = output[key];
    output[key] =
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
        ? deepMerge(current, value as DeepPartial<unknown>)
        : value;
  }
  return output as T;
};


interface UploadState {
  masterFile: File | null;
  sampleFile: File | null;
  masterFileName: string | null;
  sampleFileName: string | null;
  inspectionType: InspectionType | null;
  inspectionStatus: InspectionStatus;
  inspectionReport: InspectionReport | null;
  sessionId: string | null;
  error: string | null;
  differenceFilters: DifferenceFilters;

  /**
   * Barcode Inspection configuration panel state. One object drives the whole
   * panel and is sent to the backend as `barcode_config` on Inspect.
   */
  barcodeConfig: BarcodeConfig;

  /** Per-difference comment/status selections. Key = difference id. */
  commentSelections: Record<number, string>;
  /** Per-difference level selections. Key = difference id. */
  levelSelections: Record<number, string>;
  /** Custom comments entered by the user on screen. */
  customComments: string[];

  setMasterFile: (file: File | null) => void;
  setSampleFile: (file: File | null) => void;
  setInspectionType: (type: InspectionType) => void;
  setInspectionStatus: (status: InspectionStatus) => void;
  setInspectionReport: (report: InspectionReport | null) => void;
  setSessionId: (sessionId: string | null) => void;
  setError: (error: string | null) => void;
  setDifferenceFilters: (filters: DifferenceFilters) => void;
  setBarcodeConfig: (config: BarcodeConfig) => void;
  /** Merges a partial update into the Barcode Inspection configuration. */
  patchBarcodeConfig: (patch: DeepPartial<BarcodeConfig>) => void;
  /** Restores the documented Barcode Inspection defaults. */
  resetBarcodeConfig: () => void;
  setCommentSelections: (selections: Record<number, string>) => void;
  setLevelSelections: (selections: Record<number, string>) => void;
  setCustomComments: (comments: string[]) => void;

  clearMasterFile: () => void;
  clearSampleFile: () => void;
  clearAll: () => void;
}

/* ------------------------------------------------------------------ */
/* BroadcastChannel for cross-window synchronization                  */
/* ------------------------------------------------------------------ */

export const DIFFERENCE_LIST_CHANNEL = "difference-list-sync";

export type DifferenceListSyncMessage = {
  type: "state-updated";
  commentSelections: Record<number, string>;
  levelSelections: Record<number, string>;
  inspectionReport: InspectionReport | null;
  masterFileName: string | null;
  sampleFileName: string | null;
  sessionId: string | null;
};

let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(DIFFERENCE_LIST_CHANNEL);
  }
  return broadcastChannel;
}

export function broadcastStateUpdate(
  state: Pick<
    UploadState,
    | "commentSelections"
    | "levelSelections"
    | "inspectionReport"
    | "masterFileName"
    | "sampleFileName"
    | "sessionId"
  >
) {
  const channel = getBroadcastChannel();
  if (!channel) {
    return;
  }

  const message: DifferenceListSyncMessage = {
    type: "state-updated",
    commentSelections: state.commentSelections,
    levelSelections: state.levelSelections,
    inspectionReport: state.inspectionReport,
    masterFileName: state.masterFileName,
    sampleFileName: state.sampleFileName,
    sessionId: state.sessionId,
  };

  channel.postMessage(message);
}

export function subscribeToStateUpdates(
  callback: (message: DifferenceListSyncMessage) => void
): () => void {
  const channel = getBroadcastChannel();
  if (!channel) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    const data = event.data as DifferenceListSyncMessage;
    if (data && data.type === "state-updated") {
      callback(data);
    }
  };

  channel.addEventListener("message", handler);
  return () => {
    channel.removeEventListener("message", handler);
  };
}

/* ------------------------------------------------------------------ */
/* Zustand store backed by backend storage, not local browser storage    */
/* ------------------------------------------------------------------ */

export const useUploadStore = create<UploadState>()((set, get) => ({
  masterFile: null,
  sampleFile: null,
  masterFileName: null,
  sampleFileName: null,
  inspectionType: null,
  inspectionStatus: "idle",
  inspectionReport: null,
  sessionId: null,
  error: null,
  differenceFilters: { ...DEFAULT_DIFFERENCE_FILTERS },
  barcodeConfig: createDefaultBarcodeConfig(),
  commentSelections: {},
  levelSelections: {},
  customComments: [],

  setMasterFile: (file) =>
    set({
      masterFile: file,
      masterFileName: file?.name ?? null,
    }),

  setSampleFile: (file) =>
    set({
      sampleFile: file,
      sampleFileName: file?.name ?? null,
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

  setDifferenceFilters: (filters) =>
    set({
      differenceFilters: filters,
    }),

  setBarcodeConfig: (config) =>
    set({
      barcodeConfig: config,
    }),

  patchBarcodeConfig: (patch) =>
    set((state) => ({
      barcodeConfig: deepMerge(state.barcodeConfig, patch),
    })),

  resetBarcodeConfig: () =>
    set({
      barcodeConfig: createDefaultBarcodeConfig(),
    }),

  setCommentSelections: (selections) => {
    set({ commentSelections: selections });
    const state = get();
    broadcastStateUpdate({
      commentSelections: selections,
      levelSelections: state.levelSelections,
      inspectionReport: state.inspectionReport,
      masterFileName: state.masterFileName,
      sampleFileName: state.sampleFileName,
      sessionId: state.sessionId,
    });
  },

  setLevelSelections: (selections) => {
    set({ levelSelections: selections });
    const state = get();
    broadcastStateUpdate({
      commentSelections: state.commentSelections,
      levelSelections: selections,
      inspectionReport: state.inspectionReport,
      masterFileName: state.masterFileName,
      sampleFileName: state.sampleFileName,
      sessionId: state.sessionId,
    });
  },

  setCustomComments: (comments) =>
    set({
      customComments: comments,
    }),

  clearMasterFile: () =>
    set({
      masterFile: null,
      masterFileName: null,
    }),

  clearSampleFile: () =>
    set({
      sampleFile: null,
      sampleFileName: null,
    }),

  clearAll: () =>
    set({
      masterFile: null,
      sampleFile: null,
      masterFileName: null,
      sampleFileName: null,
      inspectionType: null,
      inspectionStatus: "idle",
      inspectionReport: null,
      sessionId: null,
      error: null,
      differenceFilters: { ...DEFAULT_DIFFERENCE_FILTERS },
      barcodeConfig: createDefaultBarcodeConfig(),
      commentSelections: {},
      levelSelections: {},
      customComments: [],
    }),
}));