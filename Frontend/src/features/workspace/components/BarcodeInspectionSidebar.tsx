import { useMemo, useState } from "react";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Typography,
} from "@mui/material";

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import { useUploadStore } from "@/store/uploadStore";
import {
  BARCODE_PROFILES,
  BARCODE_RESOLUTIONS,
  validateBarcodeConfig,
} from "@/shared/config/barcodeInspectionConfig";

/* -------------------------------------------------------------------------- */
/*                        MedInspect BLACK + BLUE theme                      */
/* -------------------------------------------------------------------------- */

/** Existing MedInspect brand navy (also used by the logo/toolbars). */
const BRAND_NAVY = "#2A276E";

/** Lighter brand tone already used across the app for active states. */
const BRAND_NAVY_LIGHT = "#3F3B99";

const PANEL_BG = "#16181D";
const PANEL_BORDER = "#2B2E35";

type BarcodeInspectionSidebarProps = {
  /** Number of pages in the uploaded document (drives the page list). */
  pageCount: number;
  /** True while an inspection is running, so the button can be disabled. */
  isInspecting?: boolean;
  onClose: () => void;
  /** The ONLY action that starts Barcode Inspection. */
  onInspect: () => void;
};

export default function BarcodeInspectionSidebar({
  pageCount,
  isInspecting = false,
  onClose,
  onInspect,
}: BarcodeInspectionSidebarProps) {
  const config = useUploadStore((state) => state.barcodeConfig);
  const patchBarcodeConfig = useUploadStore(
    (state) => state.patchBarcodeConfig,
  );
  const resetBarcodeConfig = useUploadStore(
    (state) => state.resetBarcodeConfig,
  );

  const [errors, setErrors] = useState<string[]>([]);

  /* The page list is generated from the uploaded document, never hard-coded. */
  const pageOptions = useMemo(
    () => Array.from({ length: Math.max(pageCount, 0) }, (_, index) => index + 1),
    [pageCount],
  );

  const handleInspect = () => {
    const validation = validateBarcodeConfig(config, pageCount);
    setErrors(validation.errors);
    if (!validation.valid) {
      return;
    }
    onInspect();
    onClose();
  };

  const pageValue =
    config.pages === "all"
      ? "all"
      : Array.isArray(config.pages)
        ? config.pages.join(",")
        : String(config.pages);

  return (
    <Box
      data-testid="barcode-inspection-sidebar"
      sx={{
        /*
         * The panel always covers the screen from the top edge down, floating
         * over the document viewer. Clicking anywhere outside it closes it (see
         * the backdrop rendered by WorkspacePage).
         */
        position: "fixed",
        top: 0,
        left: 0,
        width: 300,
        height: "100vh",
        boxSizing: "border-box",
        bgcolor: PANEL_BG,
        color: "#fff",
        overflowY: "auto",
        overflowX: "hidden",
        borderRight: `1px solid ${PANEL_BORDER}`,
        boxShadow: "4px 0 18px rgba(0,0,0,0.35)",
        zIndex: 1200,
        /* Hide the scrollbar chrome; the panel still scrolls with the wheel. */
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        "&::-webkit-scrollbar": { display: "none" },
        "&::-webkit-scrollbar-thumb": { display: "none" },
        "&::-webkit-scrollbar-track": { display: "none" },
      }}
    >
      {/* ------------------------------ Header ------------------------------ */}
      <Box sx={{ pt: 3, pl: 2.5, pr: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Barcode Inspection
        </Typography>

        {/*
          The single primary inspection action. Nothing else in the Barcode
          flow starts the engine.
        */}
        <Button
          fullWidth
          variant="contained"
          onClick={handleInspect}
          disabled={isInspecting}
          sx={{
            mt: 2,
            fontWeight: 600,
            textTransform: "none",
            bgcolor: BRAND_NAVY,
            "&:hover": { bgcolor: BRAND_NAVY_LIGHT },
            "&.Mui-disabled": { bgcolor: "#3A3D45", color: "#8A8F98" },
          }}
        >
          Inspect
        </Button>

        {errors.length > 0 && (
          <Alert severity="error" sx={{ mt: 2, fontSize: 12 }}>
            {errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </Alert>
        )}
      </Box>

      {/* ---------------------------- Profiles ----------------------------- */}
      <Accordion defaultExpanded sx={accordionStyle}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}>
          <Typography sx={sectionTitleStyle}>Profiles</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <RadioGroup
            value={config.profile}
            onChange={(event) =>
              patchBarcodeConfig({ profile: event.target.value })
            }
          >
            {BARCODE_PROFILES.map((profile) => (
              <FormControlLabel
                key={profile.id}
                value={profile.id}
                control={<Radio size="small" sx={radioStyle} />}
                label={profile.label}
              />
            ))}
          </RadioGroup>
        </AccordionDetails>
      </Accordion>

      {/* --------------------------- Resolution ---------------------------- */}
      <Accordion defaultExpanded sx={accordionStyle}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}>
          <Typography sx={sectionTitleStyle}>Resolution</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Select
            value={String(config.resolution)}
            onChange={(event) =>
              patchBarcodeConfig({ resolution: Number(event.target.value) })
            }
            size="small"
            fullWidth
            sx={selectStyle}
          >
            {BARCODE_RESOLUTIONS.map((dpi) => (
              <MenuItem key={dpi} value={String(dpi)}>
                {dpi} dpi
              </MenuItem>
            ))}
          </Select>
        </AccordionDetails>
      </Accordion>

      {/* ----------------------------- Options ----------------------------- */}
      <Accordion defaultExpanded disableGutters sx={accordionStyle}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}>
          <Typography sx={sectionTitleStyle}>Options</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                sx={checkboxStyle}
                checked={config.enableOverprint}
                onChange={(event) =>
                  patchBarcodeConfig({
                    enableOverprint: event.target.checked,
                  })
                }
              />
            }
            label="Enable Overprint"
          />
        </AccordionDetails>
      </Accordion>

      {/* --------------------------- Select Page --------------------------- */}
      <Accordion defaultExpanded disableGutters sx={accordionStyle}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}>
          <Typography sx={sectionTitleStyle}>Select Page</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Select
            value={pageValue}
            onChange={(event) => {
              const value = event.target.value;
              patchBarcodeConfig({
                pages:
                  value === "all"
                    ? "all"
                    : value
                        .split(",")
                        .map((page) => Number(page.trim()))
                        .filter((page) => Number.isFinite(page)),
              });
            }}
            size="small"
            fullWidth
            sx={selectStyle}
          >
            <MenuItem value="all">All</MenuItem>
            {pageOptions.map((page) => (
              <MenuItem key={page} value={String(page)}>
                {page}
              </MenuItem>
            ))}
          </Select>
          {pageOptions.length === 0 && (
            <Typography variant="caption" sx={{ color: "#9AA0AA" }}>
              Waiting for the document to load…
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>

      {/* ----------------------------- Footer ------------------------------ */}
      <Box sx={{ py: 2, display: "flex", justifyContent: "center" }}>
        <Button
          variant="text"
          onClick={() => {
            resetBarcodeConfig();
            setErrors([]);
          }}
          sx={{
            textTransform: "none",
            fontWeight: 600,
            color: BRAND_NAVY_LIGHT,
            "&:hover": { bgcolor: "rgba(63,59,153,0.15)" },
          }}
        >
          Reset To Default
        </Button>
      </Box>

      <Button
        fullWidth
        onClick={onClose}
        sx={{
          textTransform: "none",
          color: "#9AA0AA",
          borderTop: `1px solid ${PANEL_BORDER}`,
          borderRadius: 0,
          py: 1.5,
        }}
      >
        Close
      </Button>
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Styles                                    */
/* -------------------------------------------------------------------------- */

const sectionTitleStyle = { fontWeight: 600, fontSize: 14 };

const radioStyle = {
  color: "#fff",
  "&.Mui-checked": { color: BRAND_NAVY_LIGHT },
};

const checkboxStyle = {
  color: "#fff",
  "&.Mui-checked": { color: BRAND_NAVY_LIGHT },
};

const accordionStyle = {
  bgcolor: PANEL_BG,
  color: "#fff",
  boxShadow: "none",
  borderRadius: 0,
  borderBottom: `1px solid ${PANEL_BORDER}`,
  "&::before": { display: "none" },
  "& .MuiAccordionSummary-root": { minHeight: 44, px: 2.5 },
  "& .MuiAccordionSummary-content": { margin: "8px 0" },
  "& .MuiAccordionDetails-root": { pt: 0, px: 2.5, pb: 1.5 },
  "& .MuiTypography-root": { color: "#fff" },
  "& .MuiFormControlLabel-label": { color: "#fff", fontSize: 13 },
};

const selectStyle = {
  mt: 0.5,
  bgcolor: "#FFFFFF",
  color: "#1B1B1B",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "#D0D0D0" },
  "& .MuiSelect-select": { py: 0.75, fontSize: 13 },
};
