import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Snackbar,
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

import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffTwoToneIcon from "@mui/icons-material/VisibilityOffTwoTone";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import ArrowForwardOutlinedIcon from "@mui/icons-material/ArrowForwardOutlined";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import ShareIcon from "@mui/icons-material/Share";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import DownloadIcon from "@mui/icons-material/Download";
import CompareIcon from "@mui/icons-material/Compare";
import CropFreeIcon from "@mui/icons-material/CropFree";

import ViewerPane from "./ViewerPane";
import ReportOptionsDialog, {
  type ReportOptions,
} from "./ReportOptionsDialog";
import type {
  BarcodeVerification,
  BoundingBox,
} from "@/shared/api/inspectionApi";
import {
  cropInspect,
  shareInspectionReport,
  type CropRunResult,
} from "@/shared/api/inspectionApi";
import { truncateFileName } from "@/shared/utils/truncateFileName";
import { getSession } from "@/shared/utils/auth";
import {
  broadcastStateUpdate,
  subscribeToStateRequests,
  useUploadStore,
  type InspectionType,
} from "@/store/uploadStore";
import {
  downloadInspectionPdf,
  generateInspectionReportPdfBlob,
} from "@/shared/utils/pdfReportGenerator";
import { useSetupConfig } from "@/shared/hooks/useSetupConfig";
import {
  configuredLevelOptions,
  configuredCommentOptions,
  isEditableCommentPlaceholder,
} from "@/shared/utils/setupLevels";
import {
  getInspectionDifferenceComments,
  logAuditEvent,
  updateInspectionDifferenceComment,
} from "@/features/admin/systemApi";

export type DifferenceType =
  | "Change"
  | "Insertion"
  | "Deletion"
  | "Hyphen"
  | "Location"
  | "Case"
  | "Bold"
  | "Italic"
  | "Color"
  | "Font Type"
  | "Mixed Font"
  | "Size"
  | "Sub/Super"
  | "Underline"
  | "Line Break"
  | string;

export type InspectionDifference = {
  id: number;
  type: DifferenceType;
  master: string;
  sample: string;
  level: string | null;
  comment: string | null;
  page?: number;
  masterBox?: BoundingBox | null;
  sampleBox?: BoundingBox | null;
  barcodeType?: string | null;
  decodedValue?: string | null;
  grade?: string | null;
  brailleMetrics?: {
    lines?: number;
    characters?: number;
    dots?: number;
    dotHMillimeters?: number | null;
    dotVMillimeters?: number | null;
    characterMillimeters?: number | null;
    wordMillimeters?: number | null;
    lineMillimeters?: number | null;
  } | null;
  status?: string | null;
  /**
   * Heuristic verification block for a barcode finding.
   *
   * Present only for barcode inspections. The shared viewer uses it to render
   * the barcode-specific hover card instead of the text-inspection
   * Original/Sample template, which is meaningless for a barcode.
   */
  barcodeVerification?: BarcodeVerification | null;
  /**
   * Basis the finding's boxes are expressed in, e.g. `"pdf_points"`.
   *
   * Used by the development-only coordinate debug panel to prove which basis
   * the viewer is mapping from.
   */
  coordinateSystem?: string | null;
};

const hasNavigableBrailleRegion = (
  difference: InspectionDifference | null
): boolean => {
  if (
    !difference ||
    typeof difference.page !== "number" ||
    !Number.isInteger(difference.page) ||
    difference.page < 0
  ) {
    return false;
  }

  const box = difference.masterBox;
  return Boolean(
    box &&
      [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
      box.width > 0 &&
      box.height > 0
  );
};

export type CharacterDifference = {
  masterChar: string;
  sampleChar: string;
  type: "equal" | "change" | "insertion" | "deletion";
  index: number;
};

const DARK_BLUE_TOOLTIP_SLOT_PROPS = {
  tooltip: {
    sx: {
      bgcolor: "#2A276E",
      color: "#ffffff",
    },
  },
  arrow: {
    sx: { color: "#2A276E" },
  },
} as const;


/**
 * Ligature normalization for the character-comparison layer ONLY.
 *
 * PDFs frequently encode "fl", "fi", etc. as a single ligature glyph
 * (U+FB00–U+FB04). PyMuPDF usually expands these to plain text during
 * extraction, but when a ligature survives into a finding's master/sample
 * strings, the character panel would compare one glyph against two plain
 * characters and render it as one box on one row and two boxes on the
 * other. Expanding ligatures here makes both sides align character-for-
 * character. Extraction, matching, checkers and reports are NOT touched —
 * this runs purely on the display/comparison strings.
 *
 * Only the Unicode ligature range is rewritten; all other text (accents,
 * symbols, CJK, etc.) passes through unchanged, so normal PDF text is
 * never corrupted.
 */
const LIGATURE_MAP: Record<string, string> = {
  "\uFB00": "ff", // ﬀ
  "\uFB01": "fi", // ﬁ
  "\uFB02": "fl", // ﬂ
  "\uFB03": "ffi", // ﬃ
  "\uFB04": "ffl", // ﬄ
};

function normalizeLigatures(text: string): string {
  if (!text) return text;
  // Fast path: skip strings with no ligature-range characters at all.
  let hasLigature = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xfb00 && code <= 0xfb04) {
      hasLigature = true;
      break;
    }
  }
  if (!hasLigature) return text;

  let out = "";
  for (const ch of text) {
    out += LIGATURE_MAP[ch] ?? ch;
  }
  return out;
}

/**
 * Computes a character-level alignment between two strings
 * using a dynamic-programming (Levenshtein) approach.
 *
 * Returns an array of aligned character pairs where each
 * entry represents one aligned position.
 */
function calculateCharacterDifferences(
  master: string,
  sample: string
): CharacterDifference[] {
  // Normalize ligatures so a single ﬂ glyph compares as "f","l" —
  // one box per character on BOTH rows (see normalizeLigatures above).
  master = normalizeLigatures(master);
  sample = normalizeLigatures(sample);

  const m = master.length;
  const n = sample.length;

  // DP table for edit distance
  const dp: number[][] = Array.from(
    { length: m + 1 },
    () => Array<number>(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }

  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = master[i - 1] === sample[j - 1] ? 0 : 1;

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  // Backtrack to build the alignment.
  //
  // IMPORTANT: insertion and deletion MUST be checked BEFORE substitution
  // (change). When several moves are equally optimal (e.g. when no characters
  // match), checking substitution first would consume the tail of BOTH strings
  // simultaneously, which right-aligns the shorter string to the end of the
  // strip. By preferring insertion/deletion first, the extra characters of the
  // longer string are drained from the back, keeping the alignment anchored to
  // the correct left-to-right logical position.
  const alignment: CharacterDifference[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      dp[i][j] === dp[i - 1][j - 1] &&
      master[i - 1] === sample[j - 1]
    ) {
      // Equal characters
      alignment.unshift({
        masterChar: master[i - 1],
        sampleChar: sample[j - 1],
        type: "equal",
        index: 0,
      });
      i--;
      j--;
    } else if (
      j > 0 &&
      dp[i][j] === dp[i][j - 1] + 1
    ) {
      // Insertion: sample char has no master counterpart
      alignment.unshift({
        masterChar: "",
        sampleChar: sample[j - 1],
        type: "insertion",
        index: 0,
      });
      j--;
    } else if (
      i > 0 &&
      dp[i][j] === dp[i - 1][j] + 1
    ) {
      // Deletion: master char has no sample counterpart
      alignment.unshift({
        masterChar: master[i - 1],
        sampleChar: "",
        type: "deletion",
        index: 0,
      });
      i--;
    } else if (
      i > 0 &&
      j > 0 &&
      dp[i][j] === dp[i - 1][j - 1] + 1
    ) {
      // Changed character
      alignment.unshift({
        masterChar: master[i - 1],
        sampleChar: sample[j - 1],
        type: "change",
        index: 0,
      });
      i--;
      j--;
    } else if (j > 0) {
      // Fallback: sample char is extra at the current position
      alignment.unshift({
        masterChar: "",
        sampleChar: sample[j - 1],
        type: "insertion",
        index: 0,
      });
      j--;
    } else {
      // Fallback: master char is extra at the current position
      alignment.unshift({
        masterChar: master[i - 1],
        sampleChar: "",
        type: "deletion",
        index: 0,
      });
      i--;
    }
  }

  // Assign final indices
  return alignment.map((item, idx) => ({
    ...item,
    index: idx,
  }));
}

export type PageDimensions = {
  page: number;
  masterWidth?: number;
  masterHeight?: number;
  sampleWidth?: number;
  sampleHeight?: number;
  sampleImage?: string;
};

export type InspectionResult = {
  inspectionId: string;
  inspectionType: InspectionType;
  masterFileName: string;
  sampleFileName: string;
  totalDifferences: number;
  differences: InspectionDifference[];
  pages?: PageDimensions[];
  brailleLanguage?: string;
  inspectionStatus?: string;
};

const getBrailleFindingStatus = (
  metrics: InspectionDifference["brailleMetrics"]
) => {
  const dotHeight = metrics?.dotHMillimeters;
  const dotVertical = metrics?.dotVMillimeters;
  const hasDotMeasurements =
    typeof dotHeight === "number" &&
    Number.isFinite(dotHeight) &&
    typeof dotVertical === "number" &&
    Number.isFinite(dotVertical);

  if (
    (typeof dotHeight === "number" && dotHeight < 2.5) ||
    (typeof dotVertical === "number" && dotVertical < 2.5)
  ) {
    return "Failed";
  }
  return hasDotMeasurements ? "Pass" : "Unavailable";
};

type InspectionResultsProps = {
  result: InspectionResult;
  masterFile: File;
  sampleFile: File;
  selectedDifference?: InspectionDifference | null;
  onDifferenceSelect?: (difference: InspectionDifference | null) => void;
  onRefreshInspection?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
};

export default function InspectionResults({
  result,
  masterFile,
  sampleFile,
  selectedDifference,
  onDifferenceSelect,
  onRefreshInspection,
  isFullscreen = false,
  onToggleFullscreen,
}: InspectionResultsProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<number | null>(
    null
  );

  const [selectedCharacterIndex, setSelectedCharacterIndex] = useState(0);
  const [lastDifferenceId, setLastDifferenceId] = useState<number | null>(null);
  const [barcodeDetailsOpen, setBarcodeDetailsOpen] = useState(false);
  const [barcodeFindingsOpen, setBarcodeFindingsOpen] = useState(false);
  const [brailleFindingsOpen, setBrailleFindingsOpen] = useState(true);
  const brailleOpenZoomMenuRef = useRef<(() => void) | null>(null);
  const [brailleGoToId, setBrailleGoToId] = useState("");
  const [brailleGoToError, setBrailleGoToError] = useState("");
  const isBarcode = result.inspectionType === "barcode";
  const isBraille = result.inspectionType === "braille";
  const isSingleDocument = isBarcode || isBraille;
  const brailleFindingRefs = useRef(new Map<number, HTMLButtonElement>());
  const [brailleConnectorTargetRect, setBrailleConnectorTargetRect] = useState<{
    findingId: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);

  const characterStripRef = useRef<HTMLDivElement | null>(null);
  const selectedCharacterRef = useRef<HTMLDivElement | null>(null);

  const effectiveSelectedId = isBraille
    ? selectedDifference?.id ?? null
    : selectedDifference?.id ??
      internalSelectedId ??
      (isBarcode ? result.differences[0]?.id ?? null : null);

  const selectedDifferenceData =
    result.differences.find((difference) => difference.id === effectiveSelectedId) ??
    null;
  const viewerDifference =
    isBraille && !hasNavigableBrailleRegion(selectedDifferenceData)
      ? null
      : selectedDifferenceData;
  const updateBrailleConnectorTarget = useCallback(() => {
    const activeEntry =
      effectiveSelectedId === null
        ? null
        : brailleFindingRefs.current.get(effectiveSelectedId) ?? null;
    const rect = activeEntry?.getBoundingClientRect();
    if (!isBraille || effectiveSelectedId === null || !rect) {
      setBrailleConnectorTargetRect(null);
      return;
    }

    setBrailleConnectorTargetRect((previous) =>
      previous &&
      previous.findingId === effectiveSelectedId &&
      Math.abs(previous.left - rect.left) < 0.5 &&
      Math.abs(previous.top - rect.top) < 0.5 &&
      Math.abs(previous.right - rect.right) < 0.5 &&
      Math.abs(previous.bottom - rect.bottom) < 0.5
        ? previous
        : {
            findingId: effectiveSelectedId,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          }
    );
  }, [effectiveSelectedId, isBraille]);

  useEffect(() => {
    if (!isBraille) {
      return;
    }

    const entry =
      effectiveSelectedId === null
        ? null
        : brailleFindingRefs.current.get(effectiveSelectedId) ?? null;
    if (!entry) {
      setBrailleConnectorTargetRect(null);
      return;
    }

    entry.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    let frame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateBrailleConnectorTarget);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(entry);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    scheduleUpdate();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [effectiveSelectedId, isBraille, updateBrailleConnectorTarget]);
  const handleSelect = useCallback(
    (difference: InspectionDifference) => {
      // Toggle: clicking the already-selected difference deselects it so the
      // PDF returns to its normal (zoomed-out) view.
      if (effectiveSelectedId === difference.id) {
        if (isBarcode) setBarcodeDetailsOpen(false);
        if (onDifferenceSelect) {
          onDifferenceSelect(null);
        } else {
          setInternalSelectedId(null);
        }
        return;
      }
      if (isBarcode) {
        setBarcodeDetailsOpen(true);
      }
      if (onDifferenceSelect) {
        onDifferenceSelect(difference);
      } else {
        setInternalSelectedId(difference.id);
      }
    },
    [onDifferenceSelect, effectiveSelectedId, isBarcode]
  );
  const handleBrailleGoToId = useCallback(() => {
    const id = Number(brailleGoToId.trim());
    if (!Number.isInteger(id) || id < 1) {
      setBrailleGoToError("Enter a valid finding ID.");
      return;
    }

    const difference = result.differences.find((finding) => finding.id === id);
    if (!difference) {
      setBrailleGoToError(`Finding ${id} was not found.`);
      return;
    }

    setBrailleGoToError("");
    handleSelect(difference);
  }, [brailleGoToId, handleSelect, result.differences]);

  const differenceCount = result.totalDifferences;

  /* ------------------------------------------------------------------ */
  /* Comment / status management                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Admin-configured comments (Setup Levels & Comments page). The default
   * comment comes first, followed by every non-empty custom comment.
   */
  const { data: setupConfig } = useSetupConfig();
  const configuredComments = useMemo(() => {
    const options = configuredCommentOptions(setupConfig ?? null);
    const defaultComment = setupConfig?.comments.default1?.trim();
    const all = ["Reviewed", ...(defaultComment ? [defaultComment] : []), ...options];
    return [...new Set(all)];
  }, [setupConfig]);

  /** Admin-configured severity levels (non-empty, de-duplicated). */
  const configuredLevels = useMemo(() => {
    const options = configuredLevelOptions(setupConfig ?? null).filter(
      (value) => value && value.trim() !== ""
    );
    return [...new Set(options)];
  }, [setupConfig]);

  /**
   * Per-difference comment/status selection from the shared store.
   * Key = difference id, value = selected option (e.g. "Reviewed").
   */
  const commentSelections = useUploadStore(
    (state) => state.commentSelections
  );
  const [commentSaveFeedback, setCommentSaveFeedback] = useState<{
    severity: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const setCommentSelections = useUploadStore(
    (state) => state.setCommentSelections
  );
  const levelSelections = useUploadStore(
    (state) => state.levelSelections
  );
  const setLevelSelections = useUploadStore(
    (state) => state.setLevelSelections
  );
  const differenceFilters = useUploadStore(
    (state) => state.differenceFilters
  );

  /**
   * Custom comments entered by the user on screen.
   * These appear in the dropdown as "Comment1", "Comment2", "Comment3".
   */
  const customComments = useUploadStore((state) => state.customComments);

  const getCommentValue = (differenceId: number) =>
    commentSelections[differenceId] ?? "None";

  const persistDifferenceComment = async (
    differenceId: number,
    configuredComment: string,
    userComment: string
  ) => {
    // Ephemeral inspections use a generated session ID, not a persisted
    // inspection record accepted by the owner-verified comment endpoint.
    if (!/^INS-/i.test(result.inspectionId)) {
      setCommentSaveFeedback({
        severity: "warning",
        message: "This comment is only available for the current session.",
      });
      return;
    }

    try {
      await updateInspectionDifferenceComment(
        result.inspectionId,
        differenceId,
        { configuredComment, userComment }
      );
      setCommentSaveFeedback(null);
    } catch (error) {
      console.error("[DIFF-COMMENT] Failed to save comment:", error);
      setCommentSaveFeedback({
        severity: "error",
        message: "Comment could not be saved. Please try again.",
      });
    }
  };

  const handleCommentChange = (differenceId: number, value: string) => {
    setCommentSelections({
      ...commentSelections,
      [differenceId]: value,
    });

    void persistDifferenceComment(
      differenceId,
      value === "None" ? "" : value,
      value === "None" ? "" : value
    );

    // Audit: record comment/status selection on a difference (best-effort).
    void logAuditEvent({
      event: "DIFFERENCE_COMMENT_UPDATED",
      action: "Update Difference Comment",
      module: "Text Inspection",
      description: `Comment updated for difference ${differenceId} to "${value}".`,
      inspectionId: result.inspectionId,
      differenceId,
      metadata: { comment: value },
    });
  };

  const getLevelValue = (differenceId: number) =>
    levelSelections[differenceId] ?? "";

  const handleLevelChange = (differenceId: number, value: string) => {
    setLevelSelections({
      ...levelSelections,
      [differenceId]: value,
    });

    if (value) {
      handleCommentChange(differenceId, "Reviewed");
    } else {
      handleCommentChange(differenceId, "None");
    }

    // Audit: record level assignment on a difference (best-effort).
    void logAuditEvent({
      event: "DIFFERENCE_LEVEL_CHANGED",
      action: "Update Level",
      module: "Text Inspection",
      description: `Level updated for difference ${differenceId} to "${value}".`,
      inspectionId: result.inspectionId,
      differenceId,
      metadata: { level: value },
    });
  };

  /** Difference id currently being edited via double-click. */
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  /** The configured placeholder (e.g. "Comment1") that is being replaced. */
  const [editingPlaceholder, setEditingPlaceholder] = useState("");

  /**
   * Load user comments persisted in Cosmos DB for THIS inspection so that
   * reopening an old inspection shows the comments written previously.
   * They are merged into the shared store, which also feeds the PDF report.
   */
  useEffect(() => {
    const inspectionId = result.inspectionId;
    if (!inspectionId) {
      return;
    }
    let cancelled = false;
    void getInspectionDifferenceComments(inspectionId)
      .then((saved) => {
        if (cancelled || saved.length === 0) {
          return;
        }
        const restored: Record<number, string> = {};
        for (const entry of saved) {
          const userComment = (entry.userComment ?? "").trim();
          const configuredComment = (entry.configuredComment ?? "").trim();
          const comment = userComment || configuredComment;
          if (comment) {
            restored[entry.differenceId] = comment;
          }
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

  const handleStartEdit = (difference: InspectionDifference) => {
    const currentValue = getCommentValue(difference.id);
    // Only allow free-text editing when a "Comment1" / "Comment 2" … style
    // placeholder is selected — these exist for the user to replace.
    if (isEditableCommentPlaceholder(currentValue)) {
      setEditingCommentId(difference.id);
      setEditingCommentText("");
      setEditingPlaceholder(currentValue);
    }
  };

  const handleSaveEdit = (differenceId: number) => {
    const trimmed = editingCommentText.trim();
    if (trimmed) {
      setCommentSelections({
        ...commentSelections,
        [differenceId]: trimmed,
      });

      // Persist the user comment so it survives across sessions and is
      // included when the PDF report is regenerated later.
      void persistDifferenceComment(
        differenceId,
        editingPlaceholder,
        trimmed
      );
    }
    setEditingCommentId(null);
    setEditingCommentText("");
    setEditingPlaceholder("");
  };

  /* ------------------------------------------------------------------ */
  /* Share report modal                                                 */
  /* ------------------------------------------------------------------ */

  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareEmailError, setShareEmailError] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const validateEmail = (email: string): string | null => {
    if (!email.trim()) {
      return "Email address is required.";
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      return "Please enter a valid email address.";
    }
    return null;
  };

  const handleShareOpen = () => {
    console.log("[SHARE REPORT] Share dialog opened");
    setShareEmail("");
    setShareEmailError(null);
    setShareError(null);
    setShareSuccess(false);
    setShareOpen(true);
  };

  const handleShareClose = () => {
    if (shareLoading) {
      return;
    }
    setShareOpen(false);
    setShareEmail("");
    setShareEmailError(null);
    setShareError(null);
    setShareSuccess(false);
  };

  const handleShareEmailChange = (value: string) => {
    setShareEmail(value);
    if (shareEmailError) {
      setShareEmailError(null);
    }
  };

  const handleShareSubmit = async () => {
    const error = validateEmail(shareEmail);
    if (error) {
      setShareEmailError(error);
      return;
    }

    setShareLoading(true);
    setShareError(null);
    setShareSuccess(false);

    try {
      console.log("[SHARE REPORT] Recipient email:", shareEmail.trim());
      console.log("[SHARE REPORT] Generating PDF");

      // `inspectionType` is read straight off the current result, never
      // hardcoded, so the PDF title/footer match whichever inspection
      // (text, graphics, spelling, braille, barcode, notes) produced it.
      const pdfBlob = await generateInspectionReportPdfBlob({
        sessionId: result.inspectionId,
        inspectionType: result.inspectionType,
        result,
        commentSelections,
        levelSelections,
        differenceFilters,
      });

      console.log("[SHARE REPORT] PDF generated");
      console.log("[SHARE REPORT] PDF size:", pdfBlob.size, "bytes");

      await shareInspectionReport({
        recipientEmail: shareEmail.trim(),
        sessionId: result.inspectionId,
        masterFileName: result.masterFileName,
        sampleFileName: result.sampleFileName,
        reportPdf: pdfBlob,
      });

      setShareSuccess(true);
      setShareEmail("");
      setShareOpen(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to share the report.";
      setShareError(message);
    } finally {
      setShareLoading(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Report options dialog (Download PDF)                               */
  /* ------------------------------------------------------------------ */

  const [reportOptionsOpen, setReportOptionsOpen] = useState(false);

  const handleDownloadClick = () => {
    setReportOptionsOpen(true);
  };

  /**
   * Build the set of level options available for the download popup
   * dynamically from the levels actually present in the difference
   * table (stored selections + default level + "None" when empty).
   * This makes the popup filters dynamic so future admin-defined
   * custom levels automatically appear here too.
   */
  const availableLevelOptions = useMemo(() => {
    const levels = new Set<string>(["None"]);
    for (const diff of result.differences) {
      const raw = levelSelections[diff.id] ?? diff.level ?? "";
      const level = raw && raw.trim() !== "" ? raw : "None";
      levels.add(level);
    }
    return Array.from(levels);
  }, [result.differences, levelSelections]);

  const handleDownloadWithOptions = (options: ReportOptions) => {
    setReportOptionsOpen(false);

    const session = getSession();
    let performedBy = "User";

    if (session?.username) {
      performedBy = session.username;
    } else if (session?.name) {
      performedBy = session.name;
    } else if (session?.email) {
      const emailUsername = session.email.split("@")[0];
      performedBy =
        emailUsername.charAt(0).toUpperCase() + emailUsername.slice(1);
    }

    // Same as the Share flow: `inspectionType` comes from the live
    // result object, never a hardcoded string, so Text/Graphics/
    // Spelling/Braille/Barcode/Notes reports each get the right title.
    void downloadInspectionPdf({
      sessionId: result.inspectionId,
      inspectionType: result.inspectionType,
      result,
      commentSelections,
      levelSelections,
      differenceFilters,
      reportOptions: options,
      performedBy,
      masterFile,
    });
  };

  /* ------------------------------------------------------------------ */
  /* Difference List window                                             */
  /* ------------------------------------------------------------------ */

  const differenceListWindowRef = useRef<Window | null>(null);

  useEffect(
    () =>
      subscribeToStateRequests(() => {
        broadcastStateUpdate(useUploadStore.getState());
      }),
    []
  );

  const handleOpenDifferenceList = () => {
    console.log("[DIFFERENCE LIST] Button clicked");
    console.log("[DIFFERENCE LIST] Current differences:", result.differences.length);
    console.log("[DIFFERENCE LIST] Current Level values:", levelSelections);
    console.log("[DIFFERENCE LIST] Current Comment values:", commentSelections);

    // Audit: record that the user opened/viewed the Difference List.
    void logAuditEvent({
      event: "DIFFERENCE_VIEWED",
      action: "View Difference List",
      module: "Text Inspection",
      description: `Difference list opened. Inspection ID=${result.inspectionId}`,
      inspectionId: result.inspectionId,
      metadata: { totalDifferences: result.differences.length },
    });

    // If a window is already open, focus it instead of opening a duplicate
    if (differenceListWindowRef.current && !differenceListWindowRef.current.closed) {
      console.log("[DIFFERENCE LIST] Existing window status: open");
      differenceListWindowRef.current.focus();
      return;
    }

    console.log("[DIFFERENCE LIST] Existing window status: closed or none");
    console.log("[DIFFERENCE LIST] Opening window");

    const url = `${window.location.origin}/inspection/differences`;
    const newWindow = window.open(url, "DifferenceList", "width=1200,height=800");

    if (newWindow) {
      differenceListWindowRef.current = newWindow;
      console.log("[DIFFERENCE LIST] Window opened successfully");
    } else {
      console.log("[DIFFERENCE LIST] Window blocked by popup blocker");
    }
  };

  /* ------------------------------------------------------------------ */
  /* Character-level difference alignment                               */
  /* ------------------------------------------------------------------ */

  const masterText = isBraille ? "" : selectedDifferenceData?.master ?? "";
  const sampleText = isBraille ? "" : selectedDifferenceData?.sample ?? "";

  const characterDifferences = useMemo(
    () => isBraille ? [] : calculateCharacterDifferences(masterText, sampleText),
    [isBraille, masterText, sampleText]
  );

  const selectedCharacter =
    characterDifferences[selectedCharacterIndex] ?? null;

  /* ------------------------------------------------------------------ */
  /* Reset character selection when the selected difference changes     */
  /* ------------------------------------------------------------------ */

  const currentDifferenceId = selectedDifferenceData?.id ?? null;

  if (currentDifferenceId !== lastDifferenceId) {
    setLastDifferenceId(currentDifferenceId);

    if (currentDifferenceId !== null) {
      // Reset to the first non-equal character if any, otherwise index 0
      const firstDiffIndex = characterDifferences.findIndex(
        (item: CharacterDifference) => item.type !== "equal"
      );

      setSelectedCharacterIndex(
        firstDiffIndex >= 0 ? firstDiffIndex : 0
      );
    } else {
      setSelectedCharacterIndex(0);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Auto-scroll the character strip to the selected character          */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!selectedCharacterRef.current) {
      return;
    }

    selectedCharacterRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedCharacterIndex]);

  /* ------------------------------------------------------------------ */
  /* Difference navigation (Previous / Next)                            */
  /* ------------------------------------------------------------------ */

  const currentDifferenceIndex = selectedDifferenceData
    ? result.differences.findIndex(
        (d) => d.id === selectedDifferenceData.id
      )
    : -1;

  const handlePreviousDifference = useCallback(() => {
    if (currentDifferenceIndex <= 0) {
      return;
    }

    const prev = result.differences[currentDifferenceIndex - 1];
    handleSelect(prev);
  }, [currentDifferenceIndex, result.differences, handleSelect]);

  const handleNextDifference = useCallback(() => {
    if (
      currentDifferenceIndex < 0 ||
      currentDifferenceIndex >= result.differences.length - 1
    ) {
      return;
    }

    const next = result.differences[currentDifferenceIndex + 1];
    handleSelect(next);
  }, [currentDifferenceIndex, result.differences, handleSelect]);

  /* ------------------------------------------------------------------ */
  /* Keyboard navigation (ArrowLeft / ArrowRight)                       */
  /* ------------------------------------------------------------------ */

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!selectedDifferenceData) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlePreviousDifference();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNextDifference();
      }
    },
    [selectedDifferenceData, handlePreviousDifference, handleNextDifference]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  /* ------------------------------------------------------------------ */
  /* Crop Compare — region-scoped re-inspection of the Master page      */
  /* ------------------------------------------------------------------ */

  const [cropMode, setCropMode] = useState(false);
  const [cropRunning, setCropRunning] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  const [cropRegion, setCropRegion] = useState<{
    page: number;
    box: BoundingBox;
  } | null>(null);
  const [cropResult, setCropResult] = useState<CropRunResult | null>(null);

  /**
   * Called by the Master PdfViewer when the user finishes dragging a
   * crop rectangle. Runs the crop-scoped backend pipeline and opens the
   * Crop Results dialog (kept separate from the full-page difference
   * table so crop output never mixes into the main findings list).
   */
  const handleCropComplete = useCallback(
    (page0Based: number, box: BoundingBox) => {
      setCropRegion({ page: page0Based, box });
      setCropDialogOpen(true);
      setCropError(null);
      setCropRunning(true);
      setCropResult(null);

      cropInspect({
        inspectionId: result.inspectionId,
        page: page0Based,
        box,
      })
        .then((data) => {
          setCropResult(data);
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          setCropError(message);
        })
        .finally(() => {
          setCropRunning(false);
        });
    },
    [result.inspectionId]
  );

  const handleToggleCropMode = () => {
    setCropMode((previous) => {
      if (previous) {
        // Leaving crop mode: dismiss any open crop dialog too.
        setCropDialogOpen(false);
      }
      return !previous;
    });
  };

  /* ------------------------------------------------------------------ */
  /* Debug logs                                                         */
  /* ------------------------------------------------------------------ */

  console.log("[CharacterDiff] Master:", masterText);
  console.log("[CharacterDiff] Sample:", sampleText);

  console.log("[CharacterDiff] Alignment (character at each index):");
  console.log(
    "  Master:",
    characterDifferences.map((item) => item.masterChar || " ").join(" | ")
  );
  console.log(
    "  Sample:",
    characterDifferences.map((item) => item.sampleChar || " ").join(" | ")
  );
  console.log(
    "  Type:  ",
    characterDifferences.map((item) => item.type).join(" | ")
  );
  console.log("[CharacterDiff] Alignment (per-index objects):", characterDifferences);
  console.log("[CharacterDiff] Selected index:", selectedCharacterIndex);
  console.log("[CharacterDiff] Selected character:", selectedCharacter);

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "calc(100vh - 72px)",
        height: isBraille ? "calc(100vh - 72px)" : "auto",
        position: "relative",
        bgcolor: "#ffffff",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
        overflowY: isBraille ? "hidden" : "visible",
        gap: 1,
      }}
    >
      {/* =========================================================
          RESULT HEADER
         ========================================================= */}

      {isSingleDocument ? (
        <Box
          sx={{
            height: 44,
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            borderBottom: "1px solid #d5d9dd",
            bgcolor: "#ffffff",
            flexShrink: 0,
          }}
        >
            {isBarcode && (
              <Button
              size="small"
              variant={barcodeFindingsOpen ? "contained" : "outlined"}
              onClick={() => setBarcodeFindingsOpen((open) => !open)}
              sx={{
                minWidth: 58,
                height: 32,
                textTransform: "none",
                color: barcodeFindingsOpen ? "#fff" : "#2A276E",
                borderColor: "#2A276E",
                bgcolor: barcodeFindingsOpen ? "#2A276E" : "transparent",
              }}
            >
              Start
            </Button>
          )}
          <Typography
            variant="body2"
            noWrap
            title={result.masterFileName}
            sx={{ minWidth: 0, flex: 1, color: "#30343b" }}
          >
            <Box component="span" sx={{ fontWeight: 700 }}>Filename:</Box>{" "}
            {truncateFileName(result.masterFileName, 34)}
          </Typography>
          {isBraille && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Tooltip title="Share report" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
                <IconButton
                  size="small"
                  onClick={handleShareOpen}
                  sx={{
                    bgcolor: "#2A276E",
                    color: "#ffffff",
                    "&:hover": { bgcolor: "#1f1d57" },
                  }}
                >
                  <ShareIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Zoom level" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
                <IconButton
                  size="small"
                  aria-label="Open zoom level menu"
                  onClick={() => brailleOpenZoomMenuRef.current?.()}
                  sx={{
                    bgcolor: "#2A276E",
                    color: "#ffffff",
                    "&:hover": { bgcolor: "#1f1d57" },
                  }}
                >
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Annotation list" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
                <Button
                  size="small"
                  aria-label="Toggle Braille annotation list"
                  aria-pressed={brailleFindingsOpen}
                  onClick={() => setBrailleFindingsOpen((open) => !open)}
                  startIcon={<FormatListBulletedIcon fontSize="small" />}
                  sx={{
                    bgcolor: brailleFindingsOpen ? "#2A276E" : "#e8e9f2",
                    color: brailleFindingsOpen ? "#ffffff" : "#2A276E",
                    "&:hover": { bgcolor: brailleFindingsOpen ? "#1f1d57" : "#d9daeb" },
                    whiteSpace: "nowrap",
                  }}
                >
                  Annotation list
                </Button>
              </Tooltip>
              <Tooltip title="Download the PDF report" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
                <IconButton
                  size="small"
                  onClick={handleDownloadClick}
                  sx={{
                    bgcolor: "#2A276E",
                    color: "#ffffff",
                    "&:hover": { bgcolor: "#1f1d57" },
                  }}
                >
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>
      ) : (
        <Box
          sx={{
            height: 52,
            display: "flex",
            alignItems: "center",
            px: 1.5,
            borderBottom: "1px solid #d5d9dd",
            bgcolor: "#ffffff",
            flexShrink: 0,
          }}
        >
          {/* Difference Count — solid dark-blue badge */}

          <Box
            sx={{
              height: 34,
              px: 1.2,
              display: "flex",
              alignItems: "center",
              mr: 1.2,

              // Flat solid dark-blue count badge (no glassmorphism)
              borderRadius: 2,
              border: "1px solid #1B1B4B",
              bgcolor: "#2A276E",
              boxShadow: "0 2px 6px rgba(27, 27, 60, 0.25)",
              transition: "all .25s ease",

              "&:hover": {
                bgcolor: "#232058",
                boxShadow: "0 4px 12px rgba(27, 27, 60, 0.35)",
                transform: "translateY(-1px)",
              },
            }}
          >
            <Typography
              sx={{
                fontSize: 15,
                fontWeight: 700,
                color: "#FFFFFF",
                textShadow: "0 1px 2px rgba(0, 0, 0, 0.35)",
                letterSpacing: 0.3,
              }}
            >
              {differenceCount}{" "}
              {differenceCount === 1 ? "Difference" : "Differences"}
            </Typography>
          </Box>

          {/* Master */}

          <Typography
            sx={{
              fontSize: 14,
              fontWeight: 600,
              color: "#515860",
              mr: 0.5,
              whiteSpace: "nowrap",
            }}
          >
            Master:
          </Typography>

          <Typography
            sx={{
              fontSize: 14,
              color: "#5e646b",
              maxWidth: 330,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              mr: "auto",
            }}
            title={result.masterFileName}
          >
            {truncateFileName(result.masterFileName)}
          </Typography>

          {/* Sample */}

          <Typography
            sx={{
              fontSize: 14,
              fontWeight: 600,
              color: "#515860",
              mr: 0.5,
              whiteSpace: "nowrap",
            }}
          >
            Sample:
          </Typography>

          <Typography
            sx={{
              fontSize: 14,
              color: "#5e646b",
              maxWidth: 330,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              mr: 1,
            }}
            title={result.sampleFileName}
          >
            {truncateFileName(result.sampleFileName)}
          </Typography>

          {/* Action Icons */}

          <Divider
            orientation="vertical"
            flexItem
            sx={{ mx: 1 }}
          />

          <Tooltip title="Share" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
            <IconButton
              size="small"
              onClick={handleShareOpen}
              sx={{
                bgcolor: "#2A276E",
                color: "#ffffff",
                mx: 0.25,
                "&:hover": {
                  bgcolor: "#1f1d57",
                },
              }}
            >
              <ShareIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Zoom" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
            <IconButton
              size="small"
              sx={{
                bgcolor: "#2A276E",
                color: "#ffffff",
                mx: 0.25,
                "&:hover": {
                  bgcolor: "#1f1d57",
                },
              }}
            >
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Change the sample" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
            <IconButton
              size="small"
              sx={{
                bgcolor: "#2A276E",
                color: "#ffffff",
                mx: 0.25,
                "&:hover": {
                  bgcolor: "#1f1d57",
                },
              }}
            >
              <SwapHorizIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Annotation list" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
            <IconButton
              size="small"
              sx={{
                bgcolor: "#2A276E",
                color: "#ffffff",
                mx: 0.25,
                "&:hover": {
                  bgcolor: "#1f1d57",
                },
              }}
            >
              <FormatListBulletedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Download the PDF report" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
            <IconButton
              size="small"
              onClick={handleDownloadClick}
              sx={{
                bgcolor: "#2A276E",
                color: "#ffffff",
                mx: 0.25,
                "&:hover": {
                  bgcolor: "#1f1d57",
                },
              }}
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Open difference list" arrow slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}>
            <IconButton
              size="small"
              onClick={handleOpenDifferenceList}
              sx={{
                bgcolor: "#2A276E",
                color: "#ffffff",
                mx: 0.25,
                "&:hover": {
                  bgcolor: "#1f1d57",
                },
              }}
            >
              <CompareIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {!isBarcode && (
        <>
          {/* =========================================================
          RESULT TOOLBAR
         ========================================================= */}

          <Box
            sx={{
              height: 44,
              display: "flex",
              alignItems: "center",
              px: 1,
              borderBottom: "1px solid #d5d9dd",
              bgcolor: "#f8f9fa",
              flexShrink: 0,
            }}
          >
            {isBraille && (
              <>
                <TextField
                  size="small"
                  type="number"
                  value={brailleGoToId}
                  onChange={(event) => {
                    setBrailleGoToId(event.target.value);
                    setBrailleGoToError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleBrailleGoToId();
                    }
                  }}
                  placeholder="Go to ID"
                  aria-label="Go to finding ID"
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                  sx={{
                    width: 110,
                    mx: 0.5,
                    "& .MuiInputBase-root": { height: 30, fontSize: 13 },
                  }}
                />
                <Button
                  size="small"
                  onClick={handleBrailleGoToId}
                  sx={{
                    minWidth: 42,
                    px: 1,
                    color: "#2A276E",
                    textTransform: "none",
                    fontWeight: 600,
                  }}
                >
                  Go
                </Button>
                {brailleGoToError && (
                  <Typography
                    role="alert"
                    variant="caption"
                    sx={{ ml: 0.5, color: "error.main", whiteSpace: "nowrap" }}
                  >
                    {brailleGoToError}
                  </Typography>
                )}
              </>
            )}
            <IconButton size="small">
              <GridViewOutlinedIcon fontSize="small" />
            </IconButton>

            <IconButton size="small">
              <FilterAltOutlinedIcon fontSize="small" />
            </IconButton>

            <IconButton size="small">
              <VisibilityOffOutlinedIcon fontSize="small" />
            </IconButton>

            <IconButton size="small">
              <VisibilityOutlinedIcon fontSize="small" />
            </IconButton>

            <IconButton size="small">
              <VisibilityOffTwoToneIcon fontSize="small" />
            </IconButton>

            {/* Crop Compare — drag a region on the Master page to re-inspect
            just that region. Text inspection only (the crop pipeline is
            the text comparison engine). */}
            {result.inspectionType === "text" && (
              <Tooltip
                title={
                  cropMode
                    ? "Crop Compare ON — drag a rectangle on the Master page (click to turn off)"
                    : "Crop Compare — drag a rectangle on the Master page to inspect just that region"
                }
                arrow
                slotProps={DARK_BLUE_TOOLTIP_SLOT_PROPS}
              >
                <IconButton
                  size="small"
                  onClick={handleToggleCropMode}
                  sx={{
                    bgcolor: cropMode ? "#6a1b9a" : "#2A276E",
                    color: "#ffffff",
                    mx: 0.25,
                    "&:hover": {
                      bgcolor: cropMode ? "#4a148c" : "#1f1d57",
                    },
                  }}
                >
                  <CropFreeIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}

            <Box sx={{ flex: 1 }} />

            <IconButton size="small">
              <ArrowBackOutlinedIcon fontSize="small" />
            </IconButton>

            <IconButton size="small">
              <ArrowForwardOutlinedIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* =========================================================
          DIFFERENCE TABLE
         ========================================================= */}

          <Collapse
            in={
              isBarcode
                ? barcodeDetailsOpen
                : isBraille
                  ? brailleFindingsOpen
                  : true
            }
            unmountOnExit
          >
            <TableContainer
              component={Paper}
              elevation={0}
              sx={{
                maxHeight: isBarcode ? 220 : 250,
                overflow: "auto",
                flexShrink: 0,
              }}
            >
              <Table
                stickyHeader
                size="small"
                sx={{
                  minWidth: 1000,
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell
                      padding="checkbox"
                      sx={{
                        bgcolor: "#f3f5f7",
                        borderBottom: "1px solid #cdd2d7",
                      }}
                    >
                      <Checkbox size="small" />
                    </TableCell>

                    <TableCell
                      sx={{
                        width: 60,
                        bgcolor: "#f3f5f7",
                        fontWeight: 700,
                        color: "#50575e",
                        borderBottom: "1px solid #cdd2d7",
                      }}
                    >
                      ID
                    </TableCell>

                    <TableCell
                      sx={{
                        width: 220,
                        bgcolor: "#f3f5f7",
                        fontWeight: 700,
                        color: "#50575e",
                        borderBottom: "1px solid #cdd2d7",
                      }}
                    >
                      {isBraille ? "Status" : "Type"}
                    </TableCell>

                    <TableCell
                      sx={{
                        minWidth: 250,
                        bgcolor: "#f3f5f7",
                        fontWeight: 700,
                        color: "#50575e",
                        borderBottom: "1px solid #cdd2d7",
                      }}
                    >
                      {isBraille ? "Decoded Value" : "Master"}
                    </TableCell>

                    {!isBraille && (
                      <TableCell
                        sx={{
                          minWidth: 250,
                          bgcolor: "#f3f5f7",
                          fontWeight: 700,
                          color: "#50575e",
                          borderBottom: "1px solid #cdd2d7",
                        }}
                      >
                        Sample
                      </TableCell>
                    )}

                    <TableCell
                      sx={{
                        width: 180,
                        bgcolor: "#f3f5f7",
                        fontWeight: 700,
                        color: "#50575e",
                        borderBottom: "1px solid #cdd2d7",
                      }}
                    >
                      Level
                    </TableCell>

                    <TableCell
                      sx={{
                        width: 220,
                        bgcolor: "#f3f5f7",
                        fontWeight: 700,
                        color: "#50575e",
                        borderBottom: "1px solid #cdd2d7",
                      }}
                    >
                      Comment
                    </TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {result.differences.map((difference) => {
                    const isSelected = effectiveSelectedId === difference.id;

                    return (
                      <TableRow
                        key={difference.id}
                        hover
                        selected={isSelected}
                        onClick={
                          isBraille
                            ? () => handleSelect(difference)
                            : undefined
                        }
                        // Text comparisons navigate from value cells so controls
                        // remain interactive. Braille regions select from any
                        // part of the row.
                        sx={{
                          bgcolor: isSelected ? "rgba(42, 39, 110, 0.06)" : "transparent",
                          cursor: isBraille ? "pointer" : undefined,

                          "&:hover": {
                            bgcolor: isSelected ? "rgba(42, 39, 110, 0.08)" : "#edf3ff",
                          },
                        }}
                      >
                        <TableCell padding="checkbox">
                          <Checkbox size="small" />
                        </TableCell>

                        <TableCell
                          onClick={
                            isBraille
                              ? undefined
                              : () => handleSelect(difference)
                          }
                          sx={{
                            fontSize: 14,
                            color: "#535a62",
                            cursor: "pointer",
                          }}
                        >
                          {difference.id}
                        </TableCell>

                        <TableCell
                          onClick={
                            isBraille
                              ? undefined
                              : () => handleSelect(difference)
                          }
                          sx={{
                            fontSize: 14,
                            color: "#535a62",
                            cursor: "pointer",
                          }}
                        >
                          {isBraille
                            ? getBrailleFindingStatus(difference.brailleMetrics)
                            : difference.type}
                        </TableCell>

                        <TableCell
                          onClick={
                            isBraille
                              ? undefined
                              : () => handleSelect(difference)
                          }
                          sx={{
                            fontSize: 14,
                            color: "#535a62",
                            maxWidth: 300,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                          }}
                          title={difference.master}
                        >
                          {difference.master}
                        </TableCell>

                        {!isBraille && (
                          <TableCell
                            onClick={() => handleSelect(difference)}
                            sx={{
                              fontSize: 14,
                              color: "#535a62",
                              maxWidth: 300,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                            }}
                            title={difference.sample}
                          >
                            {difference.sample}
                          </TableCell>
                        )}

                        <TableCell>
                          <FormControl size="small" fullWidth>
                            <Select
                              value={getLevelValue(difference.id)}
                              displayEmpty
                              sx={{
                                height: 30,
                                fontSize: 13,
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                              onChange={(event) => {
                                handleLevelChange(
                                  difference.id,
                                  event.target.value as string
                                );
                              }}
                            >
                              <MenuItem value="">None</MenuItem>
                              {configuredLevels
                                .filter((option) => option !== "None")
                                .map((option) => (
                                  <MenuItem key={option} value={option}>
                                    {option}
                                  </MenuItem>
                                ))}
                            </Select>
                          </FormControl>
                        </TableCell>

                        <TableCell>
                          {editingCommentId === difference.id ? (
                            <TextField
                              size="small"
                              fullWidth
                              autoFocus
                              value={editingCommentText}
                              onChange={(event) =>
                                setEditingCommentText(event.target.value)
                              }
                              onBlur={() => handleSaveEdit(difference.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  handleSaveEdit(difference.id);
                                } else if (event.key === "Escape") {
                                  setEditingCommentId(null);
                                  setEditingCommentText("");
                                }
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                              sx={{
                                "& .MuiInputBase-root": {
                                  height: 30,
                                  fontSize: 13,
                                },
                              }}
                            />
                          ) : (
                            <FormControl size="small" fullWidth>
                              <Select
                                value={getCommentValue(difference.id)}
                                displayEmpty
                                sx={{
                                  height: 30,
                                  fontSize: 13,
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                }}
                                onDoubleClick={(event) => {
                                  event.stopPropagation();
                                  handleStartEdit(difference);
                                }}
                                onChange={(event) => {
                                  handleCommentChange(
                                    difference.id,
                                    event.target.value as string
                                  );
                                }}
                              >
                                {configuredComments.map((option) => (
                                  <MenuItem key={option} value={option}>
                                    {option}
                                  </MenuItem>
                                ))}

                                {/* Persisted user comment (e.g. typed via
                                    double-click) that is not one of the configured
                                    options — render it so the Select value is
                                    always valid. */}
                                {(() => {
                                  const current = getCommentValue(difference.id);
                                  if (
                                    current === "" ||
                                    current === "None" ||
                                    configuredComments.includes(current)
                                  ) {
                                    return null;
                                  }
                                  return (
                                    <MenuItem key={current} value={current}>
                                      {current}
                                    </MenuItem>
                                  );
                                })()}

                                {customComments.length > 0 && (
                                  <Divider sx={{ my: 0.5 }} />
                                )}

                                {customComments.map((comment, index) => (
                                  <MenuItem
                                    key={`${comment}-${index}`}
                                    value={comment}
                                  >
                                    {comment}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {result.differences.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        align="center"
                        sx={{
                          py: 4,
                          color: "#69717a",
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 500,
                          }}
                        >
                          No differences found
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Collapse>

          {/* =========================================================
          SELECTED DIFFERENCE DETAILS
         ========================================================= */}

          {selectedDifferenceData &&
            !isBraille &&
            (!isBarcode || barcodeDetailsOpen) && (
            <Box
              sx={{
                border: "1px solid #d5d9dd",
                bgcolor: "#f8f9fa",
                px: 2,
                py: 1.5,
                flexShrink: 0,
                ...(isBarcode
                  ? {
                      position: "absolute",
                      left: 16,
                      bottom: 56,
                      zIndex: 40,
                      width: "min(680px, calc(100% - 32px))",
                      maxHeight: "45%",
                      overflow: "auto",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                      borderRadius: 1.5,
                    }
                  : {}),
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1,
                  gap: 2,
                }}
              >
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700,
                    color: "#2A276E",
                  }}
                >
                  Selected Difference
                </Typography>
                {isBarcode && (
                  <IconButton size="small" onClick={() => setBarcodeDetailsOpen(false)} aria-label="Close barcode details">
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 2,
                }}
              >
                <Paper
                  elevation={0}
                  sx={{
                    border: "1px solid #d5d9dd",
                    borderRadius: 1.5,
                    p: 1.5,
                    bgcolor: "#ffffff",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: "#50575e" }}
                  >
                    {selectedDifferenceData.type === "Barcode" ? "Decoded value" : "Master value"}
                  </Typography>
                  <Typography sx={{ mt: 0.5, color: "#2f353c" }}>
                    {selectedDifferenceData.type === "Barcode"
                      ? (selectedDifferenceData.decodedValue ?? selectedDifferenceData.master ?? "—")
                      : (selectedDifferenceData.master || "—")}
                  </Typography>
                </Paper>

                <Paper
                  elevation={0}
                  sx={{
                    border: "1px solid #d5d9dd",
                    borderRadius: 1.5,
                    p: 1.5,
                    bgcolor: "#ffffff",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: "#50575e" }}
                  >
                    {selectedDifferenceData.type === "Barcode" ? "Detected value" : "Sample value"}
                  </Typography>
                  <Typography sx={{ mt: 0.5, color: "#2f353c" }}>
                    {selectedDifferenceData.type === "Barcode"
                      ? (selectedDifferenceData.sample || selectedDifferenceData.decodedValue || "—")
                      : (selectedDifferenceData.sample || "—")}
                  </Typography>
                </Paper>
              </Box>

              {selectedDifferenceData.type === "Barcode" && (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 2,
                    mt: 2,
                  }}
                >
                  <Paper
                    elevation={0}
                    sx={{
                      border: "1px solid #d5d9dd",
                      borderRadius: 1.5,
                      p: 1.5,
                      bgcolor: "#ffffff",
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 700, color: "#50575e" }}
                    >
                      Type
                    </Typography>
                    <Typography sx={{ mt: 0.5, color: "#2f353c" }}>
                      {selectedDifferenceData.barcodeType ?? "Unknown"}
                    </Typography>
                  </Paper>
                  <Paper
                    elevation={0}
                    sx={{
                      border: "1px solid #d5d9dd",
                      borderRadius: 1.5,
                      p: 1.5,
                      bgcolor: "#ffffff",
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 700, color: "#50575e" }}
                    >
                      Decoded Value
                    </Typography>
                    <Typography sx={{ mt: 0.5, color: "#2f353c" }}>
                      {selectedDifferenceData.decodedValue ?? selectedDifferenceData.sample ?? "—"}
                    </Typography>
                  </Paper>
                  <Paper
                    elevation={0}
                    sx={{
                      border: "1px solid #d5d9dd",
                      borderRadius: 1.5,
                      p: 1.5,
                      bgcolor: "#ffffff",
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 700, color: "#50575e" }}
                    >
                      Grade
                    </Typography>
                    <Typography sx={{ mt: 0.5, color: "#2f353c" }}>
                      {selectedDifferenceData.grade ?? "—"}
                    </Typography>
                  </Paper>
                </Box>
              )}
            </Box>
          )}

          {/* =========================================================
          PDF VIEWERS
         ========================================================= */}

          <Box
            sx={{
              flex: 1,
              display: "flex",
              bgcolor: "#f5f5f5",
              overflow: "hidden",
              minHeight: 0,
              gap: !isSingleDocument && selectedDifferenceData ? 2 : 0,
            }}
          >
            <Box sx={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
              <ViewerPane
                title={isSingleDocument ? "" : "Master Artwork"}
                file={masterFile}
                inspectionType={result.inspectionType}
                side="master"
                selectedDifference={viewerDifference}
                onRegisterZoomMenu={
                  isBraille
                    ? (openMenu) => {
                        brailleOpenZoomMenuRef.current = openMenu;
                      }
                    : undefined
                }
                zeroBasedPageIndex={isBraille ? true : undefined}
                hideHeader={isSingleDocument}
                compactViewer={isSingleDocument}
                onOverlayClick={(difference) => {
                  if (isBraille) {
                    handleSelect(difference);
                  } else {
                    setBarcodeDetailsOpen(true);
                  }
                }}
                connectorTargetRect={
                  isBraille ? brailleConnectorTargetRect : undefined
                }
                onToggleSidebar={isBarcode ? () => setBarcodeFindingsOpen((open) => !open) : undefined}
                sidebarOpen={barcodeFindingsOpen}
                onDocumentAction={isBarcode ? () => setBarcodeFindingsOpen(true) : undefined}
                onComments={isBarcode ? () => setBarcodeFindingsOpen(true) : undefined}
                onRefresh={isBarcode ? onRefreshInspection : undefined}
                isFullscreen={isFullscreen}
                onToggleFullscreen={isBarcode ? onToggleFullscreen : undefined}
                naturalWidth={
                  result.pages?.find(
                    (p) => p.page === (selectedDifferenceData?.page ?? 0)
                  )?.masterWidth
                }
                naturalHeight={
                  result.pages?.find(
                    (p) => p.page === (selectedDifferenceData?.page ?? 0)
                  )?.masterHeight
                }
                cropMode={cropMode}
                onCropComplete={handleCropComplete}
              />
            </Box>
            {isBraille && (
              <Box
                data-testid="braille-details-sidebar"
                sx={{
                  width: { xs: 280, md: 310 },
                  flexShrink: 0,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflowY: "hidden",
                  overflowX: "hidden",
                  borderLeft: "1px solid #d5d9dd",
                  bgcolor: "#ffffff",
                }}
              >
                <Box
                  sx={{
                    px: 1.5,
                    py: 1.25,
                    borderBottom: "1px solid #d5d9dd",
                    flexShrink: 0,
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{ color: "#2A276E", fontWeight: 700 }}
                  >
                    Comments / Additional Information
                  </Typography>
                </Box>

                <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  {result.differences.map((difference) => {
                    const metrics = difference.brailleMetrics;
                    const translation =
                      difference.decodedValue || difference.master;
                    const review = getCommentValue(difference.id);
                    const level = getLevelValue(difference.id);
                    const comment = difference.comment ?? "";
                    const status = getBrailleFindingStatus(metrics);
                    const legacyMetric = (label: string) => {
                      const match = comment.match(
                        new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+${label}\\b`, "i")
                      );
                      return match ? Number(match[1]) : undefined;
                    };
                    const details: Array<[string, string | number | null | undefined]> = [
                      ["Language", result.brailleLanguage || "Unavailable"],
                      ["Status", status],
                      ["Lines", metrics?.lines ?? legacyMetric("lines") ?? "Unavailable"],
                      [
                        "Characters",
                        metrics?.characters ??
                          legacyMetric("characters") ??
                          "Unavailable",
                      ],
                      ["Dots", metrics?.dots ?? legacyMetric("dots") ?? "Unavailable"],
                      ["Dot H", metrics?.dotHMillimeters ?? "Unavailable"],
                      ["Dot V", metrics?.dotVMillimeters ?? "Unavailable"],
                      ["Character", metrics?.characterMillimeters ?? "Unavailable"],
                      ["Word", metrics?.wordMillimeters ?? "Unavailable"],
                      ["Line", metrics?.lineMillimeters ?? "Unavailable"],
                    ];

                    return (
                      <ButtonBase
                        key={difference.id}
                        ref={(element) => {
                          if (element) {
                            brailleFindingRefs.current.set(difference.id, element);
                          } else {
                            brailleFindingRefs.current.delete(difference.id);
                          }
                        }}
                        data-testid={`braille-finding-${difference.id}`}
                        aria-pressed={effectiveSelectedId === difference.id}
                        onClick={() => handleSelect(difference)}
                        sx={{
                          display: "block",
                          width: "100%",
                          px: 1.5,
                          py: 1,
                          borderBottom: "1px solid #e5e7eb",
                          borderLeft:
                            effectiveSelectedId === difference.id
                              ? "3px solid #2A276E"
                              : "3px solid transparent",
                          bgcolor:
                            effectiveSelectedId === difference.id
                              ? "rgba(42, 39, 110, 0.08)"
                              : "#ffffff",
                          textAlign: "left",
                          "&:hover": { bgcolor: "rgba(42, 39, 110, 0.05)" },
                        }}
                      >
                        <Typography
                          component="div"
                          sx={{
                            mb: 0.4,
                            color: "#2A276E",
                            fontSize: 12,
                            fontWeight: 700,
                            lineHeight: 1.35,
                          }}
                        >
                          Finding {difference.id}
                          {typeof difference.page === "number"
                            ? ` · Page ${difference.page + 1}`
                            : ""}
                        </Typography>
                        {details.map(([label, value]) => (
                            <Typography
                              key={label}
                              component="div"
                              sx={{
                                color: "#343a40",
                                fontSize: 12,
                                lineHeight: 1.4,
                                overflowWrap: "anywhere",
                              }}
                            >
                              {label}: {String(value)}
                            </Typography>
                          ))}
                        <Typography
                          component="div"
                          sx={{
                            mt: 0.3,
                            color: "#343a40",
                            fontSize: 12,
                            lineHeight: 1.4,
                          }}
                        >
                          Translation:
                        </Typography>
                        <Typography
                          component="div"
                          sx={{
                            color: "#343a40",
                            fontSize: 12,
                            lineHeight: 1.4,
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {translation || "Unavailable"}
                        </Typography>
                        {review !== "None" && (
                          <Typography
                            component="div"
                            sx={{ color: "#555d66", fontSize: 12, lineHeight: 1.4 }}
                          >
                            Review: {review}
                          </Typography>
                        )}
                        {level && (
                          <Typography
                            component="div"
                            sx={{ color: "#555d66", fontSize: 12, lineHeight: 1.4 }}
                          >
                            Level: {level}
                          </Typography>
                        )}
                      </ButtonBase>
                    );
                  })}
                </Box>
              </Box>
            )}
            {!isSingleDocument && (
              <Box sx={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
                <ViewerPane
                  title="Sample Artwork"
                  file={sampleFile}
                  inspectionType={result.inspectionType}
                  side="sample"
                  selectedDifference={selectedDifferenceData}
                  naturalWidth={
                    result.pages?.find(
                      (p) => p.page === (selectedDifferenceData?.page ?? 0)
                    )?.sampleWidth
                  }
                  naturalHeight={
                    result.pages?.find(
                      (p) => p.page === (selectedDifferenceData?.page ?? 0)
                    )?.sampleHeight
                  }
                />
              </Box>
            )}
          </Box>

          {/* =========================================================
          CHARACTER DIFFERENCE PANEL (BOTTOM)
         ========================================================= */}

          {selectedDifferenceData && !isBraille && (
            <Box
              sx={{
                borderTop: "1px solid #d5d9dd",
                bgcolor: "#f8f9fa",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                px: 1,
                py: 1,
                gap: 1,
              }}
            >
              {/* Previous Difference */}
              <IconButton
                size="small"
                disabled={currentDifferenceIndex <= 0}
                onClick={handlePreviousDifference}
                sx={{
                  bgcolor: "#2A276E",
                  color: "#ffffff",
                  "&:hover": {
                    bgcolor: "#1f1d57",
                  },
                  "&.Mui-disabled": {
                    bgcolor: "#d9d9d9",
                    color: "#8a8a8a",
                  },
                }}
              >
                <ChevronLeftIcon fontSize="small" />
              </IconButton>

              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    px: 0.5,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: "#2A276E",
                    }}
                  >
                    Character Difference
                  </Typography>

                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 600,
                      color: "#50575e",
                    }}
                  >
                    Difference {selectedDifferenceData.id} / {result.differences.length}
                  </Typography>
                </Box>

                <Box
                  ref={characterStripRef}
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 0.5,
                    overflowX: "auto",
                    overflowY: "hidden",
                    pb: 0.5,
                  }}
                >
                  {/* Master Row */}
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.25,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        color: "#50575e",
                        minWidth: 48,
                        flexShrink: 0,
                      }}
                    >
                      Master
                    </Typography>

                    {characterDifferences.map((item) => {
                      const isSelected = item.index === selectedCharacterIndex;
                      const isEmpty = item.masterChar === "";

                      return (
                        <Box
                          key={`m-${item.index}`}
                          ref={isSelected ? selectedCharacterRef : null}
                          onClick={() => setSelectedCharacterIndex(item.index)}
                          sx={{
                            minWidth: 22,
                            height: 24,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: "1px solid #cdd2d7",
                            borderRadius: 0.5,
                            fontSize: 12,
                            fontFamily: "monospace",
                            cursor: "pointer",
                            userSelect: "none",
                            flexShrink: 0,
                            position: "relative",
                            zIndex: isSelected ? 2 : 1,

                            bgcolor:
                              item.type === "change" || item.type === "deletion"
                                ? "#fde8e8"
                                : "#ffffff",

                            borderColor: isSelected
                              ? "#2A276E"
                              : item.type === "change" || item.type === "deletion"
                              ? "#e57373"
                              : "#cdd2d7",

                            boxShadow: isSelected
                              ? "0 0 0 2px #2A276E, 0 0 0 4px rgba(42, 39, 110, 0.25)"
                              : item.type === "change" || item.type === "deletion"
                              ? "0 0 0 2px #e53935"
                              : "none",

                            color: "#2f353c",

                            transition:
                              "box-shadow 0.15s ease, border-color 0.15s ease, transform 0.15s ease",
                          }}
                        >
                          {isEmpty ? "" : item.masterChar === " " ? "·" : item.masterChar}
                        </Box>
                      );
                    })}

                    {/* Filler boxes to fill remaining width */}
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Box
                        key={`mf-${i}`}
                        sx={{
                          flex: 1,
                          minWidth: 22,
                          height: 24,
                          border: "1px dashed #e0e0e0",
                          borderRadius: 0.5,
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </Box>

                  {/* Sample Row */}
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.25,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        color: "#50575e",
                        minWidth: 48,
                        flexShrink: 0,
                      }}
                    >
                      Sample
                    </Typography>

                    {characterDifferences.map((item) => {
                      const isSelected = item.index === selectedCharacterIndex;
                      const isEmpty = item.sampleChar === "";

                      return (
                        <Box
                          key={`s-${item.index}`}
                          onClick={() => setSelectedCharacterIndex(item.index)}
                          sx={{
                            minWidth: 22,
                            height: 24,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: "1px solid #cdd2d7",
                            borderRadius: 0.5,
                            fontSize: 12,
                            fontFamily: "monospace",
                            cursor: "pointer",
                            userSelect: "none",
                            flexShrink: 0,
                            position: "relative",
                            zIndex: isSelected ? 2 : 1,

                            bgcolor:
                              item.type === "change" || item.type === "insertion"
                                ? "#fde8e8"
                                : "#ffffff",

                            borderColor: isSelected
                              ? "#2A276E"
                              : item.type === "change" || item.type === "insertion"
                              ? "#e57373"
                              : "#cdd2d7",

                            boxShadow: isSelected
                              ? "0 0 0 2px #2A276E, 0 0 0 4px rgba(42, 39, 110, 0.25)"
                              : item.type === "change" || item.type === "insertion"
                              ? "0 0 0 2px #e53935"
                              : "none",

                            color: "#2f353c",

                            transition:
                              "box-shadow 0.15s ease, border-color 0.15s ease, transform 0.15s ease",
                          }}
                        >
                          {isEmpty ? "" : item.sampleChar === " " ? "·" : item.sampleChar}
                        </Box>
                      );
                    })}

                    {/* Filler boxes to fill remaining width */}
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Box
                        key={`sf-${i}`}
                        sx={{
                          flex: 1,
                          minWidth: 22,
                          height: 24,
                          border: "1px dashed #e0e0e0",
                          borderRadius: 0.5,
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </Box>
                </Box>

                {/* Next Difference */}
                <IconButton
                  size="small"
                  disabled={
                    currentDifferenceIndex < 0 ||
                    currentDifferenceIndex >= result.differences.length - 1
                  }
                  onClick={handleNextDifference}
                  sx={{
                    bgcolor: "#2A276E",
                    color: "#ffffff",
                    "&:hover": {
                      bgcolor: "#1f1d57",
                    },
                    "&.Mui-disabled": {
                      bgcolor: "#d9d9d9",
                      color: "#8a8a8a",
                    },
                  }}
                >
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          )}

          {/* =========================================================
          SHARE REPORT DIALOG
         ========================================================= */}

          <ReportOptionsDialog
            open={reportOptionsOpen}
            onClose={() => setReportOptionsOpen(false)}
            onDownload={handleDownloadWithOptions}
            levelOptions={availableLevelOptions}
            key={availableLevelOptions.join("|")}
          />

          <Dialog
            open={shareOpen}
            onClose={handleShareClose}
            maxWidth="xs"
            fullWidth
          >
            <DialogTitle
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontWeight: 700,
                color: "#2A276E",
              }}
            >
              File share
              <IconButton
                size="small"
                onClick={handleShareClose}
                disabled={shareLoading}
                sx={{
                  color: "#50575e",
                  "&:hover": {
                    bgcolor: "rgba(0, 0, 0, 0.06)",
                  },
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>

            <DialogContent>
              <DialogContentText
                sx={{
                  mb: 2,
                  color: "#50575e",
                }}
              >
                Please enter an email address of the user you would like to share
                this inspection report with.
              </DialogContentText>

              <TextField
                autoFocus
                fullWidth
                size="small"
                label="Email address *"
                placeholder="Email address"
                type="email"
                value={shareEmail}
                onChange={(event) => handleShareEmailChange(event.target.value)}
                error={Boolean(shareEmailError)}
                helperText={shareEmailError ?? ""}
                disabled={shareLoading}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !shareLoading) {
                    event.preventDefault();
                    void handleShareSubmit();
                  }
                }}
              />

              {shareError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {shareError}
                </Alert>
              )}
            </DialogContent>

            <DialogActions
              sx={{
                px: 3,
                pb: 2,
              }}
            >
              <Button
                onClick={handleShareClose}
                disabled={shareLoading}
                sx={{
                  textTransform: "none",
                  color: "#50575e",
                }}
              >
                Cancel
              </Button>

              <Button
                variant="contained"
                onClick={() => void handleShareSubmit()}
                disabled={shareLoading || !shareEmail.trim()}
                startIcon={
                  shareLoading ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : undefined
                }
                sx={{
                  textTransform: "none",
                  bgcolor: "#2A276E",
                  "&:hover": {
                    bgcolor: "#1f1d57",
                  },
                  "&.Mui-disabled": {
                    bgcolor: "#d9d9d9",
                    color: "#8a8a8a",
                  },
                }}
              >
                {shareLoading ? "Sharing..." : "Share"}
              </Button>
            </DialogActions>
          </Dialog>

          {/* =========================================================
          SUCCESS SNACKBAR
         ========================================================= */}

          <Snackbar
            open={shareSuccess}
            autoHideDuration={4000}
            onClose={() => setShareSuccess(false)}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          >
            <Alert
              onClose={() => setShareSuccess(false)}
              severity="success"
              variant="filled"
              sx={{ width: "100%" }}
            >
              Inspection report shared successfully.
            </Alert>
          </Snackbar>

          <Snackbar
            open={Boolean(commentSaveFeedback && commentSaveFeedback.severity !== "success")}
            autoHideDuration={4000}
            onClose={() => setCommentSaveFeedback(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          >
            {commentSaveFeedback ? (
              <Alert
                onClose={() => setCommentSaveFeedback(null)}
                severity={commentSaveFeedback.severity}
                variant="filled"
                sx={{ width: "100%" }}
              >
                {commentSaveFeedback.message}
              </Alert>
            ) : undefined}
          </Snackbar>

          {/* =========================================================
          CROP COMPARE RESULTS DIALOG
          Shows region-scoped findings from the crop pipeline — kept
          separate from the main full-page difference table.
         ========================================================= */}

          <Dialog
            open={cropDialogOpen}
            onClose={() => setCropDialogOpen(false)}
            maxWidth="md"
            fullWidth
          >
            <DialogTitle
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                bgcolor: "#2A276E",
                color: "#ffffff",
              }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Crop Compare Results
                </Typography>
                {cropRegion && (
                  <Typography variant="caption" sx={{ opacity: 0.85 }}>
                    Page {cropRegion.page + 1} · region x=
                    {Math.round(cropRegion.box.x)}, y=
                    {Math.round(cropRegion.box.y)}, w=
                    {Math.round(cropRegion.box.width)}, h=
                    {Math.round(cropRegion.box.height)} px (DPI 150)
                  </Typography>
                )}
              </Box>
              <IconButton
                size="small"
                onClick={() => setCropDialogOpen(false)}
                sx={{ color: "#ffffff" }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>

            <DialogContent dividers sx={{ p: 0 }}>
              {cropRunning ? (
                <Box sx={{ py: 6, textAlign: "center" }}>
                  <CircularProgress size={32} />
                  <Typography sx={{ mt: 2 }} color="text.secondary">
                    Running crop inspection…
                  </Typography>
                </Box>
              ) : cropError ? (
                <Alert severity="error" sx={{ m: 2 }}>
                  {cropError}
                </Alert>
              ) : cropResult ? (
                <Box>
                  <Box
                    sx={{
                      px: 2,
                      py: 1.5,
                      bgcolor: "#f7f8f9",
                      borderBottom: "1px solid #e0e0e0",
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, color: "#3f4650" }}
                    >
                      {cropResult.findings.length}{" "}
                      {cropResult.findings.length === 1 ? "difference" : "differences"} found in this region
                    </Typography>
                    <Typography variant="caption" sx={{ color: "#68717b" }}>
                      {cropResult.match_stats.matched_pairs} matched ·{" "}
                      {cropResult.match_stats.unmatched_master} missing in sample ·{" "}
                      {cropResult.match_stats.unmatched_sample} extra in sample
                    </Typography>
                  </Box>
                  {cropResult.findings.length > 0 ? (
                    <TableContainer sx={{ maxHeight: 420, overflow: "auto" }}>
                      <Table stickyHeader size="small" sx={{ minWidth: 760 }}>
                        <TableHead>
                          <TableRow>
                            {["ID", "Type", "Master", "Sample", "Comment"].map((label) => (
                              <TableCell
                                key={label}
                                sx={{
                                  bgcolor: "#f3f5f7",
                                  color: "#50575e",
                                  fontWeight: 700,
                                  borderBottom: "1px solid #cdd2d7",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {label}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {cropResult.findings.map((finding) => (
                            <TableRow key={finding.id} hover>
                              <TableCell sx={{ whiteSpace: "nowrap" }}>
                                {finding.id}
                              </TableCell>
                              <TableCell sx={{ whiteSpace: "nowrap" }}>
                                {finding.type}
                              </TableCell>
                              <TableCell sx={{ minWidth: 180, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                                {finding.master || "—"}
                              </TableCell>
                              <TableCell sx={{ minWidth: 180, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                                {finding.sample || "—"}
                              </TableCell>
                              <TableCell sx={{ minWidth: 220, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                                {finding.comment || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Typography
                      role="status"
                      sx={{ px: 2, py: 4, color: "#68717b", textAlign: "center" }}
                    >
                      No differences were found in this region.
                    </Typography>
                  )}
                </Box>
              ) : null}
            </DialogContent>

            <DialogActions
              sx={{
                px: 3,
                pb: 2,
              }}
            >
              <Button
                onClick={() => setCropDialogOpen(false)}
                disabled={cropRunning}
                sx={{
                  textTransform: "none",
                  color: "#50575e",
                }}
              >
                Cancel
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}

      {/* =========================================================
      FOOTER
     ========================================================= */}

    </Box>
  );
}