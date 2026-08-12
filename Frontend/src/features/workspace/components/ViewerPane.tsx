import { useMemo, useState } from "react";
 
import { Box, Paper, Typography } from "@mui/material";
 
import PdfToolbar from "./PdfToolbar";
import PdfViewer from "./PdfViewer";
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
}: ViewerPaneProps) {
  const [manualPageNumber, setManualPageNumber] =
    useState(1);
 
  const [numPages, setNumPages] =
    useState(1);
 
  const [zoom, setZoom] = useState(100);
 
  const selectedPageNumber = useMemo(() => {
    if (!selectedDifference?.page && selectedDifference?.page !== 0) {
      return null;
    }
 
    return zeroBasedPageIndex
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
    selectedPageNumber &&
    selectedPageNumber >= 1
      ? clampPage(selectedPageNumber)
      : clampPage(manualPageNumber);
 
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
        />
      </Box>
    </Paper>
  );
}