import { useEffect, useMemo, useState } from "react";
 
import { Box, Paper, Typography } from "@mui/material";
 
import PdfToolbar, {
  type PageFilter,
  type ViewerTool,
} from "./PdfToolbar";
import PdfViewer from "./PdfViewer";
import DocxViewer from "./DocxViewer";
import type { InspectionDifference } from "./InspectionResults";
 
type ViewerPaneProps = {
  title: string;
  file: File;
  inspectionType: string;
  side: "master" | "sample";
  selectedDifference?: InspectionDifference | null;
  naturalWidth?: number;
  naturalHeight?: number;
  zeroBasedPageIndex?: boolean;
  /** Crop Compare props - forwarded to PdfViewer (master side only). */
  cropMode?: boolean;
  onCropComplete?: (page0Based: number, box: { x: number; y: number; width: number; height: number }) => void;

  /* ---- Extended viewer controls (wired to the shared toolbar) ---- */

  /** Opens/closes the workspace navigation panel. */
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  onDocumentAction?: () => void;
  onComments?: () => void;
  /** Re-reads persisted state; must never re-run the inspection engine. */
  onRefresh?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onOverlayClick?: (difference: InspectionDifference) => void;
  onRegisterZoomMenu?: (openMenu: (() => void) | null) => void;
  connectorTargetRect?: {
    findingId: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
  /** Hide the title, duplicate filename, and file size above the toolbar. */
  hideHeader?: boolean;
  /** Reduce the document's inner padding for the single-file barcode viewer. */
  compactViewer?: boolean;
  /** Reports the document page count so the page list can be built from it. */
  onNumPagesChange?: (numPages: number) => void;
};
 
export default function ViewerPane({
  title,
  file,
  inspectionType,
  side,
  selectedDifference,
  naturalWidth,
  naturalHeight,
  zeroBasedPageIndex,
  cropMode,
  onCropComplete,
  onToggleSidebar,
  sidebarOpen,
  onDocumentAction,
  onComments,
  onRefresh,
  isFullscreen = false,
  onToggleFullscreen,
  onOverlayClick,
  onRegisterZoomMenu,
  connectorTargetRect,
  hideHeader = false,
  compactViewer = false,
  onNumPagesChange,
}: ViewerPaneProps) {
  const [manualPageNumber, setManualPageNumber] =
    useState(1);
 
  const [numPages, setNumPages] =
    useState(1);

  useEffect(() => {
    onNumPagesChange?.(numPages);
  }, [numPages, onNumPagesChange]);
 
  const [zoom, setZoom] = useState(100);
  const [lastSelectedId, setLastSelectedId] =
    useState<number | null>(null);

  /* ---- Extended viewer state ---- */

  const [tool, setTool] = useState<ViewerTool>("pan");
  const [pageFilter, setPageFilter] = useState<PageFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fitPageZoom =
    naturalWidth && naturalHeight
      ? Math.max(
          25,
          Math.min(
            100,
            Math.round(
              (naturalWidth /
                Math.max(
                  naturalWidth,
                  naturalHeight
                )) *
                100
            )
          )
        )
      : 100;

  /*
   * ------------------------------------------------------------
   * When a new difference is selected, zoom to 235% so the
   * highlighted area is clearly visible. When it is deselected
   * (clicking the same difference again), return to the normal
   * fit-page zoom so the whole page is visible again. This uses
   * the "adjusting state during render" pattern to avoid
   * cascading renders from effects.
   * ------------------------------------------------------------
   */
  if ((selectedDifference?.id ?? null) !== lastSelectedId) {
    setLastSelectedId(selectedDifference?.id ?? null);

    if (selectedDifference) {
      setZoom(235);
    } else {
      setZoom(fitPageZoom);
    }
  }
 
  const selectedPageNumber = useMemo(() => {
    // Use a strict null/undefined check here instead of a truthy
    // check — `selectedDifference.page` is a legitimate value of 0
    // for the first page, and 0 is falsy in JS, which previously
    // caused first-page differences to be silently ignored below.
    if (
      selectedDifference?.page === undefined ||
      selectedDifference?.page === null
    ) {
      return null;
    }

    // The rest of the app (see pdfReportGenerator.ts: pages are
    // matched via `(d.page ?? 0) === page.page` and labelled as
    // `page.page + 1`) treats `difference.page` as 0-based. Default
    // to that assumption unless the caller explicitly overrides it,
    // since callers (e.g. InspectionResults) don't currently pass
    // zeroBasedPageIndex at all.
    const isZeroBased = zeroBasedPageIndex ?? true;

    return isZeroBased
      ? selectedDifference.page + 1
      : selectedDifference.page;
  }, [selectedDifference, zeroBasedPageIndex]);
 
  const clampPage = (page: number) => {
    if (numPages <= 0) {
      return 1;
    }
 
    return Math.max(1, Math.min(numPages, page));
  };
 
  const effectivePageNumber =
    // Strict null check (not a truthy check) so page 1 — i.e. the
    // result of a 0-based page 0 — is never mistaken for "no page
    // selected" and dropped in favor of the manually-set page.
    selectedPageNumber !== null && selectedPageNumber >= 1
      ? clampPage(selectedPageNumber)
      : clampPage(manualPageNumber);

  /**
   * Applies the All / Odd / Even page filter. When the current page is
   * filtered out, the viewer jumps to the nearest visible page, so these
   * controls genuinely change what is rendered rather than only toggling
   * a visual label.
   */
  const applyPageFilter = (filter: PageFilter) => {
    setPageFilter(filter);

    if (filter === "all") {
      return;
    }

    const isVisible = (page: number) =>
      filter === "odd" ? page % 2 === 1 : page % 2 === 0;

    if (isVisible(effectivePageNumber)) {
      return;
    }

    // Walk away from the current page until a matching page is found.
    const step = filter === "odd" ? 1 : -1;
    let candidate = effectivePageNumber + step;

    while (candidate >= 1 && candidate <= numPages) {
      if (isVisible(candidate)) {
        setManualPageNumber(clampPage(candidate));
        return;
      }

      candidate += step;
    }

    setManualPageNumber(clampPage(filter === "odd" ? 1 : 2));
  };

  /**
   * Highlights matches of the search query in the react-pdf text layer.
   * react-pdf already mounts a searchable text layer, so we query it
   * instead of re-implementing PDF text extraction.
   */
  const runSearch = (query: string) => {
    setSearchQuery(query);

    const textLayer = document.querySelector(
      ".react-pdf__Page__textContent"
    ) as HTMLElement | null;

    if (!textLayer) {
      return;
    }

    const nodes = textLayer.querySelectorAll<HTMLElement>(
      "span, br, div"
    );

    nodes.forEach((element) => {
      element.style.background = "";
    });

    if (!query.trim()) {
      return;
    }

    const needle = query.toLowerCase();

    for (const element of Array.from(nodes)) {
      if ((element.textContent ?? "").toLowerCase().includes(needle)) {
        element.style.background = "#FFF59D";
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
  };
 
  const isDocx = file.name.toLowerCase().endsWith(".docx");

  return (

    <Paper
      elevation={0}
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
        bgcolor: "#ffffff",
      }}
    >
      {/* ================= Header ================= */}
 
      {!hideHeader && <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: "1px solid #E5E7EB",
          backgroundColor: "#FAFAFA",
        }}
      >
        {title && (
          <Typography
            variant="h6"
            sx={{ fontWeight: 600 }}
            color="#2A276E"
          >
            {title}
          </Typography>
        )}
 
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          title={file.name}
          sx={{
            mt: 0.5,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.name}
        </Typography>
 
        <Typography
          variant="caption"
          color="text.secondary"
        >
          {(file.size / (1024 * 1024)).toFixed(2)} MB
        </Typography>
      </Box>
      }
 
      {/* ================= Toolbar ================= */}
 
      <PdfToolbar
        pageNumber={effectivePageNumber}
        numPages={Math.max(1, numPages)}
        zoom={zoom}
        onRegisterZoomMenu={onRegisterZoomMenu}
        onPageChange={(page) => {
          setManualPageNumber(clampPage(page));
        }}
        onZoomChange={(nextZoom) => {
          setZoom(
            Math.max(
              25,
              Math.min(300, nextZoom)
            )
          );
        }}
        onFitWidth={() => setZoom(100)}
        onFitPage={() => setZoom(fitPageZoom)}
        onToggleSidebar={onToggleSidebar}
        sidebarOpen={sidebarOpen}
        tool={tool}
        onToolChange={setTool}
        onDocumentAction={onDocumentAction}
        onSearch={runSearch}
        onDocumentView={onDocumentAction}
        onComments={onComments}
        onRefresh={onRefresh}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        onCancel={() => {
          setManualPageNumber(1);
          setSearchQuery("");
        }}
        hasSelection={Boolean(searchQuery)}
        canUndo={false}
        pageFilter={pageFilter}
        onPageFilterChange={applyPageFilter}
      />
 
      {/* ================= PDF ================= */}
 
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          backgroundColor: "#ECECEC",
        }}
      >
        {isDocx ? (
        <DocxViewer
          file={file}
          pageNumber={effectivePageNumber}
          zoom={zoom}
          onNumPagesChange={setNumPages}
          inspectionType={inspectionType}
          side={side}
          selectedDifference={selectedDifference}
          naturalWidth={naturalWidth}
          naturalHeight={naturalHeight}
          zeroBasedPageIndex={zeroBasedPageIndex}
          cropMode={cropMode}
          onCropComplete={onCropComplete}
        />
      ) : (
        <PdfViewer
          file={file}
          inspectionType={inspectionType}
          side={side}
          selectedDifference={selectedDifference}
          naturalWidth={naturalWidth}
          naturalHeight={naturalHeight}
          zeroBasedPageIndex={zeroBasedPageIndex}
          pageNumber={effectivePageNumber}
          zoom={zoom}
          compact={compactViewer}
          onNumPagesChange={setNumPages}
          onOverlayClick={onOverlayClick}
          connectorTargetRect={connectorTargetRect}
          /*
           * The selection tool reuses the EXISTING crop interaction
           * (`cropMode`) so region selection stays wired to the current
           * crop-compare behaviour instead of a parallel implementation.
           */
          cropMode={tool === "select" || cropMode}
          onCropComplete={onCropComplete}
        />
      )}


      </Box>
    </Paper>
  );
}