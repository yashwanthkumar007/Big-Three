import { useEffect, useRef, useState } from "react";

import {
  Box,
  CircularProgress,
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
}: PdfViewerProps) {
  const containerRef =
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
   * Reset PDF state when a different file is supplied.
   * ------------------------------------------------------------
   */
  useEffect(() => {
    setNumPages(0);
    setPdfError(null);
    setRenderedPageWidth(null);
    setRenderedPageHeight(null);
  }, [file]);

  /*
   * ------------------------------------------------------------
   * Calculate available viewer width.
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
   * Get backend bounding box.
   *
   * Master:
   *   masterBox
   *
   * Sample:
   *   sampleBox
   * ------------------------------------------------------------
   */
  const bbox = getBoundingBox(
    selectedDifference,
    side
  );

  /*
   * ------------------------------------------------------------
   * Backend page.
   *
   * Backend is expected to return:
   *
   * page: 1
   * page: 2
   * page: 3
   *
   * ------------------------------------------------------------
   */
  const backendPage =
    selectedDifference?.page ?? 1;

  /*
   * ------------------------------------------------------------
   * Make sure requested page exists.
   * ------------------------------------------------------------
   */
  const pageNumber =
    numPages > 0 &&
    backendPage >= 1 &&
    backendPage <= numPages
      ? backendPage
      : 1;

  /*
   * ------------------------------------------------------------
   * Scale backend coordinates to rendered PDF.
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

        bgcolor: "#CFCFCF",
      }}
    >
      <Document
        /*
         * IMPORTANT:
         *
         * Do NOT create a blob URL here.
         *
         * Pass the File object directly.
         */
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
          console.log(
            `${side} PDF loaded successfully`,
            numPages
          );

          setNumPages(numPages);

          setPdfError(null);
        }}
        onLoadError={(error) => {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          console.error(
            `${side} PDF loading error:`,
            error
          );

          setPdfError(message);
        }}
      >
        <Box
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
            pageNumber={pageNumber}
            width={
              pageWidth ??
              undefined
            }
            renderAnnotationLayer
            renderTextLayer
            onRenderSuccess={(page) => {
              console.log(
                `${side} page rendered`,
                page.width,
                page.height
              );

              setRenderedPageWidth(
                page.width
              );

              setRenderedPageHeight(
                page.height
              );
            }}
          />

          {/* =====================================================
              DIFFERENCE HIGHLIGHT
             ===================================================== */}

          {bbox && (
            <Box
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
                 * Outline around the difference.
                 */
                border:
                  "3px solid #2A276E",

                /*
                 * Very light background so the
                 * original PDF remains visible.
                 */
                backgroundColor:
                  "rgba(42, 39, 110, 0.10)",

                boxShadow:
                  "0 0 0 2px rgba(255,255,255,0.9)",

                borderRadius: "3px",

                pointerEvents: "none",

                zIndex: 20,

                boxSizing:
                  "border-box",

                transition:
                  "all 0.2s ease",
              }}
            />
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
    </Box>
  );
}