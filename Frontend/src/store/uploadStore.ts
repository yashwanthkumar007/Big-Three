import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InspectionReport } from "@/shared/api/inspectionApi";

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
  color: boolean;
  fontType: boolean;
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
  color: false,
  fontType: false,
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
/* Zustand store with persist middleware                              */
/* ------------------------------------------------------------------ */

export const useUploadStore = create<UploadState>()(
  persist(
    (set, get) => ({
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
          commentSelections: {},
          levelSelections: {},
          customComments: [],
        }),
    }),
    {
      name: "text-inspection-store",
      // Only persist serializable data — File objects cannot be stored
      partialize: (state) => ({
        masterFileName: state.masterFileName,
        sampleFileName: state.sampleFileName,
        inspectionType: state.inspectionType,
        inspectionStatus: state.inspectionStatus,
        inspectionReport: state.inspectionReport,
        sessionId: state.sessionId,
        differenceFilters: state.differenceFilters,
        commentSelections: state.commentSelections,
        levelSelections: state.levelSelections,
        customComments: state.customComments,
      }),
    }
  )
);