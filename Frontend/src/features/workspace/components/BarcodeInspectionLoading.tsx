import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";

import {
  BARCODE_STAGE_LABELS,
  resolveBarcodeStage,
} from "@/shared/config/barcodeInspectionConfig";

/* -------------------------------------------------------------------------- */
/*                        MedInspect BLACK + BLUE theme                      */
/* -------------------------------------------------------------------------- */

/** Existing MedInspect brand navy (also used by the logo/toolbars). */
const BRAND_NAVY = "#2A276E";

type BarcodeInspectionLoadingProps = {
  /**
   * Real stage id reported by the backend (e.g. "barcode_decoding"). The screen
   * never invents progress — it renders exactly what the engine last reported.
   */
  stage?: string | null;
  /** Current page and document page count, as reported by the engine. */
  progress?: { currentPage: number; totalPages: number } | null;
  /** True while the cancel request is in flight. */
  isCancelling?: boolean;
  /** Cancels the running job and returns to the document viewer. */
  onCancel: () => void;
};

/**
 * Barcode Inspection processing screen — a SINGLE-FILE workflow.
 *
 * Deliberately simple and centred: spinner, one message, Cancel Inspection and
 * the current engine stage. There is no Master/Sample/Difference progress
 * here; Barcode Inspection never compares two files.
 */
export default function BarcodeInspectionLoading({
  stage,
  progress = null,
  isCancelling = false,
  onCancel,
}: BarcodeInspectionLoadingProps) {
  const currentStage = resolveBarcodeStage(stage);

  return (
    <Box
      data-testid="barcode-inspection-loading"
      sx={{
        minHeight: "calc(100vh - 72px)",
        bgcolor: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 3,
        py: 6,
      }}
    >
      <Stack
        spacing={4}
        sx={{ alignItems: "center", textAlign: "center", maxWidth: 560 }}
      >
        {/* Centered loading indicator in the brand blue. */}
        <CircularProgress
          size={64}
          thickness={3}
          aria-label="Barcode inspection in progress"
          sx={{ color: BRAND_NAVY }}
        />

        <Typography
          variant="h6"
          sx={{ color: "#1B1B1B", lineHeight: 1.5 }}
        >
          Please wait while the file(s) are being inspected...
        </Typography>

        <Button
          variant="outlined"
          onClick={onCancel}
          disabled={isCancelling}
          sx={{
            px: 4,
            py: 1.2,
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
          {isCancelling ? "Cancelling..." : "Cancel Inspection"}
        </Button>

        {/* Real backend stage, e.g. "Barcode Detection". */}
        <Typography
          data-testid="barcode-inspection-stage"
          variant="body1"
          sx={{ color: "#535A62", fontWeight: 600 }}
        >
          {stage ? BARCODE_STAGE_LABELS[currentStage] : "Uploading file..."}
        </Typography>
        {progress && progress.totalPages > 0 && (
          <Typography
            data-testid="barcode-inspection-progress"
            variant="body2"
            sx={{ color: "#535A62" }}
          >
            Page {progress.currentPage} of {progress.totalPages}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
