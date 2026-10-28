import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import SearchIcon from "@mui/icons-material/Search";
import DownloadIcon from "@mui/icons-material/Download";
import ShareOutlinedIcon from "@mui/icons-material/ShareOutlined";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";

import PdfToolbar, { type PageFilter, type ViewerTool } from "./PdfToolbar";
import PdfViewer from "./PdfViewer";
import type { InspectionDifference } from "./InspectionResults";
import { truncateFileName } from "@/shared/utils/truncateFileName";
import type {
  BarcodeJobStatus,
  BarcodeVerification,
} from "@/shared/api/inspectionApi";
import {
  buildVerificationRows,
  NOT_AVAILABLE,
} from "@/shared/utils/barcodeVerificationFormat";
import { useUploadStore } from "@/store/uploadStore";
import {
  configuredCommentOptions,
  configuredLevelOptions,
  isEditableCommentPlaceholder,
} from "@/shared/utils/setupLevels";
import {
  getInspectionDifferenceComments,
  logAuditEvent,
  updateInspectionDifferenceComment,
} from "@/features/admin/systemApi";
import { useSetupConfig } from "@/shared/hooks/useSetupConfig";
import { downloadBarcodeReport } from "./barcodeReport";

/* -------------------------------------------------------------------------- */
/*                        MedInspect BLACK + BLUE theme                      */
/* -------------------------------------------------------------------------- */

/** Existing MedInspect brand navy (also used by the logo/toolbars). */
const BRAND_NAVY = "#2A276E";
const BRAND_NAVY_DARK = "#1F1D57";
const BRAND_NAVY_LIGHT = "#3F3B99";

const DARK_BLUE_TOOLTIP_SLOT_PROPS = {
  tooltip: { sx: { bgcolor: BRAND_NAVY, color: "#ffffff" } },
  arrow: { sx: { color: BRAND_NAVY } },
} as const;

/**
 * GlobalVision-style findings table columns, in the required order:
 * [Checkbox] | ID | Type | Decoded Value | Grade | Level | Comment.
 *
 * The table uses `table-layout: fixed`, so the header row defines the
 * widths and every body row follows them exactly — the header and body
 * can never drift apart. The compact minimum width keeps all columns
 * readable on a standard desktop display while allowing narrow screens to
 * scroll the table internally.
 */
const TABLE_COLUMN_WIDTHS = {
  checkbox: 36,
  id: 130,
  type: 165,
  decodedValue: 250,
  grade: 85,
  level: 140,
  comment: 180,
} as const;

/** Sum of the compact column widths. */
const TABLE_MIN_WIDTH = 986;

/** One barcode finding, shaped by the existing inspection result model. */
export type BarcodeFinding = {
  /** 1-based sequential barcode result id. */
  id: number;
  /** Detected symbology, e.g. "EAN 13". Comes from the engine. */
  type: string;
  /** Decoded payload. Comes from the engine. */
  decodedValue: string;
  /** Engine grade (A-F) or null when the engine reported none. */
  grade: string | null;
  /** 0-based page the barcode was found on. */
  page: number;
  /** Pixel-space box used to draw the overlay. */
  box: { x: number; y: number; width: number; height: number } | null;
  /**
   * Display size of this finding's page, in the SAME units as `box`.
   *
   * This is the divisor that maps a logical box onto the rendered page. It is
   * carried per finding (rather than assumed) because pages in one document
   * may differ in size and rotation.
   */
  pageWidth?: number | null;
  pageHeight?: number | null;
  /** Basis `box` is expressed in, e.g. "pdf_points". */
  coordinateSystem?: string | null;
  /** Engine-reported quality metrics, when available. */
  quality?: Record<string, string> | null;
  /**
   * Engine-reported heuristic verification block, when available.
   *
   * Optional so the page still renders for results produced before the
   * verifier existed; consumers must treat every field as nullable.
   */
  verification?: BarcodeVerification | null;
};

export type BarcodeResultPageModel = {
  inspectionId: string;
  /** The single uploaded inspection file. */
  fileName: string;
  barcodes: BarcodeFinding[];
};

type SortKey = "id" | "type" | "decodedValue" | "grade" | "level" | "comment";
type SortDirection = "asc" | "desc";

type BarcodeInspectionResultsProps = {
  result: BarcodeResultPageModel;
  /** The uploaded document rendered by the existing viewer. */
  file: File;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /*
   * Live background-job state.
   *
   * Barcode Inspection is started as a background job, so this page is opened
   * as soon as the job exists and then polls it. While `jobStatus` is
   * "processing" the SAME layout is rendered — header, results table, viewer,
   * comments panel — with the engine's real stage shown where the result count
   * normally sits, so the user waits on the result page instead of on a
   * separate loading screen. Terminal states stop the polling and either fill
   * the table with the validated results or surface the error.
   */
  jobStatus?: BarcodeJobStatus | null;
  /** Human label of the engine stage, e.g. "Barcode Detection". */
  stageLabel?: string;
  /** Live page progress reported by the engine; null when unknown. */
  progress?: { currentPage: number; totalPages: number } | null;
  /** Error message to surface when the job failed. */
  error?: string | null;
  /** Cancels the running job. Only used while the job is processing. */
  onCancel?: () => void;
  isCancelling?: boolean;
};

/**
 * Barcode Inspection result page.
 *
 * A SINGLE-FILE, barcode-specific layout: result summary header, a compact
 * barcode results table (checkbox / ID / Type / Decoded Value / Grade / Level /
 * Comment) and the existing document viewer below it with the barcode overlays
 * and the comments panel. It deliberately contains no Master/Sample/Difference
 * concepts — those belong to the other inspection types.
 *
 * Levels, comments, viewer, PDF report, persistence and audit all come from the
 * existing application infrastructure.
 */
export default function BarcodeInspectionResults({
  result,
  file,
  isFullscreen = false,
  onToggleFullscreen,
  jobStatus = null,
  stageLabel,
  progress = null,
  error = null,
  onCancel,
  isCancelling = false,
}: BarcodeInspectionResultsProps) {
  const barcodes = result.barcodes;

  /* The job is still running: the page is live, the table is not filled yet.
     "queued" is the brief state between creating the job and the engine
     taking it — to the user it is still "waiting for results". */
  const isProcessing = jobStatus === "processing" || jobStatus === "queued";
  const isFailed = jobStatus === "failed";
  const isCancelled = jobStatus === "cancelled";
  /* The job will not produce any further results — safe to stop waiting.
     `jobStatus === null` means no live job (results were supplied directly),
     so the page is already final. */
  const isSettled =
    jobStatus === null ||
    jobStatus === "completed" ||
    isFailed ||
    isCancelled;

  /* ------------------------------------------------------------------ */
  /* Selection + viewer state                                           */
  /* ------------------------------------------------------------------ */

  /*
   * Nothing is selected by default: the viewer sits on page 1 at the default
   * zoom until the user clicks a finding (table row, comment card, overlay,
   * or Go to ID).
   */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  /* Eye toggle for the barcode overlays — lives in the summary header. */
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [commentSearch, setCommentSearch] = useState("");
  const [sortPosition, setSortPosition] = useState<"asc" | "desc">("asc");

  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [zoom, setZoom] = useState(100);
  /*
   * Coordinate debug panel, enabled with ?coordDebug=1 in the URL.
   *
   * Deliberately a URL flag rather than a toolbar button: it adds no control
   * to the shipped UI, and the panel itself is additionally gated on
   * `import.meta.env.DEV` inside PdfViewer, so it cannot appear in a
   * production build even if the flag is present.
   */
  const showDebugOverlay =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("coordDebug") === "1";
  const [tool, setTool] = useState<ViewerTool>("pan");
  const [pageFilter, setPageFilter] = useState<PageFilter>("all");
  const [goToId, setGoToId] = useState("");

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }, [sortKey]);

  /* ------------------------------------------------------------------ */
  /* Existing Levels & Comments configuration                           */
  /* ------------------------------------------------------------------ */

  const { data: setupConfig } = useSetupConfig();

  /** Admin-configured comments (Setup Levels & Comments page). */
  const configuredComments = useMemo(() => {
    const options = configuredCommentOptions(setupConfig ?? null);
    const defaultComment = setupConfig?.comments.default1?.trim();
    const all = ["Reviewed", ...(defaultComment ? [defaultComment] : []), ...options];
    return [...new Set(all)];
  }, [setupConfig]);

  /** Admin-configured severity levels (non-empty, de-duplicated). */
  const configuredLevels = useMemo(() => {
    const options = configuredLevelOptions(setupConfig ?? null).filter(
      (value) => value && value.trim() !== "",
    );
    return [...new Set(options)];
  }, [setupConfig]);

  const commentSelections = useUploadStore((state) => state.commentSelections);
  const setCommentSelections = useUploadStore((state) => state.setCommentSelections);
  const levelSelections = useUploadStore((state) => state.levelSelections);
  const setLevelSelections = useUploadStore((state) => state.setLevelSelections);

  const getCommentValue = (id: number) => commentSelections[id] ?? "None";
  const getLevelValue = (id: number) => levelSelections[id] ?? "";

  const handleCommentChange = (id: number, value: string) => {
    setCommentSelections({ ...commentSelections, [id]: value });
    void logAuditEvent({
      event: "DIFFERENCE_COMMENT_UPDATED",
      action: "Update Barcode Comment",
      module: "Barcode Inspection",
      description: `Comment updated for barcode ${id} to "${value}".`,
      inspectionId: result.inspectionId,
      differenceId: id,
      metadata: { comment: value },
    });
  };

  const handleLevelChange = (id: number, value: string) => {
    setLevelSelections({ ...levelSelections, [id]: value });
    if (value) {
      handleCommentChange(id, "Reviewed");
    } else {
      handleCommentChange(id, "None");
    }
    void logAuditEvent({
      event: "DIFFERENCE_LEVEL_CHANGED",
      action: "Update Barcode Level",
      module: "Barcode Inspection",
      description: `Level updated for barcode ${id} to "${value}".`,
      inspectionId: result.inspectionId,
      differenceId: id,
      metadata: { level: value },
    });
  };

  /**
   * Load user comments persisted for THIS inspection so reopening an old
   * inspection shows the comments written previously.
   */
  useEffect(() => {
    if (!result.inspectionId) return;
    let cancelled = false;
    void getInspectionDifferenceComments(result.inspectionId)
      .then((saved) => {
        if (cancelled || saved.length === 0) return;
        const restored: Record<number, string> = {};
        for (const entry of saved) {
          const userComment = (entry.userComment ?? "").trim();
          if (userComment) restored[entry.differenceId] = userComment;
        }
        if (Object.keys(restored).length > 0) {
          setCommentSelections({
            ...useUploadStore.getState().commentSelections,
            ...restored,
          });
        }
      })
      .catch(() => {
        /* Non-critical: without persistence the session still works. */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per inspection
  }, [result.inspectionId]);

  const persistComment = useCallback(
    (id: number, configuredComment: string, userComment: string) => {
      if (!result.inspectionId) return;
      void updateInspectionDifferenceComment(
        result.inspectionId,
        id,
        { configuredComment, userComment },
      ).catch((error) => {
        console.warn("[BARCODE-COMMENT] Failed to persist user comment:", error);
      });
    },
    [result.inspectionId],
  );

  /* ------------------------------------------------------------------ */
  /* Derived data                                                       */
  /* ------------------------------------------------------------------ */

  const sortedBarcodes = useMemo(() => {
    const factor = sortDirection === "asc" ? 1 : -1;

    // No explicit sort -> keep the engine's document order (page, y, x), which
    // is already how the sequential ids were assigned.
    if (sortKey === null) {
      return barcodes;
    }

    return [...barcodes].sort((a, b) => {
      let comparison = 0;
      if (sortKey === "id") comparison = a.id - b.id;
      else if (sortKey === "type") comparison = a.type.localeCompare(b.type);
      else if (sortKey === "decodedValue")
        comparison = a.decodedValue.localeCompare(b.decodedValue);
      else if (sortKey === "grade")
        comparison = (a.grade ?? "").localeCompare(b.grade ?? "");
      else if (sortKey === "level")
        comparison = getLevelValue(a.id).localeCompare(getLevelValue(b.id));
      else if (sortKey === "comment")
        comparison = getCommentValue(a.id).localeCompare(getCommentValue(b.id));
      return comparison * factor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- levels/comments come from the reactive store
  }, [barcodes, sortKey, sortDirection, levelSelections, commentSelections]);

  /** Barcodes for the comments panel, filtered by the search box. */
  const commentCards = useMemo(() => {
    const term = commentSearch.trim().toLowerCase();
    const filtered = barcodes.filter((barcode) => {
      if (!term) return true;
      return (
        barcode.decodedValue.toLowerCase().includes(term) ||
        barcode.type.toLowerCase().includes(term)
      );
    });

    // Same order as the result table (document order unless the user sorted).
    const factor = sortPosition === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "id") return (a.id - b.id) * factor;
      if (sortKey === "type")
        return a.type.localeCompare(b.type) * factor;
      if (sortKey === "decodedValue")
        return a.decodedValue.localeCompare(b.decodedValue) * factor;
      if (sortKey === "grade")
        return (a.grade ?? "").localeCompare(b.grade ?? "") * factor;
      return (a.page - b.page || a.id - b.id) * factor;
    });
  }, [barcodes, commentSearch, sortPosition, sortKey]);

  /**
   * The selected barcode mapped onto the existing overlay shape, so the shared
   * PdfViewer draws the highlight at the engine's real coordinates.
   */
  const selectedFinding: InspectionDifference | null = useMemo(() => {
    const barcode = barcodes.find((item) => item.id === selectedId);
    if (!barcode) return null;
    return {
      id: barcode.id,
      type: "Barcode",
      master: barcode.decodedValue,
      sample: "",
      level: null,
      comment: null,
      page: barcode.page,
      masterBox: barcode.box,
      sampleBox: null,
      barcodeType: barcode.type,
      decodedValue: barcode.decodedValue,
      grade: barcode.grade,
      /* Lets the shared viewer render the barcode hover card, not the
         text-inspection Original/Sample template. */
      barcodeVerification: barcode.verification ?? null,
      coordinateSystem: barcode.coordinateSystem ?? null,
    };
  }, [barcodes, selectedId]);

  /*
   * ------------------------------------------------------------------
   * Page geometry for the overlay mapping.
   * ------------------------------------------------------------------
   * A bbox is expressed in PDF points, and a page is a fixed number of
   * points wide. The viewer therefore needs the DISPLAYED page's size to
   * turn a logical box into CSS pixels:
   *
   *     scaleX = renderedPageWidth / pageWidth
   *
   * PDF.js's viewport already encodes the zoom, so this single ratio is the
   * only scaling applied - there is deliberately no second `* zoom` factor
   * anywhere. Without `pageWidth` the ratio collapses to 1 and the box stops
   * tracking the page, which is exactly the drift this fixes.
   *
   * Keyed by the 0-based page the page model uses, so pages of differing
   * sizes each contribute their own dimensions.
   */
  const pageSizeByPage = useMemo(() => {
    const sizes = new Map<
      number,
      { width: number; height: number }
    >();
    for (const barcode of barcodes) {
      if (
        typeof barcode.pageWidth === "number" &&
        typeof barcode.pageHeight === "number" &&
        barcode.pageWidth > 0 &&
        barcode.pageHeight > 0
      ) {
        sizes.set(barcode.page, {
          width: barcode.pageWidth,
          height: barcode.pageHeight,
        });
      }
    }
    return sizes;
  }, [barcodes]);

  // The page currently on screen (pageNumber is 1-based here).
  const displayedPageSize = pageSizeByPage.get(pageNumber - 1) ?? null;

  const allChecked = barcodes.length > 0 && checkedIds.length === barcodes.length;

  const toggleAll = () => {
    setCheckedIds(allChecked ? [] : barcodes.map((barcode) => barcode.id));
  };

  const toggleOne = (id: number) => {
    setCheckedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  /**
   * Selecting a barcode result (table row ID...Grade, comment card, overlay,
   * or Go to ID) moves the viewer to its page and highlights the overlay at
   * the engine's coordinates. Clicking the already-selected result again
   * deselects it: the overlay disappears and the viewer zooms back out to the
   * default zoom. Table rows and comment cards share this handler, so both
   * stay linked through `selectedId`.
   */
  const handleSelectBarcode = useCallback(
    (barcode: BarcodeFinding) => {
      if (selectedId === barcode.id) {
        setSelectedId(null);
        setZoom(100); /* Deselect = zoom out to the default zoom. */
        return;
      }

      setSelectedId(barcode.id);
      setPageNumber(barcode.page + 1);

      void logAuditEvent({
        event: "BARCODE_RESULT_VIEWED",
        action: "View Barcode Result",
        module: "Barcode Inspection",
        description: `Barcode ${barcode.id} selected. Type=${barcode.type}`,
        metadata: { barcodeId: barcode.id, page: barcode.page },
      });
    },
    [selectedId],
  );

  const handleGoToId = () => {
    const target = Number(goToId);
    if (!Number.isFinite(target) || target <= 0) return;
    const match = barcodes.find((barcode) => barcode.id === target);
    if (match) {
      if (selectedId === match.id) {
        /* Already selected: just make sure the viewer is on its page. */
        setPageNumber(match.page + 1);
      } else {
        handleSelectBarcode(match);
      }
      setGoToId("");
    }
  };

  /** PDF report built from the same data the table shows. */
  const handleDownloadReport = () => {
    void downloadBarcodeReport({
      inspectionId: result.inspectionId,
      fileName: result.fileName,
      barcodes,
      commentSelections,
      levelSelections,
    });
  };

  const handleToggleComments = () => setCommentsOpen((open) => !open);

  const barcodeCount = barcodes.length;
  const countLabel = `${barcodeCount} ${
    barcodeCount === 1 ? "Barcode" : "Barcodes"
  }`;

  /**
   * What the count badge shows. While the job is still running the badge shows
   * the engine's real stage instead of a (zero) result count, so the header
   * reads "Barcode Detection" / "Processing..." as required and then switches
   * to the real count the moment results arrive.
   */
  const headerLabel = isProcessing
    ? stageLabel ?? "Barcode Detection"
    : isFailed
      ? "Failed"
      : isCancelled
        ? "Cancelled"
        : countLabel;

  /** Message shown in the results table while there is nothing to list. */
  const emptyMessage = isProcessing
    ? progress && progress.totalPages > 0
      ? `${stageLabel ?? "Barcode Detection"} — Processing... (page ${progress.currentPage} of ${progress.totalPages})`
      : `${stageLabel ?? "Barcode Detection"} — Processing...`
    : isFailed
      ? error ?? "Barcode inspection failed. Please try again."
      : isCancelled
        ? "Inspection cancelled."
        : "No barcodes detected";

  const renderSortIcon = (key: SortKey) =>
    sortKey === key ? (
      sortDirection === "asc" ? (
        <ArrowUpwardIcon sx={{ fontSize: 14 }} />
      ) : (
        <ArrowDownwardIcon sx={{ fontSize: 14 }} />
      )
    ) : null;

  const sortableHeader = (
    label: string,
    key: SortKey,
    width: number,
    leadingContent?: ReactNode,
  ) => (
    <TableCell
      onClick={() => toggleSort(key)}
      sx={{
        width,
        minWidth: width,
        /*
         * A sticky header keeps its position but NOT the <TableRow>'s painted
         * background — without its own background the white label scrolls
         * over the white body rows and becomes invisible. Paint it here.
         */
        bgcolor: BRAND_NAVY,
        zIndex: 2,
        fontWeight: 700,
        fontSize: 12,
        color: "#FFFFFF",
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
        py: 0.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {leadingContent}
          {label}
          {renderSortIcon(key)}
        </Box>
    </TableCell>
  );

  return (
    <Box
      data-testid="barcode-inspection-results"
      sx={{
        width: "100%",
        height: "calc(100vh - 72px)",
        display: "flex",
        flexDirection: "column",
        bgcolor: "#FFFFFF",
        overflow: "hidden",
      }}
    >
      {/* ==========================================================
          RESULT SUMMARY HEADER
         ========================================================== */}
      <Box
        sx={{
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          borderBottom: "1px solid #D5D9DD",
          bgcolor: "#FFFFFF",
          flexShrink: 0,
        }}
      >
        {/* Dynamic barcode count badge (never hard-coded). While the job runs
            it carries the engine's real stage; if the job failed it turns red
            so a failure is never mistaken for a long-running inspection. */}
        <Box
          sx={{
            px: 1.2,
            height: 30,
            display: "flex",
            alignItems: "center",
            borderRadius: 2,
            bgcolor: isFailed ? "#C62828" : BRAND_NAVY,
            boxShadow: "0 2px 6px rgba(27, 27, 60, 0.25)",
          }}
        >
          <Typography
            sx={{
              fontSize: 14,
              fontWeight: 700,
              color: "#FFFFFF",
              whiteSpace: "nowrap",
            }}
          >
            {headerLabel}
          </Typography>
        </Box>

        {/* Overlay visibility eye remains in the summary header. */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Tooltip
            title={
              overlaysVisible ? "Hide barcode overlays" : "Show barcode overlays"
            }
            arrow
            slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}
          >
            <IconButton
              size="small"
              onClick={() => setOverlaysVisible((visible) => !visible)}
              sx={iconButtonSx}
            >
              {overlaysVisible ? (
                <VisibilityOutlinedIcon fontSize="small" />
              ) : (
                <VisibilityOffOutlinedIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </Box>

        <Typography
          variant="body2"
          noWrap
          title={result.fileName}
          sx={{ minWidth: 0, flex: 1, color: "#30343B" }}
        >
          <Box component="span" sx={{ fontWeight: 700 }}>
            Filename:
          </Box>{" "}
          {truncateFileName(result.fileName, 40)}
        </Typography>

        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          {/* While the job runs, the existing Cancel action is available here. */}
          {isProcessing && onCancel && (
            <Button
              size="small"
              variant="outlined"
              onClick={onCancel}
              disabled={isCancelling}
              data-testid="barcode-results-cancel"
              sx={{
                mr: 0.5,
                height: 28,
                px: 1.5,
                fontSize: 12.5,
                fontWeight: 600,
                textTransform: "none",
                color: BRAND_NAVY,
                borderColor: BRAND_NAVY,
                "&:hover": {
                  borderColor: BRAND_NAVY,
                  bgcolor: "rgba(42,39,110,0.08)",
                },
                "&.Mui-disabled": {
                  color: "#9AA0AA",
                  borderColor: "#C9CDD4",
                },
              }}
            >
              {isCancelling ? "Cancelling..." : "Cancel"}
            </Button>
          )}

          <Tooltip
            title="Toggle the barcode results panel"
            arrow
            slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}
          >
            <IconButton
              size="small"
              onClick={handleToggleComments}
              sx={iconButtonSx}
            >
              <ViewSidebarOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip
            title="Search barcodes"
            arrow
            slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}
          >
            <IconButton
              size="small"
              onClick={handleToggleComments}
              sx={iconButtonSx}
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip
            title="Barcode list"
            arrow
            slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}
          >
            <IconButton
              size="small"
              onClick={handleToggleComments}
              sx={iconButtonSx}
            >
              <FormatListBulletedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip
            title="Comments panel"
            arrow
            slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}
          >
            <IconButton
              size="small"
              onClick={handleToggleComments}
              sx={iconButtonSx}
            >
              <ShareOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip
            title={
              isSettled
                ? "Download the PDF report"
                : "Available once the inspection has finished"
            }
            arrow
            slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}
          >
            <IconButton
              size="small"
              onClick={handleDownloadReport}
              disabled={!isSettled}
              sx={iconButtonSx}
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {/* ==========================================================
          BARCODE RESULTS TABLE
         ========================================================== */}
      <Box sx={{ borderBottom: "1px solid #D5D9DD", flexShrink: 0 }}>
        <TableContainer sx={{ maxHeight: 190 }}>
          <Table
            size="small"
            stickyHeader
            aria-label="Barcode results"
            sx={{
              tableLayout: "fixed",
              width: "100%",
              minWidth: TABLE_MIN_WIDTH,
            }}
          >
            <TableHead>
              <TableRow sx={{ bgcolor: BRAND_NAVY }}>
                <TableCell
                  padding="checkbox"
                  sx={{
                    py: 0.5,
                    width: TABLE_COLUMN_WIDTHS.checkbox,
                    minWidth: TABLE_COLUMN_WIDTHS.checkbox,
                    bgcolor: BRAND_NAVY,
                    zIndex: 2,
                  }}
                >
                  <Checkbox
                    size="small"
                    checked={allChecked}
                    indeterminate={checkedIds.length > 0 && !allChecked}
                    onChange={toggleAll}
                    sx={checkboxOnDarkSx}
                    slotProps={{ input: { "aria-label": "Select all barcodes" } }}
                  />
                </TableCell>

                {sortableHeader(
                  "ID",
                  "id",
                  TABLE_COLUMN_WIDTHS.id,
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Typography
                      variant="caption"
                      sx={{ color: "#FFFFFF", fontSize: 10, lineHeight: 1 }}
                    >
                      Go to ID
                    </Typography>
                    <TextField
                      size="small"
                      value={goToId}
                      onChange={(event) => setGoToId(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleGoToId();
                        }
                      }}
                      placeholder="ID"
                      sx={{
                        width: 52,
                        bgcolor: "#FFFFFF",
                        borderRadius: 0.5,
                        "& .MuiInputBase-root": { height: 26 },
                        "& input": { py: 0.25, px: 0.75, fontSize: 12 },
                      }}
                      slotProps={{
                        htmlInput: { "aria-label": "Go to barcode ID" },
                      }}
                    />
                  </Box>,
                )}
                {sortableHeader("Type", "type", TABLE_COLUMN_WIDTHS.type)}
                {sortableHeader(
                  "Decoded Value",
                  "decodedValue",
                  TABLE_COLUMN_WIDTHS.decodedValue,
                )}
                {sortableHeader("Grade", "grade", TABLE_COLUMN_WIDTHS.grade)}
                {sortableHeader("Level", "level", TABLE_COLUMN_WIDTHS.level)}
                {sortableHeader(
                  "Comment",
                  "comment",
                  TABLE_COLUMN_WIDTHS.comment,
                )}
              </TableRow>
            </TableHead>

            <TableBody>
              {sortedBarcodes.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    align="center"
                    sx={{ py: 3 }}
                    data-testid="barcode-results-empty"
                  >
                    {isProcessing ? (
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <CircularProgress
                          size={18}
                          aria-label="Barcode inspection in progress"
                          sx={{ color: BRAND_NAVY }}
                        />
                        <Typography variant="body2" color="text.secondary">
                          {emptyMessage}
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography
                        variant="body2"
                        color={isFailed ? "error" : "text.secondary"}
                      >
                        {emptyMessage}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              )}

              {sortedBarcodes.map((barcode) => (
                <BarcodeRow
                  key={barcode.id}
                  barcode={barcode}
                  isSelected={barcode.id === selectedId}
                  isChecked={checkedIds.includes(barcode.id)}
                  configuredLevels={configuredLevels}
                  configuredComments={configuredComments}
                  levelValue={getLevelValue(barcode.id)}
                  commentValue={getCommentValue(barcode.id)}
                  onSelect={handleSelectBarcode}
                  onToggleCheck={toggleOne}
                  onLevelChange={handleLevelChange}
                  onCommentChange={handleCommentChange}
                  onCommentPersist={persistComment}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>

      </Box>

      {/* ==========================================================
          VIEWER + COMMENTS PANEL
         ========================================================== */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <Box
          sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
        >
          {/* Existing viewer toolbar — kept intact. */}
          <PdfToolbar
            pageNumber={pageNumber}
            numPages={Math.max(1, numPages)}
            pageNavigationAtTop
            zoom={zoom}
            onPageChange={setPageNumber}
            onZoomChange={setZoom}
            onToggleSidebar={handleToggleComments}
            sidebarOpen={commentsOpen}
            tool={tool}
            onToolChange={setTool}
            onComments={handleToggleComments}
            onRefresh={() => {
              /* Refresh re-reads stored results; it never re-runs inspection. */
            }}
            onUndo={() => {}}
            canUndo={false}
            pageFilter={pageFilter}
            onPageFilterChange={setPageFilter}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
          />

          {/* Existing document viewer with the barcode overlays. */}
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <PdfViewer
              file={file}
              side="master"
              inspectionType="barcode"
              pageNumber={pageNumber}
              pageFollowsParent
              zeroBasedPageIndex
              zoom={zoom}
              compact
              /*
               * THE coordinate-system fix: hand the viewer the displayed
               * page's size, in the same units as the bbox. This makes
               * `renderedPageWidth / pageWidth` the single scale factor, so
               * the overlay tracks the page at every zoom level.
               */
              naturalWidth={displayedPageSize?.width}
              naturalHeight={displayedPageSize?.height}
              selectedDifference={overlaysVisible ? selectedFinding : null}
              onOverlayClick={(finding) => {
                const match = barcodes.find((barcode) => barcode.id === finding.id);
                if (match) handleSelectBarcode(match);
              }}
              onNumPagesChange={setNumPages}
              showDebugOverlay={showDebugOverlay}
            />
          </Box>
        </Box>

        {/* Right-side comments panel. */}
        {commentsOpen && (
          <Box
            data-testid="barcode-comments-panel"
            sx={{
              width: 300,
              flexShrink: 0,
              borderLeft: "1px solid #E5E7EB",
              display: "flex",
              flexDirection: "column",
              bgcolor: "#FAFAFB",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                px: 1.5,
                py: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid #E5E7EB",
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Comments ({barcodeCount})
              </Typography>
              <Tooltip
                title={`Sort by position (${
                  sortPosition === "asc" ? "ascending" : "descending"
                })`}
                arrow
                slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}
              >
                <IconButton
                  size="small"
                  onClick={() =>
                    setSortPosition((direction) =>
                      direction === "asc" ? "desc" : "asc",
                    )
                  }
                >
                  {sortPosition === "asc" ? (
                    <UnfoldMoreIcon fontSize="small" />
                  ) : (
                    <UnfoldLessIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>

            <Box sx={{ px: 1.5, py: 1 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search comments"
                value={commentSearch}
                onChange={(event) => setCommentSearch(event.target.value)}
                slotProps={{ htmlInput: { "aria-label": "Search comments" } }}
              />
            </Box>

            <Box sx={{ flex: 1, overflowY: "auto", px: 1.5, pb: 1.5 }}>
              <Typography
                variant="caption"
                sx={{ color: "#535A62", display: "block", mb: 0.5 }}
              >
                Position
              </Typography>

              {commentCards.map((barcode) => (
                <BarcodeCommentCard
                  key={barcode.id}
                  barcode={barcode}
                  isSelected={barcode.id === selectedId}
                  comment={getCommentValue(barcode.id)}
                  onSelect={handleSelectBarcode}
                />
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Table row + comment card                          */
/* -------------------------------------------------------------------------- */

type BarcodeRowProps = {
  barcode: BarcodeFinding;
  isSelected: boolean;
  isChecked: boolean;
  configuredLevels: string[];
  configuredComments: string[];
  levelValue: string;
  commentValue: string;
  onSelect: (barcode: BarcodeFinding) => void;
  onToggleCheck: (id: number) => void;
  onLevelChange: (id: number, value: string) => void;
  onCommentChange: (id: number, value: string) => void;
  onCommentPersist: (
    id: number,
    configuredComment: string,
    userComment: string,
  ) => void;
};

/** One row of the barcode results table. */
function BarcodeRow({
  barcode,
  isSelected,
  isChecked,
  configuredLevels,
  configuredComments,
  levelValue,
  commentValue,
  onSelect,
  onToggleCheck,
  onLevelChange,
  onCommentChange,
  onCommentPersist,
}: BarcodeRowProps) {
  return (
    <TableRow
      hover
      selected={isSelected}
      sx={{
        "&.Mui-selected": {
          bgcolor: "rgba(42,39,110,0.12)",
          "&:hover": { bgcolor: "rgba(42,39,110,0.18)" },
        },
      }}
    >
      <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          size="small"
          checked={isChecked}
          onChange={() => onToggleCheck(barcode.id)}
          slotProps={{ input: { "aria-label": `Select barcode ${barcode.id}` } }}
        />
      </TableCell>

      <TableCell
        sx={{ ...cellSx, cursor: "pointer" }}
        onClick={() => onSelect(barcode)}
      >
        {barcode.id}
      </TableCell>

      <TableCell
        sx={{ ...cellSx, cursor: "pointer" }}
        onClick={() => onSelect(barcode)}
      >
        <Typography variant="body2" noWrap sx={cellTextSx}>
          {barcode.type || "—"}
        </Typography>
      </TableCell>

      <TableCell
        sx={{ ...cellSx, cursor: "pointer" }}
        onClick={() => onSelect(barcode)}
      >
        <Typography variant="body2" noWrap sx={cellTextSx}>
          {barcode.decodedValue || "—"}
        </Typography>
      </TableCell>

      <TableCell
        sx={{ ...cellSx, cursor: "pointer" }}
        onClick={() => onSelect(barcode)}
      >
        {barcode.grade ? (
          barcode.grade
        ) : (
          <Typography variant="body2" color="text.secondary">
            —
          </Typography>
        )}
      </TableCell>

      {/* Level — from the existing Setup Levels & Comments configuration. */}
      <TableCell sx={cellSx} onClick={(event) => event.stopPropagation()}>
        <Select
          size="small"
          value={levelValue}
          displayEmpty
          onChange={(event) => onLevelChange(barcode.id, event.target.value)}
          renderValue={(value) => value || "None"}
          sx={compactSelectSx}
        >
          <MenuItem value="">None</MenuItem>
          {configuredLevels.map((level) => (
            <MenuItem key={level} value={level}>
              {level}
            </MenuItem>
          ))}
        </Select>
      </TableCell>

      {/* Comment — from the existing Comments configuration; placeholders are
          replaceable by the reviewer and the replacement is persisted. */}
      <TableCell sx={cellSx} onClick={(event) => event.stopPropagation()}>
        <Select
          size="small"
          value={commentValue}
          displayEmpty
          onChange={(event) => onCommentChange(barcode.id, event.target.value)}
          renderValue={(value) =>
            isEditableCommentPlaceholder(value) ? (
              <Box
                component="span"
                sx={{ cursor: "text" }}
                onDoubleClick={() => {
                  const typed = window.prompt("Enter comment", "");
                  if (typed && typed.trim()) {
                    onCommentChange(barcode.id, typed.trim());
                    onCommentPersist(barcode.id, value, typed.trim());
                  }
                }}
              >
                {value}
              </Box>
            ) : (
              value || "None"
            )
          }
          sx={compactSelectSx}
        >
          <MenuItem value="None">None</MenuItem>
          {configuredComments.map((comment) => (
            <MenuItem key={comment} value={comment}>
              {comment}
            </MenuItem>
          ))}
        </Select>
      </TableCell>
    </TableRow>
  );
}

type BarcodeCommentCardProps = {
  barcode: BarcodeFinding;
  isSelected: boolean;
  comment: string;
  onSelect: (barcode: BarcodeFinding) => void;
};

/** One barcode card in the right-hand comments panel. */
function BarcodeCommentCard({
  barcode,
  isSelected,
  comment,
  onSelect,
}: BarcodeCommentCardProps) {
  const verificationRows = useMemo(
    () => buildVerificationRows(barcode.verification),
    [barcode.verification],
  );
  const hasVerification = verificationRows.length > 0;

  return (
    <Box
      onClick={() => onSelect(barcode)}
      sx={{
        width: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        p: 1,
        mb: 0.75,
        borderRadius: 1,
        cursor: "pointer",
        border: "1px solid",
        borderColor: isSelected ? BRAND_NAVY : "#E5E7EB",
        bgcolor: isSelected ? "rgba(42,39,110,0.06)" : "#FFFFFF",
        "&:hover": { borderColor: BRAND_NAVY_LIGHT },
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Barcode {barcode.id}
      </Typography>

      <Typography variant="caption" sx={commentLabelSx}>
        Decoded Value:
      </Typography>
      <Typography variant="body2" sx={commentValueSx}>
        {barcode.decodedValue || "—"}
      </Typography>

      <Typography variant="caption" sx={commentLabelSx}>
        Type:
      </Typography>
      <Typography variant="body2" sx={commentValueSx}>
        {barcode.type || "—"}
      </Typography>

      <Typography variant="caption" sx={commentLabelSx}>
        Grade:
      </Typography>
      <Typography variant="body2" sx={commentValueSx}>
        {barcode.grade || NOT_AVAILABLE}
      </Typography>

      {/*
       * Heuristic verification metrics. Rendered as a compact two-column grid
       * so a long payload stays scannable in the narrow sidebar. Rows the
       * engine could not measure read "N/A" rather than being hidden, so the
       * reader can tell "not measurable" from "not reported".
       */}
      {hasVerification && (
        <Box
          sx={{
            mt: 0.75,
            pt: 0.75,
            borderTop: "1px solid #E5E7EB",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            columnGap: 1,
            rowGap: 0.25,
            minWidth: 0,
          }}
        >
          {verificationRows.map((row) => (
            <Box
              key={row.key}
              sx={{
                display: "contents",
              }}
            >
              <Typography
                variant="caption"
                sx={{ ...verificationLabelSx, minWidth: 0, overflowWrap: "anywhere" }}
              >
                {row.label}:
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  ...verificationValueSx,
                  minWidth: 0,
                  // "N/A" is a deliberate absence, not a measurement, so it is
                  // dimmed to keep real numbers visually dominant.
                  color: row.value === NOT_AVAILABLE ? "#9AA0A6" : "#1F2328",
                }}
              >
                {row.value}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {barcode.verification?.error && (
        <Typography variant="caption" sx={{ color: "#B3261E", mt: 0.5 }}>
          {barcode.verification.error}
        </Typography>
      )}

      {comment !== "None" && (
        <>
          <Typography variant="caption" sx={commentLabelSx}>
            Comment:
          </Typography>
          <Typography variant="body2" sx={commentValueSx}>
            {comment}
          </Typography>
        </>
      )}
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Styles                                    */
/* -------------------------------------------------------------------------- */

const iconButtonSx = {
  bgcolor: BRAND_NAVY,
  color: "#FFFFFF",
  "&:hover": { bgcolor: BRAND_NAVY_DARK },
  "&.Mui-disabled": { bgcolor: "#C9CDD4", color: "#8A8F98" },
};

const checkboxOnDarkSx = {
  color: "#FFFFFF",
  "&.Mui-checked": { color: "#FFFFFF" },
  "&.MuiCheckbox-indeterminate": { color: "#FFFFFF" },
};

/*
 * Column widths are enforced by the fixed table layout (TABLE_COLUMN_WIDTHS),
 * so cells must not impose their own max widths — that would shrink columns
 * below the GlobalVision-style sizes. Long Type / Decoded Value content still
 * truncates with an ellipsis (noWrap) and shows the full text on hover.
 */
const cellSx = { py: 0.35, fontSize: 12.5 };

const cellTextSx = { fontSize: 13 };

const compactSelectSx = {
  width: "100%",
  fontSize: 12,
  minHeight: 26,
  height: 26,
  "& .MuiSelect-select": { py: 0.25, px: 1, fontSize: 12 },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "#D0D0D0" },
};

const commentLabelSx = {
  color: "#6B7280",
  display: "block",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  mt: 0.5,
};

const commentValueSx = { fontSize: 13, wordBreak: "break-word" };

/*
 * Verification metric rows use a tighter, non-uppercase style than the
 * section labels above: there are sixteen of them in a narrow sidebar, so they
 * are set in sentence case to stay compact and readable, and values are
 * right-aligned in the grid's second column.
 */
const verificationLabelSx = {
  color: "#4B5563",
  fontSize: 11,
  lineHeight: 1.5,
};

const verificationValueSx = {
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.5,
  textAlign: "right" as const,
  whiteSpace: "normal" as const,
  overflowWrap: "anywhere" as const,
};
