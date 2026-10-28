import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import CancelRoundedIcon from "@mui/icons-material/CancelRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";

import OrganizationLogo from "@/assets/logos/viatris logo.png";
import { getInspectionLabel } from "@/shared/config/inspectionConfig";

type InspectionLoadingProps = {
  inspectionType: string;
  status?: string | null;
  progress?: number;
  failed?: boolean;
  error?: string | null;
  onCancel?: () => void;
};

const BACKEND_STEPS = [
  "Uploading files...",
  "Loading Master...",
  "Loading Sample...",
  "Comparing text...",
  "Detecting differences...",
  "Generating differences...",
  "Preparing inspection results...",
];

const BRAILLE_BACKEND_STEPS = [
  "Uploading Braille document...",
  "Loading Braille document...",
  "Analyzing Braille dots...",
  "Translating Braille...",
  "Preparing Braille results...",
];

export default function InspectionLoading({
  inspectionType,
  status,
  progress,
  failed = false,
  error,
  onCancel,
}: InspectionLoadingProps) {
  const navigate = useNavigate();
  const isBrailleInspection = inspectionType === "braille";
  const backendSteps = isBrailleInspection
    ? BRAILLE_BACKEND_STEPS
    : BACKEND_STEPS;

  /* Map a backend status string to a step index */
  const currentStep = useMemo(() => {
    if (!status) return 0;

    const normalized = status.toLowerCase();

    if (normalized.includes("upload")) return 0;
    if (isBrailleInspection) {
      if (normalized.includes("load")) return 1;
      if (normalized.includes("translat")) return 3;
      if (normalized.includes("prepar")) return 4;
      if (
        normalized.includes("analyz") ||
        normalized.includes("inspect") ||
        normalized.includes("compar")
      ) {
        return 2;
      }
      return 0;
    }

    if (normalized.includes("master")) return 1;
    if (normalized.includes("sample")) return 2;
    if (normalized.includes("compar")) return 3;
    if (normalized.includes("detect") || normalized.includes("generat")) return 4;
    if (normalized.includes("prepar")) return 6;

    return 0;
  }, [isBrailleInspection, status]);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const elapsedTime = `${String(
    Math.floor(elapsedSeconds / 60)
  ).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  /* No fake progress — backend does not provide percentages */
  const displayProgress = progress;

  if (failed) {
    return (
      <Box
        sx={{
          minHeight: "calc(100vh - 72px)",
          bgcolor: "#F5F6FA",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          px: 3,
          py: 4,
        }}
      >
        <Paper
          elevation={4}
          sx={{
            width: 700,
            borderRadius: 3,
            p: 5,
          }}
        >
          <Stack sx={{ alignItems: "center", spacing: 2 }}>
            <Box
              component="img"
              src={OrganizationLogo}
              alt="Organization Logo"
              sx={{
                width: 80,
                height: 80,
                objectFit: "contain",
              }}
            />
            <ErrorOutlineRoundedIcon
              sx={{
                fontSize: 64,
                color: "#d32f2f",
              }}
            />
            <Typography
              variant="h5"
              sx={{ fontWeight: 700, color: "#d32f2f" }}
            >
              Inspection Failed
            </Typography>
            <Typography
              variant="body1"
              sx={{ color: "text.secondary", textAlign: "center" }}
            >
              {error || `${getInspectionLabel(inspectionType)} failed. Please try again.`}
            </Typography>
          </Stack>

          <Stack
            direction="row"
            sx={{
              justifyContent: "center",
              mt: 4,
            }}
          >
            <Button
              variant="contained"
              onClick={() => {
                onCancel?.();
                navigate(`/workspace/${inspectionType}/upload`);
              }}
              sx={{
                bgcolor: "#2A276E",
                "&:hover": {
                  bgcolor: "#211F58",
                },
              }}
            >
              Back to Upload
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 72px)",
        bgcolor: "#F5F6FA",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        px: 3,
        py: 4,
      }}
    >
      <Paper
        elevation={4}
        sx={{
          width: 700,
          borderRadius: 3,
          p: 5,
        }}
      >
        {/* Logo */}

        <Stack
          sx={{ alignItems: "center", spacing: 2 }}
        >
          <Box
            component="img"
            src={OrganizationLogo}
            alt="Organization Logo"
            sx={{
              width: 80,
              height: 80,
              objectFit: "contain",
            }}
          />

          <Typography
            variant="h4"
            sx={{ fontWeight: 700, color: "#2A276E" }}
          >
            {isBrailleInspection ? "Inspecting Braille" : "Inspecting Artwork"}
          </Typography>

          <Typography
            variant="body1"
            sx={{ color: "text.secondary", textAlign: "center" }}
          >
            {isBrailleInspection
              ? "Please wait while the Braille inspection engine analyzes your document."
              : "Please wait while the inspection engine analyzes your documents."}
          </Typography>
        </Stack>

        {/* Circular Loader */}

        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            mt: 5,
            mb: 4,
            position: "relative",
          }}
        >
          {displayProgress !== undefined ? (
            <CircularProgress
              size={90}
              thickness={4}
              variant="determinate"
              value={displayProgress}
              sx={{
                color: "#2A276E",
              }}
            />
          ) : (
            <CircularProgress
              size={90}
              thickness={4}
              sx={{
                color: "#2A276E",
              }}
            />
          )}

          {displayProgress !== undefined && (
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
              }}
            >
              {displayProgress}%
            </Typography>
          )}
        </Box>

        {/* Progress */}

        {displayProgress !== undefined && (
          <LinearProgress
            variant="determinate"
            value={displayProgress}
            sx={{
              height: 10,
              borderRadius: 5,

              "& .MuiLinearProgress-bar": {
                backgroundColor: "#2A276E",
              },
            }}
          />
        )}

        <Stack
          direction="row"
          sx={{ justifyContent: "space-between", mt: 2 }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
          >
            Current Status
          </Typography>

          <Typography
            variant="body2"
            sx={{ fontWeight: 600 }}
          >
            {status ?? "Uploading files..."}
          </Typography>
        </Stack>

        <Stack
          direction="row"
          sx={{ justifyContent: "space-between", mt: 1, mb: 4 }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
          >
            Elapsed Time
          </Typography>

          <Typography sx={{ fontWeight: 600 }}>
            {elapsedTime}
          </Typography>
        </Stack>

        {/* Inspection Steps */}

        <Paper
          variant="outlined"
          sx={{
            mt: 2,
            mb: 4,
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          {backendSteps.map((step, index) => {
            const completed = index < currentStep;
            const active = index === currentStep;

            return (
              <Stack
                key={step}
                direction="row"
                sx={{
                  alignItems: "center",
                  spacing: 2,
                  px: 3,
                  py: 1.6,
                  borderBottom:
                    index !== backendSteps.length - 1
                      ? "1px solid #ECECEC"
                      : "none",

                  bgcolor: active
                    ? "rgba(42,39,110,0.05)"
                    : "#FFFFFF",
                }}
              >
                {/* Status Icon */}

                {completed ? (
                  <CheckCircleRoundedIcon
                    sx={{
                      color: "#4CAF50",
                    }}
                  />
                ) : active ? (
                  <AutorenewRoundedIcon
                    sx={{
                      color: "#2A276E",
                      animation:
                        "spin 1s linear infinite",

                      "@keyframes spin": {
                        from: {
                          transform: "rotate(0deg)",
                        },
                        to: {
                          transform: "rotate(360deg)",
                        },
                      },
                    }}
                  />
                ) : (
                  <RadioButtonUncheckedRoundedIcon
                    sx={{
                      color: "#BDBDBD",
                    }}
                  />
                )}

                <Typography
                  sx={{
                    flex: 1,
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {step}
                </Typography>

                {completed && (
                  <Typography
                    variant="caption"
                    color="success.main"
                    sx={{ fontWeight: 600 }}
                  >
                    Completed
                  </Typography>
                )}

                {active && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: "#2A276E",
                      fontWeight: 700,
                    }}
                  >
                    Processing...
                  </Typography>
                )}
              </Stack>
            );
          })}
        </Paper>

        {/* Footer */}

        <Stack
          direction="row"
          sx={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
          >
            Please do not close this window while the
            inspection is in progress.
          </Typography>

          <Button
            variant="outlined"
            color="error"
            startIcon={<CancelRoundedIcon />}
            onClick={() => onCancel?.()}
          >
            Cancel
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}