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
  useState,
} from "react";

import ViewerPane from "./components/ViewerPane";

import InspectionSidebar from "./components/InspectionSidebar";

import InspectionLoading from "./components/InspectionLoading";

import InspectionResults, {
  type InspectionResult,
  type InspectionDifference,
} from "./components/InspectionResults";

import { useUploadStore, type InspectionType } from "@/store/uploadStore";
import { truncateFileName } from "@/shared/utils/truncateFileName";

import { startInspection, createInspection } from "@/shared/api/inspectionApi";

import { useQueryClient } from "@tanstack/react-query";

import { useLoadingStatus } from "@/shared/hooks/useInspectionLoading";

export default function WorkspacePage() {
  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const { inspectionType } = useParams();

  const [sidebarOpen, setSidebarOpen] =
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

  /* ------------------------------------------------------------------ */
  /* Redirect to upload page if files are missing                       */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!masterFile || !sampleFile) {
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
     * The inspection type comes from the URL parameter and is passed
     * through to the backend via `inspection_type`, which dispatches
     * to the correct pipeline.  Any registered inspection type
     * (text, graphics, spelling, …) is supported here.
     */
    if (
      !masterFile ||
      !sampleFile
    ) {
      return;
    }

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
          sampleFile,
          inspectionType ?? "text"
        );
        inspectionId = inspection.inspectionId;
      } catch (persistError) {
        console.warn(
          "[WORKSPACE] Persistent inspection unavailable, running ephemeral:",
          persistError
        );
      }

      const {
        sessionId,
        report,
      } = await startInspection(
        masterFile,
        sampleFile,
        {
          /* Dynamic session ID prefix follows the inspection type
           * (text -> TXT-, graphics -> GRP-, etc.). */
          inspectionType: inspectionType as InspectionType,
          differenceFilters,
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
      setSampleFile(sampleFile);

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
    }
  }, [
    masterFile,
    sampleFile,
    inspectionType,
    differenceFilters,
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

  if (!masterFile || !sampleFile) {
    return null;
  }

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
        Color: "color",
        "Font Type": "fontType",
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
          })
        );

      const pages =
        inspectionReport.pages.map(
          (page) => ({
            page: page.page,

            masterWidth:
              page.master_width,

            masterHeight:
              page.master_height,

            sampleWidth:
              page.sample_width,

            sampleHeight:
              page.sample_height,

            sampleImage:
              page.sample_image,
          })
        );

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
          sampleFile.name,

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
  /* Loading state                                                      */
  /* ------------------------------------------------------------------ */

  if (
    inspectionStatus === "uploading" ||
    inspectionStatus === "inspecting"
  ) {
    return (
      <InspectionLoading
        inspectionType={
          inspectionType ?? "text"
        }
        status={
          status ??
          "Uploading files..."
        }
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
    return (
      <InspectionResults
        result={inspectionResult}
        masterFile={masterFile}
        sampleFile={sampleFile}
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
        minHeight:
          "calc(100vh - 72px)",

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

          px: 3,

          py: 2,

          bgcolor: "#ffffff",

          borderBottom:
            "1px solid #E5E7EB",
        }}
      >
        <Box
          sx={{
            display: "flex",

            alignItems: "center",

            gap: 2,

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

          {/* ------------------------------------------------------------ */}
          {/* File Information                                             */}
          {/* ------------------------------------------------------------ */}

          <Box
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
                title={sampleFile.name}
                sx={{
                  maxWidth: 300,

                  overflow: "hidden",

                  textOverflow:
                    "ellipsis",

                  whiteSpace:
                    "nowrap",
                }}
              >
                {truncateFileName(sampleFile.name)}
              </Typography>
            </Box>
          </Box>
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
            {/* Overlay */}

            <Box
              onClick={() =>
                setSidebarOpen(false)
              }
              sx={{
                position: "fixed",

                inset: 0,

                background:
                  "rgba(0,0,0,0.18)",

                zIndex: 1199,
              }}
            />

            {/* Sidebar */}

            <InspectionSidebar
              inspectionType={
                inspectionType ??
                "text"
              }
              onClose={() =>
                setSidebarOpen(false)
              }
              onInspect={
                runInspection
              }
            />
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
              file={sampleFile}
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
        </Box>
      </Box>
    </Box>
  );
}
