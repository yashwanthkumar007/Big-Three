import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import { useUploadStore } from "@/store/uploadStore";
import type { DifferenceFilters } from "@/store/uploadStore";
import { getInspectionLabel } from "@/shared/config/inspectionConfig";
import {
  BRAILLE_LANGUAGES,
  BRAILLE_RESOLUTIONS,
  type BrailleInspectionOptions,
} from "@/shared/config/brailleInspectionConfig";

type InspectionSidebarProps = {
  inspectionType: string;
  onClose: () => void;
  onInspect: (options?: BrailleInspectionOptions) => void;
  isInspecting?: boolean;
};


export default function InspectionSidebar({
  inspectionType,
  onClose,
  onInspect,
  isInspecting = false,
}: InspectionSidebarProps) {
  const differenceFilters = useUploadStore(
    (state) => state.differenceFilters
  );
  const setDifferenceFilters = useUploadStore(
    (state) => state.setDifferenceFilters
  );

  if (inspectionType === "braille") {
    return (
      <BrailleInspectionSidebar
        onInspect={onInspect}
        isInspecting={isInspecting}
      />
    );
  }

  const handleCheckbox =
    (name: keyof DifferenceFilters) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setDifferenceFilters({
        ...differenceFilters,
        [name]: event.target.checked,
      });
    };

  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        width: 330,
        height: "100vh",
        boxSizing: "border-box",
        bgcolor: "#16181D",
        color: "#fff",
        overflowY: "auto",
        overflowX: "hidden",
        borderRight: "1px solid #2B2E35",
        zIndex: 1200,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          pt: 4,
          pl: 3,
          pr: 3,
        }}
      >
        <Typography
          variant="h5"
          sx={{ fontWeight: 700 }}
        >
        {getInspectionLabel(inspectionType)}
        </Typography>

        <Button
          fullWidth
          variant="contained"
          onClick={() => {
            onInspect();
            onClose();
          }}
          sx={{
            mt: 3,
            bgcolor: "#2A276E",
            "&:hover": {
              bgcolor: "#1F1A58",
            },
          }}
        >
          Inspect
        </Button>
      </Box>
      <Divider />

      {/* Profiles */}

      <Accordion
        defaultExpanded
        sx={accordionStyle}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}>
          <Typography sx={{ fontWeight: 600 }}>Profiles</Typography>
        </AccordionSummary>

        <AccordionDetails>
          <RadioGroup defaultValue="default">
            <FormControlLabel
              value="default"
              control={<Radio />}
              label="Default"
            />
          </RadioGroup>
        </AccordionDetails>
      </Accordion>

      {/* Difference Filter */}

      <Accordion
        defaultExpanded
        sx={accordionStyle}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}>
          <Typography 
          sx={{ fontWeight: 600 }}
          >
            Difference Filter
          </Typography>
        </AccordionSummary>

        <AccordionDetails>
          <Stack spacing={0}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.case}
                  onChange={handleCheckbox("case")}
                />
              }
              label="Case"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.change}
                  onChange={handleCheckbox("change")}
                />
              }
              label="Change"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.deletion}
                  onChange={handleCheckbox("deletion")}
                />
              }
              label="Deletion"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.hyphen}
                  onChange={handleCheckbox("hyphen")}
                />
              }
              label="Hyphen"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.insertion}
                  onChange={handleCheckbox("insertion")}
                />
              }
              label="Insertion"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.location}
                  onChange={handleCheckbox("location")}
                />
              }
              label="Location"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.bold}
                  onChange={handleCheckbox("bold")}
                />
              }
              label="Bold"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.italic}
                  onChange={handleCheckbox("italic")}
                />
              }
              label="Italic"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.color}
                  onChange={handleCheckbox("color")}
                />
              }
              label="Color"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.fontType}
                  onChange={handleCheckbox("fontType")}
                />
              }
              label="Font Type"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.mixedFont}
                  onChange={handleCheckbox("mixedFont")}
                />
              }
              label="Mixed Font"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.space}
                  onChange={handleCheckbox("space")}
                />
              }
              label="Space"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.size}
                  onChange={handleCheckbox("size")}
                />
              }
              label="Size"
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={differenceFilters.underline}
                  onChange={handleCheckbox("underline")}
                />
              }
              label="Underline"
            />
          </Stack>
        </AccordionDetails>
      </Accordion>
            {/* Template Mode */}

      <Accordion defaultExpanded sx={accordionStyle}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}
        >
          <Typography 
          sx={{fontWeight:600}}
          >
            Template Mode
            </Typography>
        </AccordionSummary>

        <AccordionDetails>
          <Stack spacing={1}>
            <FormControlLabel
              control={<Checkbox defaultChecked />}
              label="Bold Font Detection"
            />

            <FormControlLabel
              control={<Checkbox />}
              label="Highlight Detection"
            />

            <Select
              defaultValue="none"
              size="small"
              fullWidth
              sx={selectStyle}
            >
              <MenuItem value="none">None</MenuItem>
              <MenuItem value="template1">Template 1</MenuItem>
              <MenuItem value="template2">Template 2</MenuItem>
            </Select>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Languages */}

      <Accordion defaultExpanded sx={accordionStyle}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}
        >
          <Typography 
          sx={{fontWeight:600}}
          >
            Languages
            </Typography>
        </AccordionSummary>

        <AccordionDetails>
          <RadioGroup defaultValue="default">
            <FormControlLabel
              value="default"
              control={<Radio />}
              label="Default"
            />

            <FormControlLabel
              value="asian"
              control={<Radio />}
              label="Asian"
            />

            <FormControlLabel
              value="rtl"
              control={<Radio />}
              label="Right-to-Left"
            />

            <FormControlLabel
              value="enhanced"
              control={<Radio />}
              label="Enhanced Right-to-Left"
            />
          </RadioGroup>
        </AccordionDetails>
      </Accordion>

      {/* Images */}

      <Accordion defaultExpanded sx={accordionStyle}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}
        >
          <Typography 
          sx={{fontWeight:600}}
          >
            Images
            </Typography>
        </AccordionSummary>

        <AccordionDetails>
          <RadioGroup defaultValue="enabled">
            <FormControlLabel
              value="enabled"
              control={<Radio />}
              label="Enabled Compare"
            />

            <FormControlLabel
              value="disabled"
              control={<Radio />}
              label="Disabled Compare"
            />
          </RadioGroup>
        </AccordionDetails>
      </Accordion>

      {/* Barcodes */}

      <Accordion defaultExpanded sx={accordionStyle}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}
        >
          <Typography 
          sx={{fontWeight:600}}
          >
            Barcodes
            </Typography>
        </AccordionSummary>

        <AccordionDetails>
          <Select
            defaultValue="none"
            size="small"
            fullWidth
            sx={selectStyle}
          >
            <MenuItem value="none">None</MenuItem>
            <MenuItem value="all">All Barcodes</MenuItem>
            <MenuItem value="1d">1D Only</MenuItem>
            <MenuItem value="2d">2D Only</MenuItem>
          </Select>
        </AccordionDetails>
      </Accordion>

      {/* Braille */}

      <Accordion defaultExpanded sx={accordionStyle}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}
        >
          <Typography 
          sx={{fontWeight:600}}
          >
            Braille
            </Typography>
        </AccordionSummary>

        <AccordionDetails>
          <Select
            defaultValue="none"
            size="small"
            fullWidth
            sx={selectStyle}
          >
            <MenuItem value="none">None</MenuItem>
            <MenuItem value="grade1">Grade 1</MenuItem>
            <MenuItem value="grade2">Grade 2</MenuItem>
          </Select>
        </AccordionDetails>
      </Accordion>
            {/* Options */}

      <Accordion defaultExpanded sx={accordionStyle}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}
        >
          <Typography 
          sx={{fontWeight:600}}
          >
            Options
            </Typography>
        </AccordionSummary>

        <AccordionDetails>
          <Stack spacing={1}>
            <FormControlLabel
              control={<Checkbox defaultChecked />}
              label="Enable Overprint"
            />

            <FormControlLabel
              control={<Checkbox />}
              label="Invisible Text"
            />

            <FormControlLabel
              control={<Checkbox defaultChecked />}
              label="Detect Hidden Layers"
            />

            <FormControlLabel
              control={<Checkbox />}
              label="Ignore White Space"
            />
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Line Processing */}

      <Accordion defaultExpanded sx={accordionStyle}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}
        >
          <Typography 
          sx={{fontWeight:600}}
          >
            Line Processing
            </Typography>
        </AccordionSummary>

        <AccordionDetails>
          <RadioGroup defaultValue="off">
            <FormControlLabel
              value="off"
              control={<Radio />}
              label="Off"
            />

            <FormControlLabel
              value="underline"
              control={<Radio />}
              label="Underlines"
            />

            <FormControlLabel
              value="tables"
              control={<Radio />}
              label="Underlines + Tables"
            />
          </RadioGroup>
        </AccordionDetails>
      </Accordion>

      {/* Footer */}

      <Box
        sx={{
          py: 3,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Button
          variant="text"
          color="error"
          sx={{
            textTransform: "none",
            fontWeight: 600,
          }}
        >
          Reset To Default
        </Button>
      </Box>
    </Box>
  );
}

function BrailleInspectionSidebar({
  onInspect,
  isInspecting,
}: Pick<InspectionSidebarProps, "onInspect" | "isInspecting">) {
  const brailleConfig = useUploadStore((state) => state.brailleConfig);
  const setBrailleConfig = useUploadStore((state) => state.setBrailleConfig);
  const resetBrailleConfig = useUploadStore((state) => state.resetBrailleConfig);

  const handleLanguageChange = (value: string) => {
    const selected = BRAILLE_LANGUAGES.find((option) => option === value);
    if (selected) {
      setBrailleConfig({ ...brailleConfig, language: selected });
    }
  };

  const handleResolutionChange = (value: string) => {
    const selected = BRAILLE_RESOLUTIONS.find((option) => option === value);
    if (selected) {
      setBrailleConfig({ ...brailleConfig, resolution: selected });
    }
  };

  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        width: 330,
        height: "100vh",
        boxSizing: "border-box",
        bgcolor: "#16181D",
        color: "#fff",
        overflowY: "auto",
        overflowX: "hidden",
        borderRight: "1px solid #2B2E35",
        zIndex: 1200,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ pt: 4, pl: 3, pr: 3, pb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Braille Inspection
        </Typography>
        <Button
          fullWidth
          variant="contained"
          disabled={isInspecting}
          onClick={() => onInspect(brailleConfig)}
          sx={{
            mt: 3,
            minHeight: 40,
            bgcolor: "#2A276E",
            "&:hover": { bgcolor: "#211F58" },
            "&.Mui-disabled": { bgcolor: "#77758D", color: "#fff" },
          }}
        >
          {isInspecting ? (
            <CircularProgress size={20} sx={{ color: "#fff" }} />
          ) : (
            "Inspect"
          )}
        </Button>
      </Box>
      <Divider sx={{ borderColor: "#2B2E35" }} />

      <Accordion sx={accordionStyle}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}>
          <Typography sx={{ fontWeight: 600 }}>Language</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Autocomplete
            fullWidth
            size="small"
            options={[...BRAILLE_LANGUAGES]}
            value={brailleConfig.language}
            disableClearable
            onChange={(_, value) => handleLanguageChange(value)}
            renderInput={(params) => (
              <TextField
                {...params}
                slotProps={{
                  ...params.slotProps,
                  htmlInput: {
                    ...params.slotProps.htmlInput,
                    "aria-label": "Braille inspection language",
                  },
                }}
              />
            )}
            sx={brailleAutocompleteStyle}
          />
        </AccordionDetails>
      </Accordion>

      <Accordion sx={accordionStyle}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}>
          <Typography sx={{ fontWeight: 600 }}>Resolution</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Select
            fullWidth
            size="small"
            value={brailleConfig.resolution}
            onChange={(event) => handleResolutionChange(event.target.value)}
            inputProps={{ "aria-label": "Braille inspection resolution" }}
            sx={brailleSelectStyle}
          >
            {BRAILLE_RESOLUTIONS.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </AccordionDetails>
      </Accordion>

      <Accordion sx={accordionStyle}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#fff" }} />}>
          <Typography sx={{ fontWeight: 600 }}>Options</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <FormControlLabel
            control={
              <Checkbox
                checked={brailleConfig.enableOverprint}
                onChange={(event) =>
                  setBrailleConfig({
                    ...brailleConfig,
                    enableOverprint: event.target.checked,
                  })
                }
                sx={{
                  color: "#fff",
                  "&.Mui-checked": { color: "#fff" },
                  "&.Mui-focusVisible": {
                    outline: "2px solid #2A276E",
                    outlineOffset: 2,
                  },
                }}
              />
            }
            label="Enable Overprint"
          />
        </AccordionDetails>
      </Accordion>

      <Box
        sx={{
          py: 2,
          pb: 3,
          mt: "auto",
          display: "flex",
          justifyContent: "center",
          bgcolor: "#16181D",
        }}
      >
        <Button
          variant="text"
          onClick={resetBrailleConfig}
          sx={{
            textTransform: "none",
            fontWeight: 600,
            color: "#2A276E",
            "&:hover": { bgcolor: "#F2F2FA" },
          }}
        >
          Reset To Default
        </Button>
      </Box>

    </Box>
  );
}

const brailleSelectStyle = {
  bgcolor: "#fff",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "#D0D0D0" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#2A276E" },
  "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: "#2A276E",
    borderWidth: 2,
  },
  "& .MuiSelect-select": { py: 1.2 },
};

const brailleAutocompleteStyle = {
  bgcolor: "#fff",
  borderRadius: 1,
  "& .MuiOutlinedInput-root": {
    py: 0.1,
    "& fieldset": { borderColor: "#D0D0D0" },
    "&:hover fieldset": { borderColor: "#2A276E" },
    "&.Mui-focused fieldset": { borderColor: "#2A276E", borderWidth: 2 },
  },
};

const accordionStyle = {
  bgcolor: "#16181D",
  color: "#fff",
  boxShadow: "none",
  borderBottom: "1px solid #2B2E35",

  "&::before": {
    display: "none",
  },

  "& .MuiAccordionSummary-root": {
    minHeight: 52,
  },

  "& .MuiAccordionSummary-content": {
    margin: "12px 0",
  },

  "& .MuiAccordionDetails-root": {
    pt: 0,
  },

  "& .MuiTypography-root": {
    color: "#fff",
  },

  "& .MuiFormControlLabel-label": {
    color: "#fff",
    fontSize: 14,
  },

  "& .MuiCheckbox-root": {
    color: "#fff",
  },

  "& .MuiRadio-root": {
    color: "#fff",
  },
};

const selectStyle = {
  mt: 1,

  bgcolor: "#FFFFFF",

  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: "#D0D0D0",
  },

  "& .MuiSelect-select": {
    py: 1.2,
  },
};
