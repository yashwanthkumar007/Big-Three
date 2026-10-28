import { useEffect, useRef, useState } from "react";

import {
  Box,
  Button,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import CropFreeIcon from "@mui/icons-material/CropFree";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import PanToolOutlinedIcon from "@mui/icons-material/PanToolOutlined";
import CropIcon from "@mui/icons-material/Crop";
import SearchIcon from "@mui/icons-material/Search";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import ChatBubbleOutlinedIcon from "@mui/icons-material/ChatBubbleOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import CloseIcon from "@mui/icons-material/Close";
import UndoIcon from "@mui/icons-material/Undo";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import SkipNextIcon from "@mui/icons-material/SkipNext";

/** Interactive tool currently active in the viewer. */
export type ViewerTool = "pan" | "select";

/** Page visibility filter driven by the All / Odd / Even controls. */
export type PageFilter = "all" | "odd" | "even";

/** Zoom steps offered by the zoom dropdown. */
const ZOOM_LEVELS = [25, 33, 36, 50, 66, 75, 100, 125, 150, 200] as const;

/** Brand navy used for active tool states. */
const BRAND = "#2A276E";

type PdfToolbarProps = {
  pageNumber?: number;
  numPages?: number;
  zoom?: number;
  onPageChange?: (page: number) => void;
  onZoomChange?: (zoom: number) => void;
  onRegisterZoomMenu?: (openMenu: (() => void) | null) => void;
  onFitWidth?: () => void;
  onFitPage?: () => void;

  /* ---- Extended controls (Barcode Inspection viewer) ---- */

  /** Opens/closes the navigation panel. */
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  /** Renders page navigation in the top toolbar instead of the bottom one. */
  pageNavigationAtTop?: boolean;

  /** Active drag tool (hand/pan or region selection). */
  tool?: ViewerTool;
  onToolChange?: (tool: ViewerTool) => void;

  /** Document / file action menu. */
  onDocumentAction?: () => void;

  /** Text search across the rendered document. */
  onSearch?: (query: string) => void;

  /** Document / copy / view action. */
  onDocumentView?: () => void;

  /** Opens the existing comments / annotations interface. */
  onComments?: () => void;

  /**
   * Re-reads the persisted inspection state from the backend.
   * Must never re-run the inspection engine.
   */
  onRefresh?: () => void;

  /* ---- Bottom toolbar ---- */

  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;

  /** Cancels the active region selection / temporary operation. */
  onCancel?: () => void;
  hasSelection?: boolean;

  /** Reverts the last annotation/selection action. */
  onUndo?: () => void;
  canUndo?: boolean;

  pageFilter?: PageFilter;
  onPageFilterChange?: (filter: PageFilter) => void;
};

export default function PdfToolbar({
  pageNumber = 1,
  numPages = 1,
  zoom = 100,
  onPageChange,
  onZoomChange,
  onRegisterZoomMenu,
  onFitWidth,
  onFitPage,
  onToggleSidebar,
  sidebarOpen = false,
  pageNavigationAtTop = false,
  tool = "pan",
  onToolChange,
  onDocumentAction,
  onSearch,
  onDocumentView,
  onComments,
  onRefresh,
  isFullscreen = false,
  onToggleFullscreen,
  onCancel,
  hasSelection = false,
  onUndo,
  canUndo = false,
  pageFilter = "all",
  onPageFilterChange,
}: PdfToolbarProps) {
  const [zoomAnchor, setZoomAnchor] = useState<HTMLElement | null>(null);
  const zoomButtonRef = useRef<HTMLButtonElement | null>(null);
  const [searchAnchor, setSearchAnchor] = useState<HTMLElement | null>(null);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    if (!onRegisterZoomMenu) return;
    onRegisterZoomMenu(() => {
      if (zoomButtonRef.current) {
        setZoomAnchor(zoomButtonRef.current);
      }
    });
    return () => onRegisterZoomMenu(null);
  }, [onRegisterZoomMenu]);

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

  /**
   * Steps through ZOOM_LEVELS so the value always lands on one of the
   * supported steps (25/33/36/50/66/75/100/125/150/200) instead of an
   * arbitrary +/-10 that would drift off the supported list.
   */
  const stepZoom = (direction: 1 | -1) => {
    const sorted = [...ZOOM_LEVELS];
    const currentIndex = sorted.findIndex((level) => level >= zoom);
    const base = currentIndex === -1 ? 0 : currentIndex;

    onZoomChange?.(
      sorted[
        Math.max(0, Math.min(sorted.length - 1, base + (direction === 1 ? 1 : -1)))
      ]
    );
  };

  const applySearch = (value: string) => {
    setSearchText(value);
    onSearch?.(value);
  };

  const toolButtonSx = (active: boolean) => ({
    color: active ? BRAND : "text.primary",
    bgcolor: active ? "#EFEFF7" : "transparent",
  });

  return (
    <>
      {/* ================= TOP TOOLBAR ================= */}
      <Box
        sx={{
          height: 44,
          px: 0.5,
          borderBottom: "1px solid #E5E7EB",
          bgcolor: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        {/* ---- Left group: panel, document, zoom, tools ---- */}
        <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", minWidth: 0 }}>
          <Tooltip title="Toggle Navigation Panel">
            <span>
              <IconButton
                size="small"
                onClick={onToggleSidebar}
                disabled={!onToggleSidebar}
                aria-label="Toggle navigation panel"
                sx={toolButtonSx(sidebarOpen)}
              >
                <ViewSidebarOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          <Tooltip title="Document Actions">
            <span>
              <IconButton
                size="small"
                onClick={onDocumentAction}
                disabled={!onDocumentAction}
                aria-label="Document actions"
              >
                <DescriptionOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          <Tooltip title="Zoom Out">
            <span>
              <IconButton size="small" onClick={() => stepZoom(-1)} aria-label="Zoom out">
                <ZoomOutIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Button
            ref={zoomButtonRef}
            size="small"
            onClick={(event) => setZoomAnchor(event.currentTarget)}
            aria-haspopup="listbox"
            aria-expanded={Boolean(zoomAnchor)}
            sx={{ minWidth: 58, color: "text.primary", fontWeight: 600, fontSize: 12.5 }}
          >
            {zoom}%
          </Button>
          <Menu
            anchorEl={zoomAnchor}
            open={Boolean(zoomAnchor)}
            onClose={() => setZoomAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            transformOrigin={{ vertical: "top", horizontal: "center" }}
          >
            {ZOOM_LEVELS.map((level) => (
              <MenuItem
                key={level}
                selected={level === zoom}
                onClick={() => {
                  onZoomChange?.(level);
                  setZoomAnchor(null);
                }}
                sx={{ fontSize: 13, minWidth: 80 }}
              >
                {level}%
              </MenuItem>
            ))}
          </Menu>

          <Tooltip title="Zoom In">
            <span>
              <IconButton size="small" onClick={() => stepZoom(1)} aria-label="Zoom in">
                <ZoomInIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          <Tooltip title="Pan">
            <span>
              <IconButton
                size="small"
                onClick={() => onToolChange?.("pan")}
                aria-label="Pan tool"
                aria-pressed={tool === "pan"}
                sx={toolButtonSx(tool === "pan")}
              >
                <PanToolOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Select Region">
            <span>
              <IconButton
                size="small"
                onClick={() => onToolChange?.("select")}
                aria-label="Select region tool"
                aria-pressed={tool === "select"}
                sx={toolButtonSx(tool === "select")}
              >
                <CropIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {pageNavigationAtTop && (
          <Stack
            direction="row"
            spacing={0.25}
            sx={{ alignItems: "center", flexShrink: 0 }}
          >
            <Tooltip title="Previous page">
              <span>
                <IconButton
                  size="small"
                  onClick={handlePrevious}
                  disabled={pageNumber <= 1}
                  aria-label="Previous page"
                >
                  <SkipPreviousIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Typography sx={{ fontSize: 12.5, px: 0.5, whiteSpace: "nowrap" }}>
              {pageNumber} / {Math.max(1, numPages)}
            </Typography>
            <Tooltip title="Next page">
              <span>
                <IconButton
                  size="small"
                  onClick={handleNext}
                  disabled={pageNumber >= numPages}
                  aria-label="Next page"
                >
                  <SkipNextIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        )}

        {/* ---- Right group: search, document, comments, refresh ---- */}
        <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", flexShrink: 0 }}>
          <Tooltip title="Search">
            <span>
              <IconButton
                size="small"
                onClick={(event) => setSearchAnchor(event.currentTarget)}
                disabled={!onSearch}
                aria-label="Search document"
              >
                <SearchIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Menu
            anchorEl={searchAnchor}
            open={Boolean(searchAnchor)}
            onClose={() => setSearchAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <Box sx={{ p: 1.5, width: 260 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1 }}>
                Search Document
              </Typography>
              <TextField
                fullWidth
                size="small"
                autoFocus
                value={searchText}
                placeholder="Search text…"
                onChange={(event) => applySearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applySearch(searchText);
                  }
                }}
                sx={{ mb: 1 }}
              />
              <Stack
                direction="row"
                spacing={1}
                sx={{ justifyContent: "flex-end" }}
              >
                <Button
                  size="small"
                  onClick={() => applySearch(searchText)}
                  disabled={!searchText}
                  sx={{ fontSize: 12 }}
                >
                  Find
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    setSearchText("");
                    applySearch("");
                    setSearchAnchor(null);
                  }}
                  sx={{ fontSize: 12 }}
                >
                  Close
                </Button>
              </Stack>
            </Box>
          </Menu>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          <Tooltip title="Document View">
            <span>
              <IconButton
                size="small"
                onClick={onDocumentView}
                disabled={!onDocumentView}
                aria-label="Document view"
              >
                <ArticleOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Comments">
            <span>
              <IconButton
                size="small"
                onClick={onComments}
                disabled={!onComments}
                aria-label="Comments"
              >
                <ChatBubbleOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Refresh">
            <span>
              <IconButton
                size="small"
                onClick={onRefresh}
                disabled={!onRefresh}
                aria-label="Refresh inspection state"
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>


      {/* ================= BOTTOM TOOLBAR ================= */}
      <Box
        sx={{
          height: 40,
          px: 0.5,
          borderTop: "1px solid #E5E7EB",
          bgcolor: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", minWidth: 0 }}>
          {!pageNavigationAtTop && (
            <>
              <Tooltip title="Previous page">
                <span>
                  <IconButton
                    size="small"
                    onClick={handlePrevious}
                    disabled={pageNumber <= 1}
                    aria-label="Previous page"
                  >
                    <SkipPreviousIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <Typography
                sx={{ fontSize: 12.5, px: 0.5, whiteSpace: "nowrap" }}
              >
                {pageNumber} / {Math.max(1, numPages)}
              </Typography>

              <Tooltip title="Next page">
                <span>
                  <IconButton
                    size="small"
                    onClick={handleNext}
                    disabled={pageNumber >= numPages}
                    aria-label="Next page"
                  >
                    <SkipNextIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            </>
          )}

          <Tooltip title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
            <span>
              <IconButton
                size="small"
                onClick={onToggleFullscreen}
                disabled={!onToggleFullscreen}
                aria-label="Toggle fullscreen"
              >
                {isFullscreen ? (
                  <FullscreenExitIcon fontSize="small" />
                ) : (
                  <FullscreenIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Fit Page">
            <span>
              <IconButton
                size="small"
                onClick={onFitPage}
                disabled={!onFitPage}
                aria-label="Fit page"
              >
                <FitScreenIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Fit Width">
            <span>
              <IconButton
                size="small"
                onClick={onFitWidth}
                disabled={!onFitWidth}
                aria-label="Fit width"
              >
                <CropFreeIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Clear Selection">
            <span>
              <IconButton
                size="small"
                onClick={onCancel}
                disabled={!onCancel || !hasSelection}
                aria-label="Clear selection"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Undo">
            <span>
              <IconButton
                size="small"
                onClick={onUndo}
                disabled={!onUndo || !canUndo}
                aria-label="Undo"
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {/* ---- Page filters: All / Odd / Even ---- */}
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ alignItems: "center", flexShrink: 0 }}
          role="group"
          aria-label="Page filter"
        >
          {(["all", "odd", "even"] as const).map((filter) => {
            const active = pageFilter === filter;

            return (
              <Button
                key={filter}
                size="small"
                onClick={() => onPageFilterChange?.(filter)}
                disabled={!onPageFilterChange}
                aria-pressed={active}
                sx={{
                  minWidth: 46,
                  height: 26,
                  px: 1,
                  fontSize: 12,
                  textTransform: "capitalize",
                  fontWeight: active ? 700 : 500,
                  color: active ? BRAND : "text.secondary",
                  bgcolor: active ? "#EFEFF7" : "transparent",
                  border: "1px solid",
                  borderColor: active ? BRAND : "#D5D5D5",
                  "&:hover": { bgcolor: "#F4F4FA" },
                }}
              >
                {filter}
              </Button>
            );
          })}
        </Stack>
      </Box>
    </>
  );
}
