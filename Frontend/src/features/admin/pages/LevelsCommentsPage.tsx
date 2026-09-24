import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";

import { BRAND_NAVY } from "../components/adminUtils";
import { SnackBar, type Snack } from "../components/adminUi";
import {
  useSetupConfig,
  useUpdateSetupConfig,
} from "@/shared/hooks/useSetupConfig";
import type { SetupLevels, SetupComments } from "../systemApi";

const LEVEL_LABELS: Record<string, string> = {
  default1: "Default 1",
  default2: "Default 2",
  custom1: "Custom 1",
  custom2: "Custom 2",
  custom3: "Custom 3",
  custom4: "Custom 4",
  custom5: "Custom 5",
};

const COMMENT_LABELS: Record<string, string> = {
  default1: "Default 1",
  custom1: "Custom 1",
  custom2: "Custom 2",
  custom3: "Custom 3",
  custom4: "Custom 4",
  custom5: "Custom 5",
  custom6: "Custom 6",
  custom7: "Custom 7",
  custom8: "Custom 8",
  custom9: "Custom 9",
  custom10: "Custom 10",
};

export default function LevelsCommentsPage() {
  const { data: config, isLoading, isError, error } = useSetupConfig();
  const updateConfig = useUpdateSetupConfig();

  const [levelDraft, setLevelDraft] = useState<Partial<SetupLevels>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [snack, setSnack] = useState<Snack>(null);

  const [prevConfig, setPrevConfig] = useState(config);

  if (config !== prevConfig) {
    setPrevConfig(config);

    if (config) {
      setLevelDraft(
        (Object.keys(LEVEL_LABELS) as Array<keyof SetupLevels>).reduce<
          Partial<SetupLevels>
        >((acc, key) => ({ ...acc, [key]: config.levels[key] ?? "" }), {})
      );

      setCommentDraft(
        (Object.keys(COMMENT_LABELS) as Array<keyof SetupComments>).reduce<
          Record<string, string>
        >((acc, key) => ({ ...acc, [key]: config.comments[key] ?? "" }), {})
      );
    }
  }

  if (isLoading) {
    return (
      <Box sx={{ p: 8, textAlign: "center" }}>
        <CircularProgress size={34} sx={{ color: BRAND_NAVY }} />
        <Typography sx={{ mt: 2, fontWeight: 500 }}>
          Loading configuration...
        </Typography>
      </Box>
    );
  }

  if (isError || !config) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {(error as Error)?.message ?? "Failed to load configuration."}
        </Alert>
      </Box>
    );
  }

  const handleUpdate = () => {
    setSnack(null);

    updateConfig.mutate(
      {
        levels: {
          default1: config.levels.default1,
          default2: config.levels.default2,
          custom1: levelDraft.custom1 ?? config.levels.custom1,
          custom2: levelDraft.custom2 ?? config.levels.custom2,
          custom3: levelDraft.custom3 ?? config.levels.custom3,
          custom4: levelDraft.custom4 ?? config.levels.custom4,
          custom5: levelDraft.custom5 ?? config.levels.custom5,
        },
        comments: {
          default1: config.comments.default1,
          custom1: commentDraft.custom1 ?? config.comments.custom1,
          custom2: commentDraft.custom2 ?? config.comments.custom2,
          custom3: commentDraft.custom3 ?? config.comments.custom3,
          custom4: commentDraft.custom4 ?? config.comments.custom4,
          custom5: commentDraft.custom5 ?? config.comments.custom5,
          custom6: commentDraft.custom6 ?? config.comments.custom6,
          custom7: commentDraft.custom7 ?? config.comments.custom7,
          custom8: commentDraft.custom8 ?? config.comments.custom8,
          custom9: commentDraft.custom9 ?? config.comments.custom9,
          custom10: commentDraft.custom10 ?? config.comments.custom10,
        },
      },
      {
        onSuccess: () =>
          setSnack({
            message: "Setup Levels and Comments saved successfully.",
            severity: "success",
          }),
        onError: (err) =>
          setSnack({
            message:
              err instanceof Error
                ? err.message
                : "Failed to save configuration.",
            severity: "error",
          }),
      }
    );
  };

  const textFieldStyle = {
    "& .MuiOutlinedInput-root": {
      borderRadius: 2,
      transition: "all .25s ease",
      backgroundColor: "#fff",
      "&:hover": {
        transform: "translateY(-2px)",
        boxShadow: "0 4px 14px rgba(42,39,110,.12)",
      },
      "&.Mui-focused": {
        boxShadow: "0 0 0 4px rgba(42,39,110,.15)",
      },
    },
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        px: { xs: 2, md: 4 },
        py: 4,
      }}
    >
      <Typography
        variant="h4"
        sx={{
          fontWeight: 700,
          color: BRAND_NAVY,
          textAlign: "center",
          mb: 4,
          letterSpacing: ".3px",
        }}
      >
        Setup Levels & Comments
      </Typography>

      <Paper
        elevation={0}
        sx={{
          maxWidth: 1100,
          mx: "auto",
          p: { xs: 3, md: 4 },
          borderRadius: 4,
          background: "rgba(255,255,255,.92)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(42,39,110,.08)",
          boxShadow: "0 12px 35px rgba(42,39,110,.12)",
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            gap: 5,
          }}
        >
          {/* LEVELS */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
              <Box
                sx={{
                  width: 5,
                  height: 28,
                  bgcolor: BRAND_NAVY,
                  borderRadius: 2,
                  mr: 1.5,
                }}
              />
              <Typography variant="h6" sx={{ fontWeight: 700, color: BRAND_NAVY }}>
                Levels
              </Typography>
            </Box>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {(Object.keys(LEVEL_LABELS) as Array<keyof SetupLevels>).map(
                (key) => (
                  <TextField
                    key={key}
                    fullWidth
                    size="small"
                    label={LEVEL_LABELS[key]}
                    value={levelDraft[key] ?? config.levels[key] ?? ""}
                    disabled={key === "default1" || key === "default2"}
                    onChange={(e) =>
                      setLevelDraft((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    sx={textFieldStyle}
                  />
                )
              )}
            </Box>

            <Typography
              variant="caption"
              sx={{ mt: 2, display: "block", color: "text.secondary" }}
            >
              Default levels are read-only.
            </Typography>
          </Box>

          {/* COMMENTS */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
              <Box
                sx={{
                  width: 5,
                  height: 28,
                  bgcolor: BRAND_NAVY,
                  borderRadius: 2,
                  mr: 1.5,
                }}
              />
              <Typography variant="h6" sx={{ fontWeight: 700, color: BRAND_NAVY }}>
                Comments
              </Typography>
            </Box>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {(Object.keys(COMMENT_LABELS) as Array<keyof SetupComments>).map(
                (key) => (
                  <TextField
                    key={key}
                    fullWidth
                    size="small"
                    label={COMMENT_LABELS[key]}
                    value={commentDraft[key] ?? config.comments[key] ?? ""}
                    disabled={key === "default1"}
                    onChange={(e) =>
                      setCommentDraft((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    sx={textFieldStyle}
                  />
                )
              )}
            </Box>

            <Typography
              variant="caption"
              sx={{ mt: 2, display: "block", color: "text.secondary" }}
            >
              Default comment is read-only.
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ my: 4 }} />

        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <Button
            variant="contained"
            size="large"
            startIcon={
              updateConfig.isPending ? (
                <CircularProgress size={20} color="inherit" />
              ) : (
                <SaveOutlinedIcon />
              )
            }
            disabled={updateConfig.isPending}
            onClick={handleUpdate}
            sx={{
              px: 5,
              py: 1.4,
              borderRadius: 3,
              fontWeight: 700,
              letterSpacing: ".3px",
              background: "linear-gradient(135deg, #2A276E, #3D3A8C)",
              boxShadow: "0 8px 24px rgba(42,39,110,.35)",
              transition: "all .25s ease",
              "&:hover": {
                transform: "translateY(-2px)",
                boxShadow: "0 12px 30px rgba(42,39,110,.45)",
                background: "linear-gradient(135deg, #242162, #2A276E)",
              },
            }}
          >
            {updateConfig.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </Box>
      </Paper>

      <SnackBar snack={snack} onClose={() => setSnack(null)} />
    </Box>
  );
}