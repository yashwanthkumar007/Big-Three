import {
  Box,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import CropFreeIcon from "@mui/icons-material/CropFree";
import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";

type PdfToolbarProps = {
  pageNumber?: number;
  numPages?: number;
  zoom?: number;
  onPageChange?: (page: number) => void;
  onZoomChange?: (zoom: number) => void;
  onFitWidth?: () => void;
  onFitPage?: () => void;
  onRotateLeft?: () => void;
  onRotateRight?: () => void;
};

export default function PdfToolbar({
  pageNumber = 1,
  numPages = 1,
  zoom = 100,
  onPageChange,
  onZoomChange,
  onFitWidth,
  onFitPage,
  onRotateLeft,
  onRotateRight,
}: PdfToolbarProps) {
  const handlePrevious = () => {
    if (pageNumber > 1) {
      onPageChange?.(pageNumber - 1);
    }
  };

  const handleNext = () => {
    if (pageNumber < numPages) {
      onPageChange?.(pageNumber + 1);
    }
  };

  const handleZoomOut = () => {
    onZoomChange?.(Math.max(25, zoom - 10));
  };

  const handleZoomIn = () => {
    onZoomChange?.(Math.min(300, zoom + 10));
  };

  return (
    <Box
      sx={{
        height: 52,
        px: 1,
        borderBottom: "1px solid #E5E7EB",
        bgcolor: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {/* Left Section */}
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: "center" }}
      >
        <Tooltip title="Previous Page">
          <IconButton size="small" onClick={handlePrevious}>
            <NavigateBeforeIcon />
          </IconButton>
        </Tooltip>

        <TextField
          size="small"
          value={pageNumber}
          onChange={(event) => {
            const value = parseInt(event.target.value, 10);
            if (!Number.isNaN(value) && value >= 1 && value <= numPages) {
              onPageChange?.(value);
            }
          }}
          sx={{
            width: 55,
          }}
        />

        <Typography variant="body2">
          / {numPages}
        </Typography>

        <Tooltip title="Next Page">
          <IconButton size="small" onClick={handleNext}>
            <NavigateNextIcon />
          </IconButton>
        </Tooltip>

        <Divider
          orientation="vertical"
          flexItem
          sx={{ mx: 1 }}
        />

        <Tooltip title="Zoom Out">
          <IconButton size="small" onClick={handleZoomOut}>
            <ZoomOutIcon />
          </IconButton>
        </Tooltip>

        <Typography
          variant="body2"
          sx={{ minWidth: 45 }}
        >
          {zoom}%
        </Typography>

        <Tooltip title="Zoom In">
          <IconButton size="small" onClick={handleZoomIn}>
            <ZoomInIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Right Section */}
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: "center" }}
      >
        <Tooltip title="Fit Width">
          <IconButton size="small" onClick={onFitWidth}>
            <FitScreenIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Fit Page">
          <IconButton size="small" onClick={onFitPage}>
            <CropFreeIcon />
          </IconButton>
        </Tooltip>

        <Divider
          orientation="vertical"
          flexItem
          sx={{ mx: 1 }}
        />

        <Tooltip title="Rotate Left">
          <IconButton size="small" onClick={onRotateLeft}>
            <RotateLeftIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Rotate Right">
          <IconButton size="small" onClick={onRotateRight}>
            <RotateRightIcon />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}