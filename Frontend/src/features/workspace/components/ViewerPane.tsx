import { useMemo, useState } from "react";
 
import { Box, Paper, Typography } from "@mui/material";
 
import PdfToolbar from "./PdfToolbar";
import PdfViewer from "./PdfViewer";
import type { InspectionDifference } from "./InspectionResults";
import { truncateFileName } from "@/shared/utils/truncateFileName";
 
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
}: ViewerPaneProps) {
  const [manualPageNumber, setManualPageNumber] =
    useState(1);
 
  const [numPages, setNumPages] =
    useState(1);
 
  const [zoom, setZoom] = useState(100);
  const [lastSelectedId, setLastSelectedId] =
    useState<number | null>(null);

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
 
  return (
    <Paper
      elevation={0}
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
        bgcolor: "#ffffff",
      }}
    >
      {/* ================= Header ================= */}
 
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: "1px solid #E5E7EB",
          backgroundColor: "#FAFAFA",
        }}
      >
        <Typography
          variant="h6"
          sx={{ fontWeight: 600 }}
          color="#2A276E"
        >
          {title}
        </Typography>
 
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
          {truncateFileName(file.name)}
        </Typography>
 
        <Typography
          variant="caption"
          color="text.secondary"
        >
          {(file.size / (1024 * 1024)).toFixed(2)} MB
        </Typography>
      </Box>
 
      {/* ================= Toolbar ================= */}
 
      <PdfToolbar
        pageNumber={effectivePageNumber}
        numPages={Math.max(1, numPages)}
        zoom={zoom}
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
      />
 
      {/* ================= PDF ================= */}
 
      <Box
        sx={{
          flex: 1,
          overflow: "hidden",
          backgroundColor: "#ECECEC",
        }}
      >
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
          onNumPagesChange={setNumPages}
          cropMode={cropMode}
          onCropComplete={onCropComplete}
        />
      </Box>
    </Paper>
  );
}