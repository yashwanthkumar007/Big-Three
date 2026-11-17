
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
import type { BrailleInspectionOptions } from "@/shared/config/brailleInspectionConfig";

import { useQueryClient } from "@tanstack/react-query";

import { useLoadingStatus } from "@/shared/hooks/useInspectionLoading";

export default function WorkspacePage() {
  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const { inspectionType, inspectionId: urlInspectionId } = useParams();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [isFullscreen, setIsFullscreen] = useState(false);

  const [
    selectedDifference,
    setSelectedDifference,
  ] = useState<InspectionDifference | null>(null);

  const {
    masterFile,
    sampleFile,
    inspectionStatus,
    inspectionReport,
    error: inspectionError,
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
   * Barcode Inspection opens the document viewer first.
   * The user starts the inspection explicitly from the sidebar.
   */
  const [barcodePageCount, setBarcodePageCount] = useState(1);

  /*
   * The barcode job ID is tracked separately from the generic
   * inspection session ID.
   */
  const [barcodeInspectionId, setBarcodeInspectionId] = useState<string | null>(
    urlInspectionId ?? null,
  );

  /*
   * Prevent duplicate inspection jobs from repeated clicks.
   */
  const isStartingRef = useRef(false);

  const isBarcodeInspection = inspectionType === "barcode";

  const barcodeJob = useBarcodeJobStatus(
    isBarcodeInspection ? barcodeInspectionId : null,
  );

  /**
   * Cancels the running barcode job and returns to the document viewer.
   * The uploaded document and persisted inspection record are preserved.
   */
  const handleCancelBarcode = useCallback(async () => {
    await barcodeJob.cancel();

    setInspectionStatus("idle");
    setStatus(null);
    setBarcodeInspectionId(null);
    setSessionId(null);
  }, [barcodeJob, setInspectionStatus, setStatus, setSessionId]);

  /* ------------------------------------------------------------------ */
  /* Navigate to the generic result page for non-barcode inspections    */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    /*
     * Barcode results are displayed directly in WorkspacePage.
     * Do not redirect Barcode to the generic inspection-result page.
     */
    if (isBarcodeInspection) {
      return;
    }

    const expectedId = storeSessionId;
    const isFinished = inspectionStatus === "completed";

    if (!expectedId || !isFinished) {
      return;
    }

    const expected = `/inspection-result/${expectedId}`;

    if (window.location.pathname === expected) {
      return;
    }

    void navigate(expected, { replace: true });
  }, [
    isBarcodeInspection,
    storeSessionId,
    inspectionStatus,
    navigate,
  ]);

  /* ------------------------------------------------------------------ */
  /* Redirect to upload page if files are missing                       */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    /*
     * When reopening an existing inspection through its URL, the Zustand
     * store may be empty. Keep the page open when an ID is present.
     */
    if (urlInspectionId) {
      return;
    }

    if (
      !masterFile ||
      (!sampleFile && (inspectionType ?? "text") !== "barcode")
    ) {
      navigate(`/workspace/${inspectionType ?? "text"}/upload`);
    }
  }, [
    masterFile,
    sampleFile,
    inspectionType,
    navigate,
    urlInspectionId,
  ]);

  /* ------------------------------------------------------------------ */
  /* Run inspection                                                     */
  /* ------------------------------------------------------------------ */

  const runInspection = useCallback(async (
    brailleSettings?: BrailleInspectionOptions,
  ) => {
    /*
     * Only allow one inspection start request at a time.
     */
    if (isStartingRef.current) {
      return;
    }

    if (
      !masterFile ||
      (!sampleFile && (inspectionType ?? "text") !== "barcode")
    ) {
      return;
    }

    const resolvedSampleFile =
      inspectionType === "barcode"
        ? masterFile
        : sampleFile ?? masterFile;

    /*
     * Barcode and Braille use a single source document.
     * Do not persist a sample file for either workflow.
     */
    const inspectionSampleFile =
      inspectionType === "braille" || inspectionType === "barcode"
        ? null
        : resolvedSampleFile;

    isStartingRef.current = true;

    try {
      setInspectionStatus("uploading");
      setStatus("Uploading files...");

      /*
       * Persist the uploaded document and create its inspection record.
       */
      let inspectionId: string | undefined;

      try {
        const inspection = await createInspection(
          masterFile,
          inspectionSampleFile,
          inspectionType ?? "text",
        );

        inspectionId = inspection.inspectionId;
      } catch (persistError) {
        console.warn(
          "[WORKSPACE] Persistent inspection unavailable, running ephemeral:",
          persistError,
        );
      }

      /*
       * Barcode uses a background job.
       * The job is created from the persisted inspection ID, and its
       * status/results are retrieved by useBarcodeJobStatus.
       */
      if (isBarcodeInspection) {
        if (!inspectionId) {
          throw new Error(
            "The document could not be stored, so the inspection could not start. Please try again.",
          );
        }

        const job = await createBarcodeInspection(
          inspectionId,
          barcodeConfig,
        );

        /*
         * Keep the returned job identifier for polling.
         */
        setBarcodeInspectionId(job.inspectionId);

        setSessionId(null);
        setStatus(null);
        setInspectionStatus("inspecting");

        void queryClient.invalidateQueries({
          queryKey: ["inspections"],
        });

        return;
      }

      /*
       * Non-barcode inspections continue using the generic inspection API.
       */
      const {
        sessionId,
        report,
      } = await startInspection(
        masterFile,
        inspectionSampleFile,
        {
          inspectionType: inspectionType as InspectionType,
          differenceFilters,
          barcodeConfig: undefined,
          brailleConfig:
            inspectionType === "braille" && brailleSettings
              ? { language: brailleSettings.language }
              : undefined,
          inspectionId,
          onStatus: ({ status: currentStatus }) => {
            setStatus(currentStatus);

            if (
              currentStatus.includes("Comparing") ||
              currentStatus.includes("Preparing")
            ) {
              setInspectionStatus("inspecting");
            }
          },
        },
      );

      setStatus(null);

      setSessionId(sessionId);

      setInspectionReport(report);

      void queryClient.invalidateQueries({
        queryKey: ["inspections"],
      });

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

      void queryClient.invalidateQueries({
        queryKey: ["inspections"],
      });

      setInspectionStatus("failed");
      setStatus(null);

      console.error("Inspection error:", error);
    } finally {
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
  /* Files must exist before using masterFile/sampleFile                */
  /* ------------------------------------------------------------------ */

  if (
    !masterFile ||
    (!sampleFile && (inspectionType ?? "text") !== "barcode")
  ) {
    return null;
  }

  const effectiveSampleFile = sampleFile ?? masterFile;

  /*
   * Barcode and Braille inspect one source document.
   */
  const isBarcode = inspectionType === "barcode";
  const isBraille = inspectionType === "braille";
  const isSingleFile = isBarcode || isBraille;

  /* ------------------------------------------------------------------ */
  /* Build generic inspection result                                    */
  /* ------------------------------------------------------------------ */

  const buildInspectionResult = (): InspectionResult | null => {
    if (!inspectionReport) {
      return null;
    }

    const typeToFilterKey: Record<
      string,
      keyof typeof differenceFilters
    > = {
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
          return true;
        }

        return differenceFilters[filterKey];
      },
    );

    const differences: InspectionDifference[] = filteredFindings.map(
      (finding) => ({
        id: finding.id,
        type: finding.type,
        master: finding.master,
        sample: finding.sample,
        level: null,
        comment: finding.comment,
        status: finding.status,
        page: finding.page,
        masterBox: finding.master_box,
        sampleBox: finding.sample_box,
        barcodeType: finding.barcode_type ?? null,
        decodedValue: finding.decoded_value ?? null,
        grade: finding.grade ?? null,
        brailleMetrics: finding.braille_metrics
          ? {
              lines: finding.braille_metrics.lines,
              characters: finding.braille_metrics.characters,
              dots: finding.braille_metrics.dots,
              dotHMillimeters: finding.braille_metrics.dot_h_mm,
              dotVMillimeters: finding.braille_metrics.dot_v_mm,
              characterMillimeters:
                finding.braille_metrics.character_mm,
              wordMillimeters: finding.braille_metrics.word_mm,
              lineMillimeters: finding.braille_metrics.line_mm,
            }
          : null,
      }),
    );

    const pages = (inspectionReport.pages ?? []).map((page) => ({
      page: page.page,
      masterWidth: page.master_width,
      masterHeight: page.master_height,
      sampleWidth: page.sample_width,
      sampleHeight: page.sample_height,
      sampleImage: page.sample_image,
    }));

    return {
      inspectionId:
        storeSessionId ?? `report-${inspectionReport.dpi}`,
      inspectionType: (inspectionType as InspectionType) ?? "text",
      masterFileName: masterFile.name,
      sampleFileName: effectiveSampleFile.name,
      totalDifferences: differences.length,
      differences,
      pages,
      brailleLanguage: inspectionReport.metadata?.language,
      inspectionStatus: "Completed",
    };
  };

  const inspectionResult = buildInspectionResult();

  /* ------------------------------------------------------------------ */
  /* Build Barcode result model                                         */
  /* ------------------------------------------------------------------ */

  /*
   * The background job returns barcode results using its own data model.
   * Convert the engine's results to the shape expected by the result page.
   */
  const jobBarcodes = barcodeJob.barcodes
    .map((barcode) => ({
      id: barcode.id,
      type: barcode.type,
      decodedValue: barcode.decodedValue,
      grade: barcode.grade,
      page: Math.max(0, (barcode.page ?? 1) - 1),
      box: barcode.bbox ?? null,
      pageWidth: barcode.pageWidth ?? null,
      pageHeight: barcode.pageHeight ?? null,
      coordinateSystem: barcode.coordinateSystem ?? null,
      quality: barcode.qualityMetrics
        ? Object.fromEntries(
            Object.entries(barcode.qualityMetrics).map(([key, value]) => [
              key,
              String(value),
            ]),
          )
        : null,
      verification: barcode.verification ?? null,
    }));

  /*
   * Compatibility mapping for barcode results returned through the
   * generic inspection report.
   */
  const reportBarcodes = (inspectionReport?.findings ?? [])
    .filter((finding) => finding.type === "Barcode")
    .map((finding, index) => ({
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
   * Sort findings by document position, then assign stable display IDs.
   */
  const barcodesInDocumentOrder = [...barcodeFindings].sort(
    (a, b) =>
      a.page - b.page ||
      (a.box?.y ?? 0) - (b.box?.y ?? 0) ||
      (a.box?.x ?? 0) - (b.box?.x ?? 0),
  );

  const barcodeResultModel: BarcodeResultPageModel = {
    /*
     * Barcode has its own job identifier. Do not rely on storeSessionId,
     * because the background-job branch deliberately clears that value.
     */
    inspectionId:
      barcodeInspectionId ?? storeSessionId ?? "barcode",
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
    if (isBarcodeInspection) {
      const barcodeJobFinished =
        barcodeJob.status === "completed" ||
        barcodeJob.status === "failed" ||
        barcodeJob.status === "cancelled";

      if (!barcodeJobFinished) {
        return (
          <BarcodeInspectionLoading
            stage={
              inspectionStatus === "uploading"
                ? null
                : barcodeJob.stage
            }
            progress={
              barcodeJob.totalPages > 0
                ? {
                    currentPage: barcodeJob.currentPage,
                    totalPages: barcodeJob.totalPages,
                  }
                : null
            }
            onCancel={handleCancelBarcode}
            isCancelling={barcodeJob.isCancelling}
          />
        );
      }

      /*
       * Once the background job reaches a terminal state, render the
       * Barcode result page even though the generic report is null.
       */
      return (
        <BarcodeInspectionResults
          result={barcodeResultModel}
          file={masterFile}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() =>
            setIsFullscreen((fullscreen) => !fullscreen)
          }
          jobStatus={barcodeJob.status ?? "queued"}
          stageLabel={
            BARCODE_STAGE_LABELS[barcodeJob.stage] ??
            barcodeJob.stage
          }
          progress={
            barcodeJob.totalPages > 0
              ? {
                  currentPage: barcodeJob.currentPage,
                  totalPages: barcodeJob.totalPages,
                }
              : null
          }
          error={barcodeJob.error ?? inspectionError}
          onCancel={handleCancelBarcode}
          isCancelling={barcodeJob.isCancelling}
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

  if (inspectionStatus === "failed") {
    if (isBarcodeInspection) {
      return (
        <BarcodeInspectionResults
          result={barcodeResultModel}
          file={masterFile}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() =>
            setIsFullscreen((fullscreen) => !fullscreen)
          }
          jobStatus="failed"
          error={
            barcodeJob.error ??
            inspectionError ??
            "Barcode inspection failed. Please try again."
          }
        />
      );
    }

    return (
      <InspectionLoading
        inspectionType={inspectionType ?? "text"}
        failed
        error={inspectionError}
        onCancel={() => {
          setInspectionStatus("idle");
          setStatus(null);
          navigate(`/workspace/${inspectionType ?? "text"}/upload`);
        }}
      />
    );
  }

  /* ------------------------------------------------------------------ */
  /* Completed inspection                                               */
  /* ------------------------------------------------------------------ */

  if (inspectionStatus === "completed" && inspectionResult) {
    /*
     * Barcode results are rendered separately from generic comparison
     * results, because Barcode uses one document rather than two.
     */
    if (isBarcodeInspection) {
      return (
        <BarcodeInspectionResults
          result={barcodeResultModel}
          file={masterFile}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() =>
            setIsFullscreen((fullscreen) => !fullscreen)
          }
        />
      );
    }

    return (
      <InspectionResults
        result={inspectionResult}
        masterFile={masterFile}
        sampleFile={effectiveSampleFile}
        onRefreshInspection={() => {
          void queryClient.invalidateQueries({
            queryKey: ["inspections"],
          });
        }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() =>
          setIsFullscreen((fullscreen) => !fullscreen)
        }
        selectedDifference={selectedDifference}
        onDifferenceSelect={setSelectedDifference}
      />
    );
  }

  /* ------------------------------------------------------------------ */
  /* Default PDF workspace                                               */
  /* ------------------------------------------------------------------ */

  return (
    <Box
      sx={{
        height: "calc(100vh - 72px)",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        bgcolor: "#f5f5f5",
        overflowX: "hidden",
      }}
    >
      {/* Workspace Header */}

      <Box
        sx={{
          width: "100%",
          px: isSingleFile ? 1.5 : 3,
          py: isSingleFile ? 0.75 : 2,
          bgcolor: "#ffffff",
          borderBottom: "1px solid #E5E7EB",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: isSingleFile ? 1 : 2,
            minWidth: 0,
          }}
        >
          <Button
            size="small"
            variant={sidebarOpen ? "contained" : "outlined"}
            onClick={() => setSidebarOpen(true)}
            sx={{
              textTransform: "none",
              minWidth: isSingleFile ? 56 : undefined,
              height: isSingleFile ? 32 : undefined,
              color: sidebarOpen ? "#fff" : "#2A276E",
              borderColor: "#2A276E",
              bgcolor: sidebarOpen ? "#2A276E" : "transparent",
              "&:hover": {
                bgcolor: "#2A276E",
                borderColor: "#2A276E",
                color: "#fff",
              },
            }}
          >
            Start
          </Button>

          {isSingleFile && (
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

          {!isSingleFile && (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 2,
                flex: 1,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    color: "text.secondary",
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
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {truncateFileName(masterFile.name)}
                </Typography>
              </Box>

              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    color: "text.secondary",
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
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {truncateFileName(effectiveSampleFile.name)}
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* Main Workspace */}

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
        {/* Inspection Sidebar */}

        {sidebarOpen && (
          <>
            <Box
              data-testid="sidebar-backdrop"
              onClick={() => setSidebarOpen(false)}
              sx={{
                position: "fixed",
                inset: 0,
                zIndex: 1199,
              }}
            />

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
                isInspecting={Boolean(status)}
              />
            )}
          </>
        )}

        {/* PDF Viewers */}

        <Box
          sx={{
            flex: 1,
            width: "100%",
            display: "flex",
            overflow: "hidden",
          }}
        >
          {isSingleFile ? (
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              <ViewerPane
                title=""
                file={masterFile}
                inspectionType={inspectionType ?? "barcode"}
                side="master"
                hideHeader
                compactViewer
                selectedDifference={selectedDifference}
                onToggleSidebar={() =>
                  setSidebarOpen((open) => !open)
                }
                sidebarOpen={sidebarOpen}
                onNumPagesChange={setBarcodePageCount}
                onDocumentAction={() => setSidebarOpen(true)}
                onComments={() => setSidebarOpen(true)}
                onRefresh={() => {
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
                  inspectionType={inspectionType ?? "text"}
                  side="master"
                  selectedDifference={selectedDifference}
                />
              </Box>

              <Divider orientation="vertical" flexItem />

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
                  inspectionType={inspectionType ?? "text"}
                  side="sample"
                  selectedDifference={selectedDifference}
                />
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
