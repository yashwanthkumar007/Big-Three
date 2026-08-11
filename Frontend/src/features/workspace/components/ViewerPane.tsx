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
};

export default function ViewerPane({
  title,
  file,
  inspectionType,
  side,
  selectedDifference,
  naturalWidth,
  naturalHeight,
}: ViewerPaneProps) {
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

      <PdfToolbar />

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
        />
      </Box>
    </Paper>
  );
}