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
import {
  buildVerificationRows,
  NOT_AVAILABLE,
} from "@/shared/utils/barcodeVerificationFormat";

/** Label / value colours inside the dark hover card. */
const HOVER_LABEL_COLOR = "#C9CBE8";
const HOVER_VALUE_COLOR = "#FFFFFF";
const HOVER_MUTED_COLOR = "#9A9CC4";

type BarcodeHoverCardProps = {
  difference: InspectionDifference | null | undefined;
};

/**
 * Renders the "Barcode N / Decoded Value / Type / Grade / <metrics>" card.
 *
 * Kept as a stable two-column grid rather than a paragraph so the label and
 * value stay aligned down the card, and every row reads at a glance on hover.
 * Rows the engine could not measure render "N/A" (dimmed) rather than being
 * dropped, so the reader can tell "not measurable" from "not reported".
 */
/**
 * Hover card for a barcode finding.
 *
 * Exported so the barcode results table can show the exact same card on row
 * hover as the PDF overlay does, rather than the browser's plain text tooltip.
 */
export function BarcodeHoverCard({ difference }: BarcodeHoverCardProps) {
  const verification = difference?.barcodeVerification ?? null;
  const metricRows = buildVerificationRows(verification);

  // Any non-barcode difference (text / graphics / braille / notes) keeps the
  // original Difference #N summary, so nothing else in the app changes.
  if (difference?.type !== "Barcode") {
    if (difference?.type === "Braille") {
      return (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: "#FFFFFF", display: "block" }}>
            Braille region {difference.id}
          </Typography>
          <Typography variant="caption" sx={{ display: "block", color: "#D0D0E8", fontWeight: 600 }}>
            Decoded value:{" "}
            <Box component="span" sx={{ fontWeight: 400, color: "#E8E8F5" }}>
              {difference.decodedValue || difference.master || "—"}
            </Box>
          </Typography>
          {difference.comment && (
            <Typography variant="caption" sx={{ display: "block", color: "#E8E8F5" }}>
              {difference.comment}
            </Typography>
          )}
        </Box>
      );
    }

    return (
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: "#FFFFFF", display: "block" }}>
          Difference #{difference?.id}
        </Typography>
        <Typography variant="caption" sx={{ display: "block", color: "#E8E8F5", mb: 0.5 }}>
          {difference?.comment || difference?.type || "No reason available"}
        </Typography>
        <Typography variant="caption" sx={{ display: "block", color: "#D0D0E8", fontWeight: 600 }}>
          Original:{" "}
          <Box component="span" sx={{ fontWeight: 400, color: "#E8E8F5" }}>
            {difference?.master || "—"}
          </Box>
        </Typography>
        <Typography variant="caption" sx={{ display: "block", color: "#D0D0E8", fontWeight: 600 }}>
          Sample:{" "}
          <Box component="span" sx={{ fontWeight: 400, color: "#E8E8F5" }}>
            {difference?.sample || "—"}
          </Box>
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: "#FFFFFF", display: "block", mb: 0.5 }}>
        Barcode {difference.id}
      </Typography>

      {/* Identity block: decoded value / type / grade. */}
      <Box
        component="dl"
        sx={{ m: 0, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1, rowGap: 0.25 }}
      >
        <Typography component="dt" variant="caption" sx={hoverLabelSx}>
          Decoded Value:
        </Typography>
        <Typography component="dd" variant="caption" sx={hoverValueSx}>
          {difference.decodedValue || NOT_AVAILABLE}
        </Typography>

        <Typography component="dt" variant="caption" sx={hoverLabelSx}>
          Type:
        </Typography>
        <Typography component="dd" variant="caption" sx={hoverValueSx}>
          {difference.barcodeType || NOT_AVAILABLE}
        </Typography>

        <Typography component="dt" variant="caption" sx={hoverLabelSx}>
          Grade:
        </Typography>
        <Typography component="dd" variant="caption" sx={hoverValueSx}>
          {difference.grade || NOT_AVAILABLE}
        </Typography>
      </Box>

      {/* Verification metrics, separated by a hairline. */}
      {metricRows.length > 0 && (
        <Box
          component="dl"
          sx={{
            m: 0,
            mt: 0.5,
            pt: 0.5,
            borderTop: `1px solid ${HOVER_MUTED_COLOR}`,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 1,
            rowGap: 0.25,
          }}
        >
          {metricRows.map((row) => (
            <Box key={row.key} sx={hoverGridSpan}>
              <Typography component="dt" variant="caption" sx={hoverLabelSx}>
                {row.label}:
              </Typography>
              <Typography
                component="dd"
                variant="caption"
                sx={{
                  ...hoverValueSx,
                  textAlign: "right",
                  // Dim "N/A" so real measurements stay visually dominant.
                  color: row.value === NOT_AVAILABLE ? HOVER_MUTED_COLOR : HOVER_VALUE_COLOR,
                }}
              >
                {row.value}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* The engine's own disclaimer travels with the numbers, so a graded
          figure is never read as a certified measurement. */}
      {verification?.disclaimer && (
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 0.5, fontSize: 10, fontStyle: "italic", color: HOVER_MUTED_COLOR }}
        >
          {verification.disclaimer}
        </Typography>
      )}

      {verification?.error && (
        <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "#FFB4AB" }}>
          {verification.error}
        </Typography>
      )}
    </Box>
  );
}

const hoverLabelSx = {
  color: HOVER_LABEL_COLOR,
  fontSize: 11,
  lineHeight: 1.5,
  m: 0,
  whiteSpace: "nowrap" as const,
};

const hoverValueSx = {
  color: HOVER_VALUE_COLOR,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.5,
  m: 0,
  wordBreak: "break-word" as const,
};

const hoverGridSpan = {
  display: "contents" as const,
};

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
  /**
   * When true the externally managed `pageNumber` prop always wins over the
   * selected difference's own page. Set by the barcode result page, which
   * moves the page itself whenever a finding is selected and must still let
   * the user page through the document while a finding stays selected.
   */
  pageFollowsParent?: boolean;
  zoom?: number;
  compact?: boolean;
  onOverlayClick?: (difference: InspectionDifference) => void;
  connectorTargetRect?: {
    findingId: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
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
  /**
   * Development-only: render a coordinate debug panel over the page showing
   * the backend bbox, the coordinate basis, the page dimensions, the PDF.js
   * viewport size and the derived scale. Compiled out of production builds.
   */
  showDebugOverlay?: boolean;
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
  inspectionType,
  side,
  selectedDifference,
  naturalWidth,
  naturalHeight,
  zeroBasedPageIndex = true,
  pageNumber: requestedPageNumberFromToolbar,
  pageFollowsParent = false,
  zoom = 100,
  compact = false,
  onOverlayClick,
  connectorTargetRect,
  onNumPagesChange,
  cropMode,
  onCropComplete,
  showDebugOverlay = false,
}: PdfViewerProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const containerRef =
    useRef<HTMLDivElement | null>(null);

  const pageWrapperRef =
    useRef<HTMLDivElement | null>(null);

  const highlightRef =
    useRef<HTMLDivElement | null>(null);
  const previousSelectionIdRef = useRef<number | null>(null);
  const previousViewportRef = useRef<{ left: number; top: number } | null>(null);
  const [connectorLine, setConnectorLine] = useState<{
    findingId: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

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

  const hasSelectedDifference =
    Boolean(selectedDifference);

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

  /*
   * By default the viewer follows the selected difference's own page.
   * `pageFollowsParent` callers (the barcode result page) manage the page
   * themselves: the prop page wins so toolbar prev/next page navigation
   * keeps working even while a finding stays selected.
   */
  const requestedPageNumber =
    pageFollowsParent &&
    typeof requestedPageNumberFromToolbar === "number"
      ? requestedPageNumberFromToolbar
      : requestedPageNumberFromDifference !== null
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
   * The highlight is drawn inside the wrapper of the page that is currently
   * displayed, so its box is only handed out when the selected difference
   * actually lives on that page - otherwise paging around with a finding
   * selected would paint that finding's coordinates onto the wrong page.
   */
  const differenceIsOnDisplayedPage =
    requestedPageNumberFromDifference === null ||
    requestedPageNumberFromDifference === pageNumber;

  /*
   * ------------------------------------------------------------
   * Get the correct bounding box.
   *
   * Master PDF -> masterBox
   * Sample PDF -> sampleBox
   * ------------------------------------------------------------
   */
  const bbox = differenceIsOnDisplayedPage
    ? getBoundingBox(selectedDifference, side)
    : null;

  const showMissingCoordinatesNotice =
    hasSelectedDifference &&
    differenceIsOnDisplayedPage &&
    !bbox;

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

  /*
   * Pan mode (the hand tool). Dragging pans the scroll container that
   * holds the page, so the user can move around a zoomed-in document.
   *
   * Panning is exactly the inverse of the crop tool, so it is derived rather
   * than stored in state — there is no independent value to keep in sync.
   */
  const panEnabled = !cropEnabled;
  const panOriginRef = useRef<{ x: number; y: number } | null>(null);
  const panScrollOriginRef = useRef<{ x: number; y: number } | null>(null);

  const handlePanMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!panEnabled || cropEnabled || event.button !== 0) {
      return;
    }

    const scroller = containerRef.current;

    if (!scroller) {
      return;
    }

    panOriginRef.current = { x: event.clientX, y: event.clientY };
    panScrollOriginRef.current = {
      x: scroller.scrollLeft,
      y: scroller.scrollTop,
    };
  };

  const handlePanMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const origin = panOriginRef.current;
    const scrollOrigin = panScrollOriginRef.current;
    const scroller = containerRef.current;

    if (!origin || !scrollOrigin || !scroller) {
      return;
    }

    scroller.scrollLeft = scrollOrigin.x - (event.clientX - origin.x);
    scroller.scrollTop = scrollOrigin.y - (event.clientY - origin.y);
  };

  const endPan = () => {
    panOriginRef.current = null;
    panScrollOriginRef.current = null;
  };

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
      const container = containerRef.current;

      if (!highlight || !container) {
        return;
      }

      const highlightRect = highlight.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      container.scrollTo({
        left:
          container.scrollLeft +
          (highlightRect.left + highlightRect.width / 2) -
          (containerRect.left + containerRect.width / 2),
        top:
          container.scrollTop +
          (highlightRect.top + highlightRect.height / 2) -
          (containerRect.top + containerRect.height / 2),
        behavior: "smooth",
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

  /*
   * Reset the scroll position whenever the displayed page has no highlight
   * to centre on: the selection was cleared (deselect -> viewer zooms back
   * out), the selected finding has no usable coordinates, or the user paged
   * away from it. `selectedDifference` is a dependency on purpose so that
   * clearing the selection resets the view. When a highlight IS present the
   * scroll-to-highlight effect above centers it instead.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const selectedId = selectedDifference?.id ?? null;
    const previousSelectedId = previousSelectionIdRef.current;
    previousSelectionIdRef.current = selectedId;

    if (inspectionType === "braille") {
      if (previousSelectedId === null && selectedId !== null) {
        previousViewportRef.current = {
          left: container.scrollLeft,
          top: container.scrollTop,
        };
        return;
      }

      if (previousSelectedId !== null && selectedId === null) {
        const previousViewport = previousViewportRef.current;
        previousViewportRef.current = null;
        container.scrollTo({
          left: previousViewport?.left ?? 0,
          top: previousViewport?.top ?? 0,
          behavior: "smooth",
        });
        return;
      }
    }

    const hasHighlight = Boolean(selectedDifference) && Boolean(bbox);

    if (hasHighlight) {
      return;
    }

    container.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }, [
    selectedDifference,
    bbox,
    pageNumber,
    inspectionType,
  ]);

  useEffect(() => {
    if (
      inspectionType !== "braille" ||
      !selectedDifference ||
      !bbox ||
      !connectorTargetRect ||
      connectorTargetRect.findingId !== selectedDifference.id
    ) {
      return;
    }

    const viewport = viewportRef.current;
    const highlight = highlightRef.current;
    const container = containerRef.current;
    if (!viewport || !highlight || !container) {
      return;
    }

    let frame = 0;
    const updateConnector = () => {
      const viewportRect = viewport.getBoundingClientRect();
      const regionRect = highlight.getBoundingClientRect();
      const visibleRegion = {
        left: Math.max(regionRect.left, viewportRect.left),
        top: Math.max(regionRect.top, viewportRect.top),
        right: Math.min(regionRect.right, viewportRect.right),
        bottom: Math.min(regionRect.bottom, viewportRect.bottom),
      };

      if (
        visibleRegion.right <= visibleRegion.left ||
        visibleRegion.bottom <= visibleRegion.top ||
        viewportRect.width <= 0 ||
        viewportRect.height <= 0
      ) {
        setConnectorLine(null);
        return;
      }

      const targetCenterY =
        (connectorTargetRect.top + connectorTargetRect.bottom) / 2;
      const next = {
        findingId: selectedDifference.id,
        x1: visibleRegion.right - viewportRect.left,
        y1: (visibleRegion.top + visibleRegion.bottom) / 2 - viewportRect.top,
        x2: viewportRect.width - 2,
        y2: Math.max(
          2,
          Math.min(viewportRect.height - 2, targetCenterY - viewportRect.top)
        ),
      };
      setConnectorLine((previous) =>
        previous &&
        previous.findingId === next.findingId &&
        Math.abs(previous.x1 - next.x1) < 0.5 &&
        Math.abs(previous.y1 - next.y1) < 0.5 &&
        Math.abs(previous.x2 - next.x2) < 0.5 &&
        Math.abs(previous.y2 - next.y2) < 0.5
          ? previous
          : next
      );
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateConnector);
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(viewport);
    resizeObserver.observe(container);
    if (pageWrapperRef.current) resizeObserver.observe(pageWrapperRef.current);
    resizeObserver.observe(highlight);
    container.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    scheduleUpdate();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      container.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [
    bbox,
    connectorTargetRect,
    inspectionType,
    pageNumber,
    selectedDifference,
    zoom,
    renderedPageWidth,
    renderedPageHeight,
  ]);

  return (
    <Box
      ref={viewportRef}
      data-testid={inspectionType === "braille" ? "braille-pdf-viewport" : undefined}
      sx={{
        height: "100%",
        width: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
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

        p: compact ? 1 : 3,

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
          onMouseDown={cropEnabled ? handleCropMouseDown : handlePanMouseDown}
          onMouseMove={handlePanMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          sx={{
            position: "relative",
            display: "inline-block",
            lineHeight: 0,
            bgcolor: "#FFFFFF",
            boxShadow:
              "0 2px 8px rgba(0,0,0,0.15)",
            cursor: cropEnabled ? "crosshair" : panEnabled ? "grab" : "default",
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
              COORDINATE DEBUG PANEL (development only)
              Shows the full chain from the backend bbox to the
              on-screen position, so a drift can be attributed to
              exactly one step. Tree-shaken out of production builds.
              ===================================================== */}

          {import.meta.env.DEV && showDebugOverlay && (
            <Box
              data-testid="pdf-coord-debug"
              sx={{
                position: "absolute",
                top: 8,
                left: 8,
                zIndex: 30,
                pointerEvents: "none",
                bgcolor: "rgba(0,0,0,0.82)",
                color: "#7CFC7C",
                fontFamily: "monospace",
                fontSize: 11,
                lineHeight: 1.45,
                p: 1,
                borderRadius: 1,
                whiteSpace: "pre",
              }}
            >
              {[
                `finding      : ${selectedDifference?.id ?? "—"}`,
                `bbox         : ${
                  bbox
                    ? `${bbox.x}, ${bbox.y}, ${bbox.width}, ${bbox.height}`
                    : "—"
                }`,
                `coordSystem  : ${selectedDifference?.coordinateSystem ?? "—"}`,
                `page         : ${pageNumber}`,
                `pageSize     : ${naturalWidth ?? "—"} x ${naturalHeight ?? "—"}`,
                `viewportSize : ${renderedPageWidth ?? "—"} x ${
                  renderedPageHeight ?? "—"
                }`,
                `scaleX/scaleY: ${scaleX.toFixed(4)} / ${scaleY.toFixed(4)}`,
                `viewportScale: ${(
                  (renderedPageWidth ?? 0) / (naturalWidth || 1)
                ).toFixed(4)}`,
                `zoom         : ${zoom}%`,
                `devicePixelR : ${typeof window === "undefined" ? "—" : window.devicePixelRatio}`,
                `overlayCSS   : ${highlightLeft.toFixed(1)}, ${highlightTop.toFixed(
                  1
                )} ${highlightWidth.toFixed(1)}x${highlightHeight.toFixed(1)}`,
              ].join("\n")}
            </Box>
          )}

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
                <BarcodeHoverCard difference={selectedDifference} />
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
                    /* The verification card is a tall block; keep it readable
                       and scrollable instead of letting it run off-screen. */
                    maxWidth: 320,
                    whiteSpace: "normal",
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
                onClick={() => {
                  if (selectedDifference) {
                    onOverlayClick?.(selectedDifference);
                  }
                }}
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
                    inspectionType === "braille"
                      ? "2px solid #2A276E"
                      : "3px solid #c63737",

                  /*
                   * Very light background.
                   */
                  backgroundColor:
                    inspectionType === "braille"
                      ? "rgba(42, 39, 110, 0.08)"
                      : "rgba(246, 246, 247, 0.06)",

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
      {inspectionType === "braille" &&
        selectedDifference &&
        bbox &&
        connectorTargetRect &&
        connectorLine &&
        connectorLine.findingId === selectedDifference.id && (
        <svg
          data-testid="braille-region-connector"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "hidden",
            pointerEvents: "none",
            zIndex: 24,
          }}
        >
          <defs>
            <marker
              id="braille-region-arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#2A276E" />
            </marker>
          </defs>
          <path
            d={`M ${connectorLine.x1} ${connectorLine.y1} C ${
              connectorLine.x1 + (connectorLine.x2 - connectorLine.x1) * 0.45
            } ${connectorLine.y1}, ${
              connectorLine.x2 - (connectorLine.x2 - connectorLine.x1) * 0.35
            } ${connectorLine.y2}, ${connectorLine.x2} ${connectorLine.y2}`}
            fill="none"
            stroke="#2A276E"
            strokeWidth="1.5"
            markerEnd="url(#braille-region-arrowhead)"
          />
        </svg>
      )}
    </Box>
  );
}