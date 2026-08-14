import { useEffect, useRef, useState } from "react";

import {
  Box,
  CircularProgress,
  Tooltip,
  Typography,
} from "@mui/material";

import {
  Document,
  Page,
  pdfjs,
} from "react-pdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import type { InspectionDifference } from "./InspectionResults";
import type { BoundingBox } from "@/shared/api/textInspectionApi";

pdfjs.GlobalWorkerOptions.workerSrc =
  "/pdf.worker.min.mjs";

type PdfViewerProps = {
  file: File;
  inspectionType: string;
  side: "master" | "sample";
  selectedDifference?: InspectionDifference | null;
  naturalWidth?: number;
  naturalHeight?: number;
  zeroBasedPageIndex?: boolean;
  pageNumber?: number;
  zoom?: number;
  onNumPagesChange?: (numPages: number) => void;
};

const getBoundingBox = (
  difference: InspectionDifference | null | undefined,
  side: "master" | "sample"
): BoundingBox | null => {
  if (!difference) {
    return null;
  }

  if (side === "master") {
    return difference.masterBox ?? null;
  }

  return difference.sampleBox ?? null;
};

export default function PdfViewer({
  file,
  side,
  selectedDifference,
  naturalWidth,
  naturalHeight,
  zeroBasedPageIndex = false,
  pageNumber: requestedPageNumberFromToolbar,
  zoom = 100,
  onNumPagesChange,
}: PdfViewerProps) {
  const containerRef =
    useRef<HTMLDivElement | null>(null);

  const pageWrapperRef =
    useRef<HTMLDivElement | null>(null);

  const highlightRef =
    useRef<HTMLDivElement | null>(null);

  const [numPages, setNumPages] =
    useState<number>(0);

  const [pageWidth, setPageWidth] =
    useState<number | null>(null);

  const [renderedPageWidth, setRenderedPageWidth] =
    useState<number | null>(null);

  const [renderedPageHeight, setRenderedPageHeight] =
    useState<number | null>(null);

  const [pdfError, setPdfError] =
    useState<string | null>(null);

  /*
   * ------------------------------------------------------------
   * Calculate available PDF width.
   * ------------------------------------------------------------
   */
  useEffect(() => {
    const updateWidth = () => {
      if (!containerRef.current) {
        return;
      }

      const availableWidth =
        containerRef.current.clientWidth - 48;

      if (availableWidth > 0) {
        setPageWidth(availableWidth);
      }
    };

    updateWidth();

    window.addEventListener(
      "resize",
      updateWidth
    );

    return () => {
      window.removeEventListener(
        "resize",
        updateWidth
      );
    };
  }, []);

  /*
   * ------------------------------------------------------------
   * Get the correct bounding box.
   *
   * Master PDF -> masterBox
   * Sample PDF -> sampleBox
   * ------------------------------------------------------------
   */
  const bbox = getBoundingBox(
    selectedDifference,
    side
  );

  const hasSelectedDifference =
    Boolean(selectedDifference);

  const showMissingCoordinatesNotice =
    hasSelectedDifference && !bbox;

  /*
   * ------------------------------------------------------------
   * Backend page number.
   * ------------------------------------------------------------
   */
  const requestedPageNumberFromDifference =
    selectedDifference &&
    (selectedDifference.page ||
      selectedDifference.page === 0)
      ? zeroBasedPageIndex
        ? selectedDifference.page + 1
        : selectedDifference.page
      : null;

  const requestedPageNumber =
    requestedPageNumberFromDifference !== null
      ? requestedPageNumberFromDifference
      : requestedPageNumberFromToolbar ?? 1;

  /*
   * ------------------------------------------------------------
   * Determine which PDF page should be displayed.
   * ------------------------------------------------------------
   */
  const pageNumber =
    numPages > 0 &&
    requestedPageNumber >= 1 &&
    requestedPageNumber <= numPages
      ? requestedPageNumber
      : 1;

  useEffect(() => {
    onNumPagesChange?.(numPages || 1);
  }, [numPages, onNumPagesChange]);

  /*
   * ------------------------------------------------------------
   * Scale backend coordinates to displayed PDF.
   * ------------------------------------------------------------
   */
  const scaleX =
    bbox &&
    naturalWidth &&
    renderedPageWidth
      ? renderedPageWidth / naturalWidth
      : 1;

  const scaleY =
    bbox &&
    naturalHeight &&
    renderedPageHeight
      ? renderedPageHeight / naturalHeight
      : 1;

  /*
   * ------------------------------------------------------------
   * Highlight position.
   * ------------------------------------------------------------
   */
  const highlightLeft =
    bbox
      ? bbox.x * scaleX
      : 0;

  const highlightTop =
    bbox
      ? bbox.y * scaleY
      : 0;

  const highlightWidth =
    bbox
      ? bbox.width * scaleX
      : 0;

  const highlightHeight =
    bbox
      ? bbox.height * scaleY
      : 0;

  /*
   * ------------------------------------------------------------
   * Automatically scroll to the selected difference.
   *
   * This happens whenever the user clicks another row.
   * ------------------------------------------------------------
   */
  useEffect(() => {
    if (
      !selectedDifference ||
      !bbox ||
      !highlightRef.current ||
      !containerRef.current
    ) {
      return;
    }

    /*
     * Wait for layout settle, then center the actual target box
     * inside the scroll container on both axes.
     */
    const timeout = window.setTimeout(() => {
      const highlight =
        highlightRef.current;

      if (!highlight) {
        return;
      }

      highlight.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }, 200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    selectedDifference,
    bbox,
    pageNumber,
    renderedPageWidth,
    renderedPageHeight,
  ]);

  useEffect(() => {
    if (
      !selectedDifference ||
      bbox ||
      !containerRef.current
    ) {
      return;
    }

    containerRef.current.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }, [
    selectedDifference,
    bbox,
    pageNumber,
  ]);

  return (
    <Box
      ref={containerRef}
      sx={{
        height: "100%",
        width: "100%",
        overflow: "auto",

        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",

        position: "relative",

        p: 3,

        bgcolor: "#FFFFFF",
      }}
    >
      <Document
        key={`${file.name}-${file.lastModified}-${file.size}`}
        file={file}
        loading={
          <Box
            sx={{
              mt: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <CircularProgress />

            <Typography>
              Loading PDF...
            </Typography>
          </Box>
        }
        error={
          <Box
            sx={{
              mt: 6,
              textAlign: "center",
              px: 3,
            }}
          >
            <Typography
              color="error"
              sx={{
                fontWeight: 700,
              }}
            >
              Failed to load PDF.
            </Typography>

            <Typography
              color="text.secondary"
              sx={{
                mt: 1,
              }}
            >
              {pdfError ??
                "The document could not be loaded."}
            </Typography>
          </Box>
        }
        onLoadSuccess={({ numPages }) => {
          setNumPages(numPages);
          setPdfError(null);
        }}
        onLoadError={(error) => {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          setPdfError(message);

          console.error(
            `${side} PDF loading error:`,
            error
          );
        }}
      >
        <Box
          ref={pageWrapperRef}
          sx={{
            position: "relative",
            display: "inline-block",
            lineHeight: 0,
            bgcolor: "#FFFFFF",
            boxShadow:
              "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          <Page
            key={`page-${pageNumber}`}
            pageNumber={pageNumber}
            width={
              pageWidth
                ? (pageWidth * zoom) / 100
                : undefined
            }
            renderAnnotationLayer
            renderTextLayer
            onRenderSuccess={(page) => {
              setRenderedPageWidth(
                page.width
              );

              setRenderedPageHeight(
                page.height
              );
            }}
          />

          {/* =====================================================
              SELECTED DIFFERENCE HIGHLIGHT
             ===================================================== */}

          {bbox && (
            <Tooltip
              title={
                <Box>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: "#2A276E",
                      display: "block",
                    }}
                  >
                    Difference #{selectedDifference?.id}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      color: "#3f4650",
                      mb: 0.5,
                    }}
                  >
                    {selectedDifference?.comment ||
                      selectedDifference?.type ||
                      "No reason available"}
                  </Typography>

                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      color: "#50575e",
                      fontWeight: 600,
                    }}
                  >
                    Original:{" "}
                    <Box
                      component="span"
                      sx={{ fontWeight: 400 }}
                    >
                      {selectedDifference?.master || "—"}
                    </Box>
                  </Typography>

                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      color: "#50575e",
                      fontWeight: 600,
                    }}
                  >
                    Sample:{" "}
                    <Box
                      component="span"
                      sx={{ fontWeight: 400 }}
                    >
                      {selectedDifference?.sample || "—"}
                    </Box>
                  </Typography>
                </Box>
              }
              arrow
              placement="top"
              slotProps={{
                tooltip: {
                  sx: {
                    bgcolor: "#FFFFFF",
                    color: "#3f4650",
                    border: "1px solid #d5d9dd",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  },
                },
                arrow: {
                  sx: {
                    color: "#FFFFFF",
                  },
                },
              }}
            >
              <Box
                ref={highlightRef}
                sx={{
                  position: "absolute",

                  left:
                    `${highlightLeft}px`,

                  top:
                    `${highlightTop}px`,

                  width:
                    `${highlightWidth}px`,

                  height:
                    `${highlightHeight}px`,

                  /*
                   * Thin outline.
                   */
                  border:
                    "1.5px solid #c63737",

                  /*
                   * Very light background.
                   */
                  backgroundColor:
                    "rgba(246, 246, 247, 0.06)",

                  /*
                   * Small outer glow so it remains
                   * visible without being too thick.
                   */
                  boxShadow:
                    "0 0 0 1px rgba(255,255,255,0.8)",

                  borderRadius: "2px",

                  pointerEvents: "auto",

                  cursor: "pointer",

                  zIndex: 20,

                  boxSizing:
                    "border-box",

                  transition:
                    "left 0.2s ease, top 0.2s ease",
                }}
              />
            </Tooltip>
          )}
        </Box>
      </Document>

      {/* =========================================================
          PAGE INDICATOR
         ========================================================= */}

      {numPages > 0 && (
        <Box
          sx={{
            position: "absolute",

            right: 20,
            bottom: 20,

            px: 2,
            py: 0.75,

            bgcolor: "#FFFFFF",

            borderRadius: 1,

            boxShadow: 2,

            zIndex: 30,
          }}
        >
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
            }}
          >
            Page {pageNumber} / {numPages}
          </Typography>
        </Box>
      )}

      {showMissingCoordinatesNotice && (
        <Box
          sx={{
            position: "absolute",
            left: 20,
            top: 20,
            px: 1.5,
            py: 0.75,
            bgcolor:
              "rgba(255,255,255,0.95)",
            border:
              "1px solid #e1b200",
            borderRadius: 1,
            boxShadow: 1,
            zIndex: 30,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "#8a6d00",
              fontWeight: 600,
            }}
          >
            No coordinates available for this {side} difference.
          </Typography>
        </Box>
      )}
    </Box>
  );
}