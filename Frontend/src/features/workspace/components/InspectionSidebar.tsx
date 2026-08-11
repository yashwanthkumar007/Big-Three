import { useState } from "react";

import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Typography,
} from "@mui/material";

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

type InspectionSidebarProps = {
  inspectionType: string;
  onClose: () => void;
  onInspect: () => void;
};

const inspectionLabels: Record<string, string> = {
  text: "Text Inspection",
  graphics: "Graphics Inspection",
  spelling: "Spelling Inspection",
  braille: "Braille Inspection",
  barcode: "Barcode Inspection",
  notes: "Notes Inspection",
};

export default function InspectionSidebar({
  inspectionType,
  onClose,
  onInspect,
}: InspectionSidebarProps) {
  const [differenceFilters, setDifferenceFilters] = useState({
    case: true,
    change: true,
    deletion: true,
    hyphen: true,
    insertion: true,
    location: true,

    bold: false,
    color: false,
    fontType: false,
    space: true,
    size: true,
    underline: false,
  });

  const handleCheckbox =
    (name: keyof typeof differenceFilters) =>
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
          {inspectionLabels[inspectionType] ?? `${inspectionType.charAt(0).toUpperCase()}${inspectionType.slice(1)} Inspection`}
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