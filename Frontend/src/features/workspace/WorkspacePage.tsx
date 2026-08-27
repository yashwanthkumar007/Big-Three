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

import { startTextInspection } from "@/shared/api/textInspectionApi";

import { useLoadingStatus } from "@/shared/hooks/useInspectionLoading";

export default function WorkspacePage() {
  const navigate = useNavigate();

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
     * Only Text Inspection is currently connected
     * to the Python backend.
     */
    if (
      !masterFile ||
      !sampleFile ||
      inspectionType !== "text"
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

      const {
        sessionId,
        report,
      } = await startTextInspection(
        masterFile,
        sampleFile,
        {
          /* Dynamic session ID prefix follows the inspection type
           * (text -> TXT-, graphics -> GRP-, etc.). */
          inspectionType: inspectionType as InspectionType,
          differenceFilters,
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
          : "Text inspection failed. Please try again.";

      setError(message);

      setInspectionStatus("failed");

      setStatus(null);

      console.error(
        "Text inspection error:",
        error
      );
    }
  }, [
    masterFile,
    sampleFile,
    inspectionType,
    differenceFilters,
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
          (
            inspectionType as
              InspectionResult[
                "inspectionType"
              ]
          ) ?? "text",

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