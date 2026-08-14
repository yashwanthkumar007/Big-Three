import { useState } from "react";

import {
  Box,
  Checkbox,
  Divider,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
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
import ShareIcon from "@mui/icons-material/Share";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import DownloadIcon from "@mui/icons-material/Download";
import CompareIcon from "@mui/icons-material/Compare";

import ViewerPane from "./ViewerPane";
import type { BoundingBox } from "@/shared/api/textInspectionApi";
import { truncateFileName } from "@/shared/utils/truncateFileName";

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

export type PageDimensions = {
  page: number;
  masterWidth?: number;
  masterHeight?: number;
  sampleWidth?: number;
  sampleHeight?: number;
};

export type InspectionResult = {
  inspectionId: string;
  inspectionType:
    | "text"
    | "graphics"
    | "spelling"
    | "braille"
    | "barcode"
    | "notes";
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
                        value={difference.level ?? ""}
                        displayEmpty
                        sx={{
                          height: 30,
                          fontSize: 13,
                        }}
                      >
                        <MenuItem value="">None</MenuItem>
                        <MenuItem value="Low">Low</MenuItem>
                        <MenuItem value="Medium">Medium</MenuItem>
                        <MenuItem value="High">High</MenuItem>
                      </Select>
                    </FormControl>
                  </TableCell>

                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      value={difference.comment ?? ""}
                      placeholder="Comment..."
                      slotProps={{
                        htmlInput: {
                          readOnly: true,
                        },
                      }}
                      sx={{
                        "& .MuiInputBase-root": {
                          height: 30,
                          fontSize: 13,
                        },
                      }}
                    />
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
    </Box>
  );
}