import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  Box,
  Button,
  Card,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";

import CloseIcon from "@mui/icons-material/Close";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";

import { useUploadStore } from "@/store/uploadStore";
import { truncateFileName } from "@/shared/utils/truncateFileName";
import {
  formatFileSize,
  getFileTypesForInspection,
  getSupportedFileTypesLabel,
  MAX_UPLOAD_SIZE_LABEL,
  validateInspectionFile,
} from "@/shared/utils/fileValidation";

/**
 * Barcode accent — the MedInspect brand navy `rgba(42, 39, 110)` used for the
 * header bar, the "browse" link and the Upload button.
 */
const BRAND = "#2A276E";
/** Hover / pressed shade of the brand navy. */
const BRAND_DARK = "#211F58";
/** Soft tint of the brand navy used for the drag-over background. */
const BRAND_TINT = "#F2F2FA";
/** Error red — reserved for validation messaging only. */
const ERROR_RED = "#C62828";
/** Error border on the drop zone. */
const ERROR_BORDER = "#E57373";

const INSPECTION_TYPE = "barcode";

/**
 * Barcode Inspection upload screen.
 *
 * Visually it is Barcode-specific (brand navy header, single drag-and-drop
 * zone, navy Upload button), but technically it reuses the existing MedInspect
 * infrastructure: on upload it only populates the shared Zustand store and
 * navigates to the existing workspace route, which in turn calls the
 * existing `createInspection` (Blob Storage + Cosmos) and `startInspection`
 * API, renders the existing progress UI and redirects to the existing result
 * page. No new endpoint, upload service, result page or workflow is created.
 */
export default function BarcodeInspectionPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    clearAll,
    setMasterFile,
    setSampleFile,
    setInspectionType,
    setInspectionStatus,
  } = useUploadStore();

  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Clear any previous Barcode Inspection files/results when entering the
  // upload page, so a stale selection can never be uploaded.
  useEffect(() => {
    clearAll();
    setInspectionStatus("idle");
    setInspectionType(INSPECTION_TYPE);
  }, [clearAll, setInspectionType, setInspectionStatus]);

  const supportedTypesLabel = getSupportedFileTypesLabel(INSPECTION_TYPE);
  const accept = getFileTypesForInspection(INSPECTION_TYPE).join(",");

  const openFilePicker = () => fileInputRef.current?.click();

  const selectFile = (candidate: File) => {
    const result = validateInspectionFile(candidate, INSPECTION_TYPE);

    if (!result.isValid) {
      // Inline error, layout untouched; any previous selection is cleared.
      setFile(null);
      setError(result.error);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setFile(candidate);
    setError("");
  };

  const clearFile = () => {
    setFile(null);
    setError("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const dropped = event.dataTransfer.files?.[0];

    if (dropped) {
      selectFile(dropped);
    }
  };

  const handleDropZoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  };

  const handleUpload = () => {
    if (!file || error !== "" || isUploading) {
      return;
    }

    const result = validateInspectionFile(file, INSPECTION_TYPE);

    if (!result.isValid) {
      setError(result.error);
      return;
    }

    setIsUploading(true);

    /*
     * Barcode inspection analyses a single source file, so the selection is
     * stored as BOTH master and sample. The existing workspace route performs
     * the upload, inspection record, run, progress UI and the redirect to the
     * existing result page.
     */
    setMasterFile(file);
    setSampleFile(file);
    setInspectionType(INSPECTION_TYPE);

    navigate(`/workspace/${INSPECTION_TYPE}`);
  };

  return (
    /* Page frame: white background with the card centred horizontally. */
    <Box
      sx={{
        minHeight: "calc(100vh - 72px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        pt: 6,
        pb: 6,
        bgcolor: "#FFFFFF",
      }}
    >
    <Box sx={{ width: "100%", maxWidth: 500, px: 2 }}>
      <Card
        elevation={0}
        sx={{
          width: "100%",
          borderRadius: 1.5,
          overflow: "hidden",
          border: "1px solid #E0E0E0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        {/* ================= Brand navy header bar ================= */}
        <Box
          sx={{
            bgcolor: BRAND,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 2.5,
            height: 56,
          }}
        >
          <BarcodeGlyph />

          <Typography
            sx={{
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: 0.2,
              fontFamily: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            }}
          >
            Barcode Inspection
          </Typography>
        </Box>
        {/* ================= White content area ================= */}
        <Box sx={{ p: 2.5, bgcolor: "#fff" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            hidden
            onChange={(event) => {
              const selected = event.target.files?.[0];

              if (selected) {
                selectFile(selected);
              }
            }}
          />

          {/* ---------- Drag & drop zone ---------- */}
          <Box
            role="button"
            tabIndex={0}
            aria-label="Upload a barcode source file. Press Enter to browse."
            onClick={openFilePicker}
            onKeyDown={handleDropZoneKeyDown}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            sx={{
              height: 148,
              width: "100%",
              bgcolor: "#fff",
              border: error
                ? "1px solid " + ERROR_BORDER
                : isDragging
                ? `1px solid ${BRAND}`
                : "1px solid #D5D5D5",
              borderRadius: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "border-color .2s ease, background-color .2s ease",
              outline: "none",
              "&:hover": { borderColor: BRAND },
              "&:focus-visible": {
                borderColor: BRAND,
                boxShadow: `0 0 0 2px ${BRAND}33`,
              },
              ...(isDragging ? { bgcolor: BRAND_TINT } : {}),
            }}
          >
            {file ? (
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ px: 2, maxWidth: "100%", alignItems: "center" }}
              >
                <InsertDriveFileOutlinedIcon
                  sx={{ color: BRAND, fontSize: 34 }}
                />

                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontWeight: 600,
                      fontSize: 14,
                      color: "#212121",
                    }}
                    title={file.name}
                  >
                    {truncateFileName(file.name, 30)}
                  </Typography>

                  <Typography sx={{ fontSize: 12, color: "#757575" }}>
                    {formatFileSize(file.size)}
                    {" · "}
                    {file.type || "Unknown type"}
                  </Typography>
                </Box>

                <IconButton
                  aria-label="Remove selected file"
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    clearFile();
                  }}
                  sx={{ color: "#9E9E9E", "&:hover": { color: BRAND } }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ) : (
              <Box sx={{ textAlign: "center", px: 2 }}>
                <Typography sx={{ fontSize: 15, color: "#424242" }}>
                  Drop the file or{" "}
                  <Box
                    component="span"
                    onClick={(event) => {
                      event.stopPropagation();
                      openFilePicker();
                    }}
                    sx={{
                      color: BRAND,
                      fontWeight: 700,
                      cursor: "pointer",
                      "&:hover": { textDecoration: "underline" },
                    }}
                  >
                    browse
                  </Box>
                </Typography>

                <Typography sx={{ fontSize: 12, color: "#9E9E9E", mt: 1 }}>
                  (Maximum {MAX_UPLOAD_SIZE_LABEL})
                </Typography>
              </Box>
            )}
          </Box>
          {/* ---------- Inline validation message ---------- */}
          {error !== "" && (
            <Typography
              role="alert"
              sx={{
                mt: 1.5,
                fontSize: 12.5,
                color: ERROR_RED,
                lineHeight: 1.4,
              }}
            >
              {error}
            </Typography>
          )}

          {/* ---------- Upload button ---------- */}
          <Button
            fullWidth
            variant="contained"
            disabled={!file || error !== "" || isUploading}
            onClick={handleUpload}
            sx={{
              mt: 2.5,
              height: 40,
              fontWeight: 600,
              fontSize: 15,
              textTransform: "none",
              bgcolor: BRAND,
              borderRadius: 1,
              "&:hover": { bgcolor: BRAND_DARK },
              "&.Mui-disabled": { bgcolor: "#E0E0E0", color: "#9E9E9E" },
            }}
          >
            {isUploading ? (
              <CircularProgress size={20} sx={{ color: "#fff" }} />
            ) : (
              "Upload"
            )}
          </Button>

          {/* ---------- Description ---------- */}
          <Typography
            sx={{
              mt: 2.5,
              textAlign: "center",
              fontSize: 13.5,
              color: "#616161",
              lineHeight: 1.55,
            }}
          >
            Decode and grade linear and 2D barcodes in your PDF files or
            printed components.
          </Typography>
        </Box>
      </Card>

      {/* ---------- Supported file types (outside the card) ---------- */}
      <Typography sx={{ mt: 1.5, ml: 0.5, fontSize: 12, color: "#757575" }}>
        Supported file types: {supportedTypesLabel}
      </Typography>
    </Box>
    </Box>
  );
}

/**
 * Barcode / vertical-bars icon for the navy header bar.
 */
function BarcodeGlyph() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      sx={{ width: 24, height: 24, color: "#fff", flexShrink: 0 }}
    >
      <path
        fill="currentColor"
        d="M2 4h2v16H2V4zm3 0h1v16H5V4zm2 0h2v16H7V4zm3 0h1v16h-1V4zm2 0h2v16h-2V4zm3 0h1v16h-1V4zm2 0h2v16h-2V4zm3 0h1v16h-1V4z"
      />
    </Box>
  );
}
