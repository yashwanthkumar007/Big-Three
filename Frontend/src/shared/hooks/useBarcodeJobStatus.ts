import { useCallback, useEffect, useRef, useState } from "react";

import {
  cancelBarcodeInspection,
  fetchBarcodeInspection,
  type BarcodeJob,
  type BarcodeJobResult,
} from "@/shared/api/inspectionApi";
import {
  INITIAL_BARCODE_STAGE,
  resolveBarcodeStage,
  type BarcodeStage,
} from "@/shared/config/barcodeInspectionConfig";

/** How often the job is polled while it runs. */
const POLL_INTERVAL_MS = 1000;
const MAX_CONSECUTIVE_POLL_FAILURES = 8;
const MAX_POLL_RETRY_DELAY_MS = 15_000;

type BarcodeJobState = {
  /** Real stage reported by the engine. */
  stage: BarcodeStage;
  /** Raw backend status, once the first poll has landed. */
  status: BarcodeJob["status"] | null;
  /** Live progress, straight from the engine — never faked. */
  currentPage: number;
  totalPages: number;
  barcodeCount: number;
  /** Engine error message when the job failed. */
  error: string | null;
  /** Validated results — only populated once the job has completed. */
  barcodes: BarcodeJobResult[];
  /** True once the job reached a terminal state. */
  isFinished: boolean;
  isCancelling: boolean;
  cancel: () => Promise<void>;
};

/**
 * Internal snapshot, tagged with the job it belongs to. Tagging is what lets
 * the hook report the empty state for a cleared/new job id without an effect
 * that only exists to write state.
 */
type BarcodeJobSnapshot = Omit<
  BarcodeJobState,
  "isFinished" | "isCancelling" | "cancel"
> & { jobId: string | null };

const EMPTY_SNAPSHOT: BarcodeJobSnapshot = {
  jobId: null,
  stage: INITIAL_BARCODE_STAGE,
  status: null,
  currentPage: 0,
  totalPages: 0,
  barcodeCount: 0,
  error: null,
  barcodes: [],
};

/**
 * Polls the background barcode job that the Start action created.
 *
 * The job id is known as soon as Start returns, so the result page can open
 * and start polling immediately — it never waits for the engine. The status,
 * stage, page progress and final results all come from the backend; nothing on
 * this screen is simulated. Terminal states (completed / failed / cancelled)
 * stop the loop.
 */
export function useBarcodeJobStatus(
  jobId: string | null,
  onFinished?: (job: BarcodeJob) => void,
): BarcodeJobState {
  const [snapshot, setSnapshot] = useState<BarcodeJobSnapshot>(
    EMPTY_SNAPSHOT,
  );
  const [isCancelling, setIsCancelling] = useState(false);

  /* Keep the callback in a ref so polling isn't restarted when it changes. */
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    /*
     * With no job there is nothing to poll. No state needs clearing here: the
     * snapshot is only reported when its `jobId` matches the id passed in, so
     * a cleared id already reads as EMPTY_SNAPSHOT.
     */
    if (!jobId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;

    const poll = async () => {
      try {
        const job = await fetchBarcodeInspection(jobId);
        if (cancelled) return;

        consecutiveFailures = 0;

        setSnapshot({
          jobId,
          stage: resolveBarcodeStage(job.stage),
          status: job.status,
          currentPage: job.currentPage ?? 0,
          totalPages: job.totalPages ?? 0,
          barcodeCount: job.barcodeCount ?? 0,
          error: job.error ?? null,
          barcodes: job.barcodes ?? [],
        });

        if (["completed", "failed", "cancelled"].includes(job.status)) {
          onFinishedRef.current?.(job);
          return; // terminal — stop polling
        }
      } catch (error) {
        if (cancelled) return;

        consecutiveFailures += 1;
        const statusCode = (
          error as { response?: { status?: number } }
        )?.response?.status;
        const isPermanentClientError =
          statusCode !== undefined &&
          statusCode >= 400 &&
          statusCode < 500 &&
          statusCode !== 408 &&
          statusCode !== 429;

        if (
          isPermanentClientError ||
          consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES
        ) {
          const responseError = (
            error as { response?: { data?: { error?: unknown } } }
          )?.response?.data?.error;
          const message =
            typeof responseError === "string"
              ? responseError
              : error instanceof Error
                ? error.message
                : "Could not retrieve the barcode inspection status.";

          setSnapshot((previous) => ({
            ...previous,
            jobId,
            status: "failed",
            error: isPermanentClientError
              ? message
              : `Unable to retrieve barcode inspection status after repeated connection failures. ${message}`,
          }));
          return;
        }

        const retryDelay = Math.min(
          POLL_INTERVAL_MS * 2 ** (consecutiveFailures - 1),
          MAX_POLL_RETRY_DELAY_MS,
        );
        timer = setTimeout(poll, retryDelay);
        return;
      }

      if (!cancelled) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    setIsCancelling(true);
    try {
      await cancelBarcodeInspection(jobId);
    } catch (error) {
      console.error("[BARCODE] Cancel failed:", error);
    } finally {
      setIsCancelling(false);
    }
  }, [jobId]);

  /*
   * The snapshot is only reported while it belongs to the CURRENT job id.
   * Clearing the id (cancel → back to the viewer) or starting a new run
   * therefore reads as the empty state immediately, instead of briefly showing
   * the previous run's results while the new job's first poll lands.
   */
  const current = snapshot.jobId === jobId ? snapshot : EMPTY_SNAPSHOT;

  return {
    stage: current.stage,
    status: current.status,
    currentPage: current.currentPage,
    totalPages: current.totalPages,
    barcodeCount: current.barcodeCount,
    error: current.error,
    barcodes: current.barcodes,
    isFinished:
      current.status === "completed" ||
      current.status === "failed" ||
      current.status === "cancelled",
    isCancelling,
    cancel,
  };
}
