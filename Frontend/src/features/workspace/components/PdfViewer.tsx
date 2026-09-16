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
import type { BoundingBox } from "@/shared/api/inspectionApi";

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
  /**
   * Crop Compare mode — when true (master side only), the user can drag
   * a rectangle directly on the rendered page. On mouse-up the box is
   * converted to DPI-150 pixel space (the same space the backend's
   * finding boxes use) and reported via onCropComplete together with
   * the 0-based page number it was drawn on.
   */
  cropMode?: boolean;
  onCropComplete?: (page0Based: number, box: BoundingBox) => void;
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
  cropMode,
  onCropComplete,
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

  /*
   * ------------------------------------------------------------
   * Crop Compare drag state. cropRect is tracked in rendered-page
   * pixels (relative to the page wrapper); on mouse-up it is
   * converted into the DPI-150 pixel space the backend uses.
   * Declared AFTER `pageNumber` (used in the mouse-up handler) and
   * intentionally effect-free: the selection rectangle is only
   * RENDERED while crop mode is active, so no cleanup effect is
   * needed and no setState-in-effect cascades occur.
   * ------------------------------------------------------------
   */
  const [cropRect, setCropRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const cropDragRef = useRef<{
    startX: number;
    startY: number;
  } | null>(null);

  const cropEnabled = Boolean(cropMode) && side === "master";

  const handleCropMouseDown = (event: React.MouseEvent) => {
    if (!cropEnabled || !pageWrapperRef.current) {
      return;
    }
    event.preventDefault();
    const bounds = pageWrapperRef.current.getBoundingClientRect();
    cropDragRef.current = {
      startX: event.clientX - bounds.left,
      startY: event.clientY - bounds.top,
    };
    setCropRect({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      width: 0,
      height: 0,
    });
  };

  useEffect(() => {
    if (!cropEnabled) {
      return;
    }

    const handleMove = (event: MouseEvent) => {
      const drag = cropDragRef.current;
      if (!drag || !pageWrapperRef.current) {
        return;
      }
      const bounds = pageWrapperRef.current.getBoundingClientRect();
      const currentX = event.clientX - bounds.left;
      const currentY = event.clientY - bounds.top;
      setCropRect({
        x: Math.min(drag.startX, currentX),
        y: Math.min(drag.startY, currentY),
        width: Math.abs(currentX - drag.startX),
        height: Math.abs(currentY - drag.startY),
      });
    };

    const handleUp = () => {
      const drag = cropDragRef.current;
      cropDragRef.current = null;
      if (!drag || !cropRect || !onCropComplete) {
        return;
      }
      // Ignore accidental clicks / micro-drags.
      if (cropRect.width < 4 || cropRect.height < 4) {
        return;
      }

      /*
       * Convert rendered-page pixels to the DPI-150 pixel space the
       * backend finding boxes use. Preferred: the natural DPI-150
       * width from the report; fallback: derive it from the zoom.
       */
      const renderedWidth = renderedPageWidth ?? pageWidth ?? 0;
      if (renderedWidth <= 0) {
        return;
      }
      const factor = naturalWidth
        ? naturalWidth / renderedWidth
        : 150 / 72 / (zoom / 100);

      onCropComplete(pageNumber - 1, {
        x: cropRect.x * factor,
        y: cropRect.y * factor,
        width: cropRect.width * factor,
        height: cropRect.height * factor,
      });
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [
    cropEnabled,
    cropRect,
    pageNumber,
    zoom,
    naturalWidth,
    pageWidth,
    renderedPageWidth,
    onCropComplete,
  ]);

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
        /*
         * flex-start (not center) is deliberate: with justify-content:
         * center, when the zoomed page is wider than the container the
         * overflow is split symmetrically and the LEFT side becomes
         * unreachable by scroll — so scrollIntoView can't center a
         * difference near the left edge (the box draws and hovers, but
         * the view never scrolls to it). The page is instead centered
         * horizontally inside a wrapper (see below) that is always at
         * least as wide as the container, which keeps low-zoom centering
         * while making left overflow reachable at high zoom.
         */
        justifyContent: "flex-start",
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
        {/* Centering wrapper — see the justify-content comment on the scroll
            container above. It is at least as wide as the container (so the
            page still centers at low zoom) but grows to fit the page at high
            zoom, keeping the left edge reachable by scrollIntoView. */}
        <Box
          sx={{
            minWidth: "100%",
            width: "max-content",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
          }}
        >
        <Box
          ref={pageWrapperRef}
          onMouseDown={handleCropMouseDown}
          sx={{
            position: "relative",
            display: "inline-block",
            lineHeight: 0,
            bgcolor: "#FFFFFF",
            boxShadow:
              "0 2px 8px rgba(0,0,0,0.15)",
            cursor: cropEnabled ? "crosshair" : "default",
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
              CROP COMPARE SELECTION RECTANGLE
              Dashed outline stays visible after mouse-up so the
              user can see exactly which region was inspected.
             ===================================================== */}

          {cropEnabled && cropRect && (
            <Box
              sx={{
                position: "absolute",
                left: cropRect.x,
                top: cropRect.y,
                width: cropRect.width,
                height: cropRect.height,
                border: "2px dashed #6a1b9a",
                backgroundColor: "rgba(106, 27, 154, 0.12)",
                pointerEvents: "none",
                zIndex: 25,
                boxSizing: "border-box",
              }}
            />
          )}

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
                      color: "#FFFFFF",
                      display: "block",
                    }}
                  >
                    Difference #{selectedDifference?.id}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      color: "#E8E8F5",
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
                      color: "#D0D0E8",
                      fontWeight: 600,
                    }}
                  >
                    Original:{" "}
                    <Box
                      component="span"
                      sx={{ fontWeight: 400, color: "#E8E8F5" }}
                    >
                      {selectedDifference?.master || "—"}
                    </Box>
                  </Typography>

                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      color: "#D0D0E8",
                      fontWeight: 600,
                    }}
                  >
                    Sample:{" "}
                    <Box
                      component="span"
                      sx={{ fontWeight: 400, color: "#E8E8F5" }}
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
                    bgcolor: "#2A276E",
                    color: "#FFFFFF",
                    border: "1px solid #2A276E",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                  },
                },
                arrow: {
                  sx: {
                    color: "#2A276E",
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
                   * Thick outline to clearly mark the difference.
                   */
                  border:
                    "3px solid #c63737",

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
              >
                {/* Difference number badge */}
                <Box
                  sx={{
                    position: "absolute",
                    left: -13,
                    top: -13,
                    minWidth: 26,
                    height: 26,
                    px: 0.5,
                    borderRadius: "50%",
                    bgcolor: "#c63737",
                    color: "#FFFFFF",
                    border: "2px solid #FFFFFF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1,
                    userSelect: "none",
                    pointerEvents: "none",
                    zIndex: 21,
                    boxSizing: "border-box",
                  }}
                >
                  {selectedDifference?.id}
                </Box>
              </Box>
            </Tooltip>
          )}
        </Box>
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

      {cropEnabled && (
        <Box
          sx={{
            position: "absolute",
            left: 20,
            top: 20,
            px: 1.5,
            py: 0.75,
            bgcolor: "rgba(255,255,255,0.95)",
            border: "1px solid #6a1b9a",
            borderRadius: 1,
            boxShadow: 1,
            zIndex: 30,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "#6a1b9a",
              fontWeight: 600,
            }}
          >
            Crop Compare: drag a rectangle on the page to inspect that region.
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