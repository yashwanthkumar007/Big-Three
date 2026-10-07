import {
  Box,
  Button,
  Divider,
  Typography,
} from "@mui/material";

import { useNavigate, useParams } from "react-router-dom";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import ViewerPane from "./components/ViewerPane";

import InspectionSidebar from "./components/InspectionSidebar";

import BarcodeInspectionSidebar from "./components/BarcodeInspectionSidebar";

import InspectionLoading from "./components/InspectionLoading";

import BarcodeInspectionLoading from "./components/BarcodeInspectionLoading";

import BarcodeInspectionResults, {
  type BarcodeResultPageModel,
} from "./components/BarcodeInspectionResults";

import InspectionResults, {
  type InspectionResult,
  type InspectionDifference,
} from "./components/InspectionResults";

import { useUploadStore, type InspectionType } from "@/store/uploadStore";
import { truncateFileName } from "@/shared/utils/truncateFileName";

import {
  createBarcodeInspection,
  startInspection,
  createInspection,
} from "@/shared/api/inspectionApi";

import { useBarcodeJobStatus } from "@/shared/hooks/useBarcodeJobStatus";

import { BARCODE_STAGE_LABELS } from "@/shared/config/barcodeInspectionConfig";

import { useQueryClient } from "@tanstack/react-query";

import { useLoadingStatus } from "@/shared/hooks/useInspectionLoading";

export default function WorkspacePage() {
  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const { inspectionType } = useParams();

  const [sidebarOpen, setSidebarOpen] =
    useState(false);

  const [isFullscreen, setIsFullscreen] =
    useState(false);

  const [
    selectedDifference,
    setSelectedDifference,
  ] = useState<InspectionDifference | null>(
    null
  );

  const {
    masterFile,
    sampleFile,
    inspectionStatus,
    inspectionReport,
    differenceFilters,
    barcodeConfig,
    sessionId: storeSessionId,
    setInspectionStatus,
    setInspectionReport,
    setSessionId,
    setError,
    setMasterFile,
    setSampleFile,
  } = useUploadStore();

  const {
    status,
    setStatus,
  } = useLoadingStatus();

  /*
   * Barcode Inspection does NOT open its filter panel automatically after the
   * upload. The document simply opens in the existing viewer and the panel is
   * opened on demand by the top "Start" button. An inspection is never started
   * merely because the upload succeeded.
   */
  const [barcodePageCount, setBarcodePageCount] = useState(1);

  /*
   * Barcode Inspection is a SINGLE-FILE workflow: the id of the barcode job is
   * tracked so the processing screen can poll the real backend stage/status
   * and cancel the run. No Master/Sample job ids are involved.
   */
  const [barcodeInspectionId, setBarcodeInspectionId] = useState<string | null>(
    null,
  );

  /*
   * Re-entry guard for the Start action. Only one inspection may be started
   * per click: a second click (or a double click) while the first one is still
   * being created must not create a second job.
   */
  const isStartingRef = useRef(false);

  const isBarcodeInspection = inspectionType === "barcode";

  const barcodeJob = useBarcodeJobStatus(
    isBarcodeInspection ? barcodeInspectionId : null,
  );

  /**
   * Cancels the running barcode job and returns to the document viewer. The
   * uploaded file and the inspection record are kept by the backend.
   */
  const handleCancelBarcode = useCallback(async () => {
    await barcodeJob.cancel();

    setInspectionStatus("idle");
    setStatus(null);
    setBarcodeInspectionId(null);
    setSessionId(null);
  }, [barcodeJob, setInspectionStatus, setStatus, setSessionId]);

  /* ------------------------------------------------------------------ */
  /* Redirect to upload page if files are missing                       */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!masterFile || (!sampleFile && (inspectionType ?? "text") !== "barcode")) {
      navigate(
        `/workspace/${inspectionType ?? "text"}/upload`
      );
    }
  }, [
    masterFile,
    sampleFile,
    inspectionType,
    navigate,
  ]);

  /* ------------------------------------------------------------------ */
  /* Run inspection                                                     */
  /* ------------------------------------------------------------------ */

  const runInspection = useCallback(async () => {
    /*
     * Re-entry guard: the Start action may only be in flight once. A double
     * click must never create a second inspection or a second barcode job.
     */
    if (isStartingRef.current) {
      return;
    }

    /*
     * The inspection type comes from the URL parameter and is passed
     * through to the backend via `inspection_type`, which dispatches
     * to the correct pipeline.  Any registered inspection type
     * (text, graphics, spelling, …) is supported here.
     */
    if (!masterFile || (!sampleFile && (inspectionType ?? "text") !== "barcode")) {
      return;
    }

    const resolvedSampleFile = inspectionType === "barcode" ? masterFile : (sampleFile ?? masterFile);

    isStartingRef.current = true;

    try {
      /*
       * Backend inspection starts ONLY when this
       * function is explicitly called.
       */
      setInspectionStatus("uploading");

      setStatus("Uploading files...");

      /*
       * Persist the inspection first: files go to Azure Blob Storage and
       * the inspection record to Cosmos DB, owned by the authenticated
       * user (the backend resolves the user — never the client). If the
       * persistence layer is unavailable, fall back to the legacy
       * ephemeral flow so the workspace keeps working.
       */
      let inspectionId: string | undefined;
      try {
        const inspection = await createInspection(
          masterFile,
          resolvedSampleFile,
          inspectionType ?? "text"
        );
        inspectionId = inspection.inspectionId;
      } catch (persistError) {
        console.warn(
          "[WORKSPACE] Persistent inspection unavailable, running ephemeral:",
          persistError
        );
      }

      /*
       * Barcode Inspection is started as a BACKGROUND job.
       *
       * The engine runs on the server: this call returns as soon as the job
       * exists, so the result page can be opened immediately and then poll the
       * job for live progress and the final results. Nothing here waits for
       * barcode detection to finish — that is what used to block the browser
       * for the whole inspection.
       */
      if (isBarcodeInspection) {
        if (!inspectionId) {
          throw new Error(
            "The document could not be stored, so the inspection could not start. Please try again."
          );
        }

        const job = await createBarcodeInspection(inspectionId, barcodeConfig);

        // The job id is all the result page needs; it takes over from here and
        // the engine keeps running server-side.
        setBarcodeInspectionId(job.inspectionId);
        setSessionId(null);
        setStatus(null);
        setInspectionStatus("inspecting");
        return;
      }

      const {
        sessionId,
        report,
      } = await startInspection(
        masterFile,
        resolvedSampleFile,
        {
          /* Dynamic session ID prefix follows the inspection type
           * (text -> TXT-, graphics -> GRP-, etc.). */
          inspectionType: inspectionType as InspectionType,
          differenceFilters,
          barcodeConfig: isBarcodeInspection ? barcodeConfig : undefined,
          inspectionId,
          onStatus: ({
            status: currentStatus,
          }) => {
            setStatus(currentStatus);

            if (
              currentStatus.includes(
                "Comparing"
              ) ||
              currentStatus.includes(
                "Preparing"
              )
            ) {
              setInspectionStatus(
                "inspecting"
              );
            }
          },
        }
      );

      setStatus(null);

      setSessionId(sessionId);

      setInspectionReport(report);

      // Refresh the dashboard's Recent Inspections list so the newly
      // created/completed inspection shows up without a manual reload.
      void queryClient.invalidateQueries({ queryKey: ["inspections"] });

      // Store file names in the shared store so the Difference List
      // window can display them without needing the File objects.
      setMasterFile(masterFile);
      setSampleFile(resolvedSampleFile);

      setInspectionStatus("completed");

      setSelectedDifference(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Inspection failed. Please try again.";

      setError(message);

      // Reflect the failure on the persistent inspection record (the
      // backend already marked it failed when the engine raised; this
      // also covers frontend-side failures like network drops).
      void queryClient.invalidateQueries({ queryKey: ["inspections"] });

      setInspectionStatus("failed");

      setStatus(null);

      console.error(
        "Inspection error:",
        error
      );
    } finally {
      // The Start action may be used again as soon as this run settles.
      isStartingRef.current = false;
    }
  }, [
    masterFile,
    sampleFile,
    inspectionType,
    differenceFilters,
    barcodeConfig,
    isBarcodeInspection,
    queryClient,
    setInspectionStatus,
    setInspectionReport,
    setSessionId,
    setError,
    setStatus,
    setMasterFile,
    setSampleFile,
  ]);
  /* ------------------------------------------------------------------ */
  /* IMPORTANT                                                          */
  /* ------------------------------------------------------------------ */
  /*
   * There is intentionally NO useEffect here that calls runInspection().
   *
   * The previous automatic inspection logic has been removed.
   *
   * Uploading the files only opens this workspace.
   *
   * Inspection starts only when the user clicks
   * the inspection action in the sidebar.
   */

  /* ------------------------------------------------------------------ */
  /* Files must exist before using masterFile/sampleFile                */
  /* ------------------------------------------------------------------ */

  if (!masterFile || (!sampleFile && (inspectionType ?? "text") !== "barcode")) {
    return null;
  }

  const effectiveSampleFile = sampleFile ?? masterFile;

  /*
   * Barcode Inspection works on a single source file (master === sample),
   * so it renders one full-width viewer instead of the side-by-side
   * comparison used by Text Inspection.
   */
  const isBarcode = inspectionType === "barcode";

  /* ------------------------------------------------------------------ */
  /* Build inspection result                                           */
  /* ------------------------------------------------------------------ */

  const buildInspectionResult =
    (): InspectionResult | null => {
      if (!inspectionReport) {
        return null;
      }

      /*
       * Client-side safety net — the backend already skips disabled
       * checkers, but this guarantees the results page NEVER shows a
       * finding type the user filtered out, even if the backend is
       * stale or returns an unexpected type.
       */
      const typeToFilterKey: Record<string, keyof typeof differenceFilters> = {
        Case: "case",
        Change: "change",
        Deletion: "deletion",
        Hyphen: "hyphen",
        Insertion: "insertion",
        Location: "location",
        Bold: "bold",
        Italic: "italic",
        Color: "color",
        "Font Type": "fontType",
        "Mixed Font": "mixedFont",
        Space: "space",
        Size: "size",
        Underline: "underline",
      };

      const filteredFindings = inspectionReport.findings.filter(
        (finding) => {
          const filterKey = typeToFilterKey[finding.type];
          if (!filterKey) {
            return true; // unknown types are never filtered
          }
          return differenceFilters[filterKey];
        }
      );

      const differences: InspectionDifference[] =
        filteredFindings.map(
          (finding) => ({
            id: finding.id,

            type: finding.type,

            master: finding.master,

            sample: finding.sample,

            level: null,

            comment: finding.comment,

            page: finding.page,

            masterBox:
              finding.master_box,

            sampleBox:
              finding.sample_box,

            barcodeType: finding.barcode_type ?? null,
            decodedValue: finding.decoded_value ?? null,
            grade: finding.grade ?? null,
          })
        );

      const pages = inspectionReport.pages ?? [];

      return {
        /*
         * Dynamic inspection session ID (e.g. "TXT-20260826153045").
         * Generated once per inspection run and stored in the shared
         * store, so it stays stable across re-renders and is reused
         * by the PDF report, share flow, and file names.
         */
        inspectionId:
          storeSessionId ??
          `report-${inspectionReport.dpi}`,

        inspectionType:
          (inspectionType as InspectionType) ?? "text",

        masterFileName:
          masterFile.name,

        sampleFileName:
          effectiveSampleFile.name,

        /*
         * Difference count comes from
         * the backend findings array.
         *
         * It can be 0, 1, 6, 20, 100, etc.
         */
        totalDifferences:
          differences.length,

        differences,

        pages,
      };
    };

  const inspectionResult =
    buildInspectionResult();

  /* ------------------------------------------------------------------ */
  /* Barcode result model (single file, no Master/Sample)              */
  /* ------------------------------------------------------------------ */

  /**
   * Maps the stored barcode findings onto the Barcode result page model.
   * Values (type, decoded value, grade, page, box) all come from the engine —
   * nothing is invented here.
   */
  /*
   * Barcode result model (single file, no Master/Sample).
   *
   * Plainly derived rather than memoised: the early return below means no
   * hook may be called from here, and the work is a couple of small maps
   * over the findings.
   *
   * Results from the background job are authoritative: the engine returned
   * them already deduplicated. The report-derived list is kept for the
   * legacy /api/inspect path. Unvalidated engine placeholders are dropped,
   * the survivors are ordered by document position (page, then Y, then X)
   * and ids are assigned 1, 2, 3 ... AFTER that ordering — so the table,
   * the count badge, the viewer overlays and the comments panel always
   * agree on both the count and the identity of each finding.
   */
  /*
   * `validated: false` marks the engine's provisional TBC placeholders —
   * regions flagged as barcode-shaped but never successfully decoded.
   * Those are not results: they must never become rows, never be counted
   * in the badge and never appear as comment cards.
   */
  const jobBarcodes = barcodeJob.barcodes
    .filter((barcode) => barcode.validated !== false)
    .map((barcode) => ({
      id: barcode.id,
      type: barcode.type,
      decodedValue: barcode.decodedValue,
      grade: barcode.grade,
      /* The page model is 0-based (see goToId / pageFilter). */
      page: Math.max(0, (barcode.page ?? 1) - 1),
      box: barcode.bbox ?? null,
      /* Page geometry in the bbox's own units, so the overlay can be mapped
         onto the rendered page without assuming a paper size. */
      pageWidth: barcode.pageWidth ?? null,
      pageHeight: barcode.pageHeight ?? null,
      coordinateSystem: barcode.coordinateSystem ?? null,
      quality: (barcode.qualityMetrics ?? null) as Record<string, string> | null,
      /* Heuristic verification block; null on results predating the verifier. */
      verification: barcode.verification ?? null,
    }));

  const reportBarcodes = (inspectionReport?.findings ?? [])
    .filter((finding) => finding.type === "Barcode")
    .map((finding, index) => ({
      // Prefer the engine-assigned id; fall back to document position.
      id: finding.id ?? index + 1,
      type: finding.barcode_type ?? finding.type,
      decodedValue: finding.decoded_value ?? finding.master,
      grade: finding.grade ?? null,
      page: Math.max(0, (finding.page ?? 1) - 1),
      box: finding.master_box ?? finding.sample_box ?? null,
      quality: null,
    }));

  const barcodeFindings =
    jobBarcodes.length > 0 ? jobBarcodes : reportBarcodes;

  /*
   * Document position order: page ascending, then Y ascending, then X
   * ascending — never decoder discovery order. Ids are (re)assigned 1, 2,
   * 3 ... after this sort, so the ID column reflects the reading order of
   * the document and stays consistent with the overlays and comment cards.
   */
  const barcodesInDocumentOrder = [...barcodeFindings].sort(
    (a, b) =>
      a.page - b.page ||
      (a.box?.y ?? 0) - (b.box?.y ?? 0) ||
      (a.box?.x ?? 0) - (b.box?.x ?? 0),
  );

  const barcodeResultModel: BarcodeResultPageModel = {
    inspectionId: storeSessionId ?? "barcode",
    fileName: masterFile.name,
    barcodes: barcodesInDocumentOrder.map((barcode, index) => ({
      ...barcode,
      id: index + 1,
    })),
  };

  /* ------------------------------------------------------------------ */
  /* Loading state                                                      */
  /* ------------------------------------------------------------------ */

  if (
    inspectionStatus === "uploading" ||
    inspectionStatus === "inspecting"
  ) {
    /*
     * Barcode Inspection opens its RESULT page immediately.
     *
     * The full-screen waiting screen is only used for the short window while
     * the file is stored and the background job is being created. As soon as
     * the job id exists the user is on the real result page, which polls the
     * running job and fills itself in when the engine finishes. The browser is
     * never parked on a spinner for the length of the inspection.
     */
    if (isBarcodeInspection) {
      if (inspectionStatus === "inspecting" && barcodeInspectionId) {
        return (
          <BarcodeInspectionResults
            result={barcodeResultModel}
            file={masterFile}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen((fullscreen) => !fullscreen)}
            jobStatus={barcodeJob.status ?? "processing"}
            stageLabel={BARCODE_STAGE_LABELS[barcodeJob.stage]}
            progress={{
              currentPage: barcodeJob.currentPage,
              totalPages: barcodeJob.totalPages,
            }}
            error={barcodeJob.error}
            onCancel={handleCancelBarcode}
            isCancelling={barcodeJob.isCancelling}
          />
        );
      }

      return (
        <BarcodeInspectionLoading
          stage={barcodeJob.stage}
          isCancelling={barcodeJob.isCancelling}
          onCancel={handleCancelBarcode}
        />
      );
    }

    return (
      <InspectionLoading
        inspectionType={inspectionType ?? "text"}
        status={status ?? "Uploading files..."}
        onCancel={() => {
          setInspectionStatus("idle");
          setStatus(null);
          navigate(`/workspace/${inspectionType ?? "text"}/upload`);
        }}
      />
    );
  }

  /* ------------------------------------------------------------------ */
  /* Failed state                                                       */
  /* ------------------------------------------------------------------ */

  if (
    inspectionStatus === "failed"
  ) {
    return (
      <InspectionLoading
        inspectionType={
          inspectionType ?? "text"
        }
        failed
        onCancel={() => {
          setInspectionStatus("idle");

          setStatus(null);

          navigate(
            `/workspace/${
              inspectionType ?? "text"
            }/upload`
          );
        }}
      />
    );
  }

  /* ------------------------------------------------------------------ */
  /* Completed inspection                                              */
  /* ------------------------------------------------------------------ */

  if (
    inspectionStatus === "completed" &&
    inspectionResult
  ) {
    /*
     * Barcode Inspection renders its OWN result page — never the generic
     * Master/Sample/Difference result.
     */
    if (isBarcodeInspection) {
      return (
        <BarcodeInspectionResults
          result={barcodeResultModel}
          file={masterFile}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen((fullscreen) => !fullscreen)}
        />
      );
    }

    return (
      <InspectionResults
        result={inspectionResult}
        masterFile={masterFile}
        sampleFile={effectiveSampleFile}
        onRefreshInspection={() => {
          void queryClient.invalidateQueries({ queryKey: ["inspections"] });
        }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen((fullscreen) => !fullscreen)}
        selectedDifference={
          selectedDifference
        }
        onDifferenceSelect={
          setSelectedDifference
        }
      />
    );
  }

  /* ------------------------------------------------------------------ */
  /* Default PDF workspace                                              */
  /* ------------------------------------------------------------------ */

  return (
    <Box
      sx={{
        height:
          "calc(100vh - 72px)",

        minHeight: 0,

        display: "flex",

        flexDirection: "column",

        bgcolor: "#f5f5f5",

        overflowX: "hidden",
      }}
    >
      {/* ================================================================ */}
      {/* Workspace Header                                                 */}
      {/* ================================================================ */}

      <Box
        sx={{
          width: "100%",

          px: isBarcode ? 1.5 : 3,

          py: isBarcode ? 0.75 : 2,

          bgcolor: "#ffffff",

          borderBottom:
            "1px solid #E5E7EB",
        }}
      >
        <Box
          sx={{
            display: "flex",

            alignItems: "center",

            gap: isBarcode ? 1 : 2,

            minWidth: 0,
          }}
        >
          {/* ------------------------------------------------------------ */}
          {/* Start Button                                                 */}
          {/* ------------------------------------------------------------ */}

          <Button
            size="small"
            variant={
              sidebarOpen
                ? "contained"
                : "outlined"
            }
            onClick={() =>
              setSidebarOpen(true)
            }
            sx={{
              textTransform: "none",

              minWidth: isBarcode ? 56 : undefined,

              height: isBarcode ? 32 : undefined,

              color: sidebarOpen
                ? "#fff"
                : "#2A276E",

              borderColor: "#2A276E",

              bgcolor: sidebarOpen
                ? "#2A276E"
                : "transparent",

              "&:hover": {
                bgcolor: "#2A276E",

                borderColor:
                  "#2A276E",

                color: "#fff",
              },
            }}
          >
            Start
          </Button>

          {/*
            Barcode Inspection: NO second start action here. The red
            "Start >>" button was removed — the only control that starts
            Barcode Inspection is the blue "Inspect" button inside the
            Barcode Inspection configuration panel.
          */}

          {isBarcode && (
            <Typography
              variant="body2"
              noWrap
              title={masterFile.name}
              sx={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "#30343b",
              }}
            >
              <Box component="span" sx={{ fontWeight: 700 }}>
                Filename:
              </Box>{" "}
              {truncateFileName(masterFile.name, 34)}
            </Typography>
          )}

          {/* ------------------------------------------------------------ */}
          {/* File Information                                             */}
          {/* ------------------------------------------------------------ */}

          {!isBarcode && <Box
            sx={{
              display: "grid",

              gridTemplateColumns:
                "1fr 1fr",

              gap: 2,

              flex: 1,

              minWidth: 0,
            }}
          >
            {/* Master */}

            <Box
              sx={{
                display: "flex",

                flexDirection:
                  "column",

                minWidth: 0,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,

                  color:
                    "text.secondary",
                }}
              >
                Master
              </Typography>

              <Typography
                variant="body2"
                noWrap
                title={masterFile.name}
                sx={{
                  maxWidth: 300,

                  overflow: "hidden",

                  textOverflow:
                    "ellipsis",

                  whiteSpace:
                    "nowrap",
                }}
              >
                {truncateFileName(masterFile.name)}
              </Typography>
            </Box>

            {/* Sample */}

            <Box
              sx={{
                display: "flex",

                flexDirection:
                  "column",

                minWidth: 0,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,

                  color:
                    "text.secondary",
                }}
              >
                Sample
              </Typography>

              <Typography
                variant="body2"
                noWrap
                title={effectiveSampleFile.name}
                sx={{
                  maxWidth: 300,

                  overflow: "hidden",

                  textOverflow:
                    "ellipsis",

                  whiteSpace:
                    "nowrap",
                }}
              >
                {truncateFileName(effectiveSampleFile.name)}
              </Typography>
            </Box>
          </Box>}
        </Box>
      </Box>

      {/* ================================================================ */}
      {/* Main Workspace                                                   */}
      {/* ================================================================ */}

      <Box
        sx={{
          flex: 1,

          display: "flex",

          bgcolor: "#f5f5f5",

          position: "relative",

          overflow: "hidden",

          width: "100%",
        }}
      >
        {/* ============================================================ */}
        {/* Inspection Sidebar                                            */}
        {/* ============================================================ */}

        {sidebarOpen && (
          <>
            {/*
              Transparent click-catcher covering the whole screen behind the
              panel. Clicking anywhere outside the panel closes it, for both
              Barcode and the other inspection types. The Barcode panel itself
              is fully opaque and sits above this backdrop.
            */}
            <Box
              data-testid="sidebar-backdrop"
              onClick={() =>
                setSidebarOpen(false)
              }
              sx={{
                position: "fixed",
                inset: 0,
                zIndex: 1199,
              }}
            />

            {/* Sidebar */}

            {isBarcode ? (
              <BarcodeInspectionSidebar
                pageCount={barcodePageCount}
                isInspecting={Boolean(status)}
                onClose={() => setSidebarOpen(false)}
                onInspect={runInspection}
              />
            ) : (
              <InspectionSidebar
                inspectionType={inspectionType ?? "text"}
                onClose={() => setSidebarOpen(false)}
                onInspect={runInspection}
              />
            )}
          </>
        )}

        {/* ============================================================ */}
        {/* PDF Viewers                                                   */}
        {/* ============================================================ */}

        <Box
          sx={{
            flex: 1,

            width: "100%",

            display: "flex",

            overflow: "hidden",
          }}
        >
          {/*
            Barcode Inspection analyses a SINGLE source file, so the
            master and sample are the same document. Rendering both
            panes would duplicate the viewer, so Barcode gets one
            full-width pane instead of the side-by-side comparison.
          */}
          {isBarcode ? (
            <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <ViewerPane
                title=""
                file={masterFile}
                inspectionType={inspectionType ?? "barcode"}
                side="master"
                hideHeader
                compactViewer
                selectedDifference={selectedDifference}
                onToggleSidebar={() => setSidebarOpen((open) => !open)}
                sidebarOpen={sidebarOpen}
                onNumPagesChange={setBarcodePageCount}
                onDocumentAction={() => setSidebarOpen(true)}
                onComments={() => setSidebarOpen(true)}
                onRefresh={() => {
                  /*
                    Refresh re-reads the persisted inspection record.
                    It deliberately does NOT re-run the engine.
                  */
                  void queryClient.invalidateQueries({
                    queryKey: ["inspections"],
                  });
                }}
                isFullscreen={isFullscreen}
                onToggleFullscreen={() =>
                  setIsFullscreen((fullscreen) => !fullscreen)
                }
              />
            </Box>
          ) : (
            <>
          {/* ---------------------------------------------------------- */}
          {/* Master PDF                                                  */}
          {/* ---------------------------------------------------------- */}

          <Box
            sx={{
              flex: 1,

              minWidth: 0,

              overflow: "hidden",
            }}
          >
            <ViewerPane
              title="Master Artwork"
              file={masterFile}
              inspectionType={
                inspectionType ??
                "text"
              }
              side="master"
              selectedDifference={
                selectedDifference
              }
            />
          </Box>

          {/* ---------------------------------------------------------- */}
          {/* Divider                                                     */}
          {/* ---------------------------------------------------------- */}

          <Divider
            orientation="vertical"
            flexItem
          />

          {/* ---------------------------------------------------------- */}
          {/* Sample PDF                                                  */}
          {/* ---------------------------------------------------------- */}

          <Box
            sx={{
              flex: 1,

              minWidth: 0,

              overflow: "hidden",
            }}
          >
            <ViewerPane
              title="Sample Artwork"
              file={effectiveSampleFile}
              inspectionType={
                inspectionType ??
                "text"
              }
              side="sample"
              selectedDifference={
                selectedDifference
              }
            />
          </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
