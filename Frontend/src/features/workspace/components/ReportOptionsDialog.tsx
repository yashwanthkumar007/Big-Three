import { useState } from "react";

import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";

import CloseIcon from "@mui/icons-material/Close";

export type ReportOptions = {
  createAnnotatedArtwork: boolean;
  selectedLevels: string[];
  includeMasterFile: boolean;
  includeTextReportParameters: boolean;
  comment: string;
};

/**
 * Default level options shown in the download popup. These can be
 * overridden with a dynamic `levelOptions` prop — for example when
 * admins add custom severity filters in the future, the popup will
 * automatically show only the levels that exist on the differences.
 */
const REPORT_LEVEL_OPTIONS = ["None", "Low", "Medium", "High", "Critical"];

type ReportOptionsDialogProps = {
  open: boolean;
  onClose: () => void;
  onDownload: (options: ReportOptions) => void;
  /** Dynamic list of level options. Defaults to REPORT_LEVEL_OPTIONS. */
  levelOptions?: string[];
};

export default function ReportOptionsDialog({
  open,
  onClose,
  onDownload,
  levelOptions,
}: ReportOptionsDialogProps) {
  const [createAnnotatedArtwork, setCreateAnnotatedArtwork] = useState(true);

  // Dynamic level options — falls back to the default list when no
  // prop is provided, so future admin-defined custom levels appear here.
  // NOTE: The parent passes a `key` that changes whenever the available
  // levels change, which remounts this dialog and re-initializes the
  // selected levels below.
  const levelChoices = levelOptions ?? REPORT_LEVEL_OPTIONS;
  const [selectedLevels, setSelectedLevels] = useState<string[]>(
    levelChoices.map((level) => level)
  );

  const [includeMasterFile, setIncludeMasterFile] = useState(false);
  const [includeTextReportParameters, setIncludeTextReportParameters] =
    useState(true);
  const [comment, setComment] = useState("");

  const handleToggleLevel = (level: string) => {
    setSelectedLevels((prev) =>
      prev.includes(level)
        ? prev.filter((item) => item !== level)
        : [...prev, level]
    );
  };

  const handleDownload = () => {
    onDownload({
      createAnnotatedArtwork,
      selectedLevels,
      includeMasterFile,
      includeTextReportParameters,
      comment,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontWeight: 700,
          color: "#2A276E",
          borderBottom: "1px solid #d5d9dd",
          pb: 1.5,
        }}
      >
        Report Options
        <IconButton
          size="small"
          onClick={onClose}
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

      <DialogContent sx={{ pt: 2.5 }}>
        {/* MedInspect Report section — padding is applied ABOVE the box
            (outer margin) so the box itself keeps a compact look. */}
        <Box
          sx={{
            border: "1px solid #d5d9dd",
            borderRadius: 1.5,
            pt: 1.5,
            pb: 1.5,
            pl: 1.5,
            pr: 1.5,
            mb: 2,
            mt: 2.5,
            bgcolor: "#f8f9fa",
          }}
        >
          <Typography
            sx={{
              fontWeight: 700,
              color: "#2A276E",
              fontSize: 14,
            }}
          >
            MedInspect Report
          </Typography>
        </Box>

        {/* Annotated artwork */}
        <FormControlLabel
          control={
            <Checkbox
              checked={createAnnotatedArtwork}
              onChange={(event) =>
                setCreateAnnotatedArtwork(event.target.checked)
              }
              size="small"
              sx={{
                color: "#2A276E",
                "&.Mui-checked": {
                  color: "#2A276E",
                },
              }}
            />
          }
          label="Create Annotated Artwork File"
          sx={{ mb: 0.5 }}
        />

        <Divider sx={{ my: 1.5 }} />

        {/* Level / severity filters */}
        <Typography
          sx={{
            fontWeight: 700,
            color: "#50575e",
            fontSize: 13,
            mb: 1,
          }}
        >
          Include differences with level:
        </Typography>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 0.5,
          }}
        >
          {levelChoices.map((level) => (
            <FormControlLabel
              key={level}
              control={
                <Checkbox
                  checked={selectedLevels.includes(level)}
                  onChange={() => handleToggleLevel(level)}
                  size="small"
                  sx={{
                    color: "#2A276E",
                    "&.Mui-checked": {
                      color: "#2A276E",
                    },
                  }}
                />
              }
              label={level}
            />
          ))}
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* Include master file */}
        <FormControlLabel
          control={
            <Checkbox
              checked={includeMasterFile}
              onChange={(event) =>
                setIncludeMasterFile(event.target.checked)
              }
              size="small"
              sx={{
                color: "#2A276E",
                "&.Mui-checked": {
                  color: "#2A276E",
                },
              }}
            />
          }
          label="Include Master File"
          sx={{ mb: 0.5 }}
        />

        {/* Include text report parameters */}
        <FormControlLabel
          control={
            <Checkbox
              checked={includeTextReportParameters}
              onChange={(event) =>
                setIncludeTextReportParameters(event.target.checked)
              }
              size="small"
              sx={{
                color: "#2A276E",
                "&.Mui-checked": {
                  color: "#2A276E",
                },
              }}
            />
          }
          label="Include Text Report Parameters"
          sx={{ mb: 1.5 }}
        />

        <Divider sx={{ my: 1.5 }} />

        {/* Comment */}
        <Typography
          sx={{
            fontWeight: 700,
            color: "#50575e",
            fontSize: 13,
            mb: 1,
          }}
        >
          Comment
        </Typography>

        <TextField
          fullWidth
          multiline
          minRows={3}
          maxRows={6}
          placeholder="Type your comment..."
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          size="small"
        />
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          pb: 2,
          borderTop: "1px solid #d5d9dd",
          pt: 1.5,
        }}
      >
        <Button
          onClick={onClose}
          sx={{
            textTransform: "none",
            color: "#50575e",
          }}
        >
          Cancel
        </Button>

        <Button
          variant="contained"
          onClick={handleDownload}
          sx={{
            textTransform: "none",
            bgcolor: "#2A276E",
            "&:hover": {
              bgcolor: "#1f1d57",
            },
          }}
        >
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
}