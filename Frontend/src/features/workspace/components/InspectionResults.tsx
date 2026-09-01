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
  Checkbox,
  CircularProgress,
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

import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
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

import ViewerPane from "./ViewerPane";
import ReportOptionsDialog, {
  type ReportOptions,
} from "./ReportOptionsDialog";
import type { BoundingBox } from "@/shared/api/inspectionApi";
import { shareInspectionReport } from "@/shared/api/inspectionApi";
import { truncateFileName } from "@/shared/utils/truncateFileName";
import { getSession } from "@/shared/utils/auth";
import {
  useUploadStore,
  type InspectionType,
} from "@/store/uploadStore";
import {
  downloadInspectionPdf,
  generateInspectionReportPdfBlob,
} from "@/shared/utils/pdfReportGenerator";

export type DifferenceType =
  | "Change"
  | "Insertion"
  | "Deletion"
  | "Hyphen"
  | "Location"
  | "Case"
  | "Bold"
  | "Color"
  | "Font Type"
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
};

export type CharacterDifference = {
  masterChar: string;
  sampleChar: string;
  type: "equal" | "change" | "insertion" | "deletion";
  index: number;
};

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
};

type InspectionResultsProps = {
  result: InspectionResult;
  masterFile: File;
  sampleFile: File;
  selectedDifference?: InspectionDifference | null;
  onDifferenceSelect?: (difference: InspectionDifference) => void;
};

export default function InspectionResults({
  result,
  masterFile,
  sampleFile,
  selectedDifference,
  onDifferenceSelect,
}: InspectionResultsProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<number | null>(
    null
  );

  const [selectedCharacterIndex, setSelectedCharacterIndex] = useState(0);
  const [lastDifferenceId, setLastDifferenceId] = useState<number | null>(null);

  const characterStripRef = useRef<HTMLDivElement | null>(null);
  const selectedCharacterRef = useRef<HTMLDivElement | null>(null);

  const effectiveSelectedId =
    selectedDifference?.id ?? internalSelectedId;

  const selectedDifferenceData =
    result.differences.find((difference) => difference.id === effectiveSelectedId) ??
    null;

  const handleSelect = (difference: InspectionDifference) => {
    if (onDifferenceSelect) {
      onDifferenceSelect(difference);
    } else {
      setInternalSelectedId(difference.id);
    }
  };

  const differenceCount = result.totalDifferences;

  /* ------------------------------------------------------------------ */
  /* Comment / status management                                        */
  /* ------------------------------------------------------------------ */

  const COMMENT_OPTIONS = [
    "Reviewed",
    "Approved",
    "To be verified",
    "None",
    "Comment1",
    "Comment2",
    "Comment3",
  ];

  /**
   * Per-difference comment/status selection from the shared store.
   * Key = difference id, value = selected option (e.g. "Reviewed").
   */
  const commentSelections = useUploadStore(
    (state) => state.commentSelections
  );
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
  const setCustomComments = useUploadStore((state) => state.setCustomComments);

  /** Dialog state for adding a new comment. */
  const [addCommentOpen, setAddCommentOpen] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");

  const getCommentValue = (differenceId: number) =>
    commentSelections[differenceId] ?? "None";

  const handleCommentChange = (differenceId: number, value: string) => {
    setCommentSelections({
      ...commentSelections,
      [differenceId]: value,
    });
  };

  const getLevelValue = (differenceId: number) =>
    levelSelections[differenceId] ?? "";

  const handleLevelChange = (differenceId: number, value: string) => {
    setLevelSelections({
      ...levelSelections,
      [differenceId]: value,
    });
  };

  /** Difference id currently being edited via double-click. */
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");

  const handleStartEdit = (difference: InspectionDifference) => {
    const currentValue = getCommentValue(difference.id);
    // Only allow editing when a Comment1/2/3 is selected
    if (
      currentValue === "Comment1" ||
      currentValue === "Comment2" ||
      currentValue === "Comment3"
    ) {
      setEditingCommentId(difference.id);
      setEditingCommentText(currentValue);
    }
  };

  const handleSaveEdit = (differenceId: number) => {
    const trimmed = editingCommentText.trim();
    if (trimmed) {
      setCommentSelections({
        ...commentSelections,
        [differenceId]: trimmed,
      });
    }
    setEditingCommentId(null);
    setEditingCommentText("");
  };

  const handleAddComment = () => {
    const trimmed = newCommentText.trim();
    if (!trimmed) {
      return;
    }

    const next = [...customComments, trimmed];
    // Keep only the latest 3 custom comments
    setCustomComments(next.length > 3 ? next.slice(next.length - 3) : next);

    setNewCommentText("");
    setAddCommentOpen(false);
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

    if (session?.name) {
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

  const handleOpenDifferenceList = () => {
    console.log("[DIFFERENCE LIST] Button clicked");
    console.log("[DIFFERENCE LIST] Current differences:", result.differences.length);
    console.log("[DIFFERENCE LIST] Current Level values:", levelSelections);
    console.log("[DIFFERENCE LIST] Current Comment values:", commentSelections);

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

  const masterText = selectedDifferenceData?.master ?? "";
  const sampleText = selectedDifferenceData?.sample ?? "";

  const characterDifferences = useMemo(
    () => calculateCharacterDifferences(masterText, sampleText),
    [masterText, sampleText]
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

  const handlePreviousDifference = () => {
    if (currentDifferenceIndex <= 0) {
      return;
    }

    const prev = result.differences[currentDifferenceIndex - 1];
    handleSelect(prev);
  };

  const handleNextDifference = () => {
    if (
      currentDifferenceIndex < 0 ||
      currentDifferenceIndex >= result.differences.length - 1
    ) {
      return;
    }

    const next = result.differences[currentDifferenceIndex + 1];
    handleSelect(next);
  };

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
    [selectedDifferenceData, currentDifferenceIndex, result.differences]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

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
        bgcolor: "#ffffff",
        display: "flex",
        flexDirection: "column",
        minHeight: "calc(100vh - 72px)",
      }}
    >
      {/* =========================================================
          RESULT HEADER
         ========================================================= */}

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
        {/* Difference Count */}

        <Box
          sx={{
            height: 34,
            px: 1.2,
            display: "flex",
            alignItems: "center",
            border: "1px solid #bfc5cc",
            bgcolor: "#f7f8f9",
            mr: 1.2,
          }}
        >
          <Typography
            sx={{
              fontSize: 15,
              fontWeight: 700,
              color: "#3f4650",
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

        <Tooltip title="Share" arrow>
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

        <Tooltip title="Zoom" arrow>
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

        <Tooltip title="Change the sample" arrow>
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

        <Tooltip title="Annotation list" arrow>
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

        <Tooltip title="Download the PDF report" arrow>
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

        <Tooltip title="Open difference list" arrow>
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

      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          maxHeight: 250,
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
                Type
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
                Master
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
                Sample
              </TableCell>

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
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 0.5,
                  }}
                >
                  Comment
                  <Tooltip title="Add comment" arrow>
                    <IconButton
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        setAddCommentOpen(true);
                      }}
                      sx={{
                        p: 0.25,
                        color: "#2A276E",
                        "&:hover": {
                          bgcolor: "rgba(42, 39, 110, 0.08)",
                        },
                      }}
                    >
                      <AddCommentOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
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
                  onClick={() => handleSelect(difference)}
                  sx={{
                    cursor: "pointer",
                    bgcolor: isSelected ? "rgba(42, 39, 110, 0.06)" : "transparent",

                    "&:hover": {
                      bgcolor: isSelected ? "rgba(42, 39, 110, 0.08)" : "#edf3ff",
                    },
                  }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox size="small" />
                  </TableCell>

                  <TableCell
                    sx={{
                      fontSize: 14,
                      color: "#535a62",
                    }}
                  >
                    {difference.id}
                  </TableCell>

                  <TableCell
                    sx={{
                      fontSize: 14,
                      color: "#535a62",
                    }}
                  >
                    {difference.type}
                  </TableCell>

                  <TableCell
                    sx={{
                      fontSize: 14,
                      color: "#535a62",
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={difference.master}
                  >
                    {difference.master}
                  </TableCell>

                  <TableCell
                    sx={{
                      fontSize: 14,
                      color: "#535a62",
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={difference.sample}
                  >
                    {difference.sample}
                  </TableCell>

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
                        <MenuItem value="Low">Low</MenuItem>
                        <MenuItem value="Medium">Medium</MenuItem>
                        <MenuItem value="High">High</MenuItem>
                        <MenuItem value="Critical">Critical</MenuItem>
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
                          {COMMENT_OPTIONS.map((option) => (
                            <MenuItem key={option} value={option}>
                              {option}
                            </MenuItem>
                          ))}

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

      {/* =========================================================
          SELECTED DIFFERENCE DETAILS
         ========================================================= */}

      {selectedDifferenceData && (
        <Box
          sx={{
            borderTop: "1px solid #d5d9dd",
            bgcolor: "#f8f9fa",
            px: 2,
            py: 1.5,
            flexShrink: 0,
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

            <Typography
              variant="body2"
              sx={{
                color: "#50575e",
                fontWeight: 600,
              }}
            >
              {selectedDifferenceData.type} — Page {selectedDifferenceData.page ?? 1}
            </Typography>
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
                Master value
              </Typography>
              <Typography sx={{ mt: 0.5, color: "#2f353c" }}>
                {selectedDifferenceData.master || "—"}
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
                Sample value
              </Typography>
              <Typography sx={{ mt: 0.5, color: "#2f353c" }}>
                {selectedDifferenceData.sample || "—"}
              </Typography>
            </Paper>
          </Box>
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
          gap: selectedDifferenceData ? 2 : 0,
        }}
      >
        <Box
          sx={{
            flex: 1,
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          <ViewerPane
            title="Master Artwork"
            file={masterFile}
            inspectionType={result.inspectionType}
            side="master"
            selectedDifference={selectedDifferenceData}
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
          />
        </Box>

        <Box
          sx={{
            flex: 1,
            overflow: "hidden",
            minWidth: 0,
          }}
        >
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
      </Box>

      {/* =========================================================
          CHARACTER DIFFERENCE PANEL (BOTTOM)
         ========================================================= */}

      {selectedDifferenceData && (
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
      )}

      {/* =========================================================
          SHARE REPORT DIALOG
         ========================================================= */}

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

      {/* =========================================================
          ADD COMMENT DIALOG
         ========================================================= */}

      <Dialog
        open={addCommentOpen}
        onClose={() => setAddCommentOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle
          sx={{
            fontWeight: 700,
            color: "#2A276E",
          }}
        >
          Add Comment
        </DialogTitle>

        <DialogContent>
          <DialogContentText
            sx={{
              mb: 2,
              color: "#50575e",
            }}
          >
            Enter a comment. It will appear in the Comment dropdown for all
            differences.
          </DialogContentText>

          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Comment"
            placeholder="Type your comment..."
            value={newCommentText}
            onChange={(event) => setNewCommentText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAddComment();
              }
            }}
          />
        </DialogContent>

        <DialogActions
          sx={{
            px: 3,
            pb: 2,
          }}
        >
          <Button
            onClick={() => {
              setNewCommentText("");
              setAddCommentOpen(false);
            }}
            sx={{
              textTransform: "none",
              color: "#50575e",
            }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={handleAddComment}
            disabled={!newCommentText.trim()}
            sx={{
              textTransform: "none",
              bgcolor: "#2A276E",
              "&:hover": {
                bgcolor: "#1f1d57",
              },
            }}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      {/* =========================================================
          REPORT OPTIONS DIALOG (DOWNLOAD PDF)
         ========================================================= */}

      <ReportOptionsDialog
        key={availableLevelOptions.join("|")}
        open={reportOptionsOpen}
        onClose={() => setReportOptionsOpen(false)}
        onDownload={handleDownloadWithOptions}
        levelOptions={availableLevelOptions}
      />
    </Box>
  );
}