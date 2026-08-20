import { useEffect, useMemo, useState } from "react";

import {
  Box,
  Checkbox,
  Divider,
  FormControl,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import {
  useUploadStore,
  subscribeToStateUpdates,
  type DifferenceListSyncMessage,
} from "@/store/uploadStore";
import type { InspectionDifference } from "./InspectionResults";

const COMMENT_OPTIONS = [
  "Reviewed",
  "Approved",
  "To be verified",
  "None",
  "Comment1",
  "Comment2",
  "Comment3",
];

export default function DifferenceListPage() {
  /* ------------------------------------------------------------------ */
  /* Read from shared Zustand store (persisted + BroadcastChannel synced) */
  /* ------------------------------------------------------------------ */

  const inspectionReport = useUploadStore((state) => state.inspectionReport);
  const masterFileName = useUploadStore((state) => state.masterFileName);
  const sampleFileName = useUploadStore((state) => state.sampleFileName);
  const sessionId = useUploadStore((state) => state.sessionId);
  const commentSelections = useUploadStore((state) => state.commentSelections);
  const levelSelections = useUploadStore((state) => state.levelSelections);
  const setCommentSelections = useUploadStore(
    (state) => state.setCommentSelections
  );
  const setLevelSelections = useUploadStore((state) => state.setLevelSelections);
  const customComments = useUploadStore((state) => state.customComments);

  const [selectedId, setSelectedId] = useState<number | null>(null);

  /* ------------------------------------------------------------------ */
  /* Build differences from the shared inspection report                */
  /* ------------------------------------------------------------------ */

  const differences = useMemo<InspectionDifference[]>(() => {
    if (!inspectionReport) {
      return [];
    }

    return inspectionReport.findings.map((finding) => ({
      id: finding.id,
      type: finding.type,
      master: finding.master,
      sample: finding.sample,
      level: levelSelections[finding.id] ?? null,
      comment: finding.comment,
      page: finding.page,
      masterBox: finding.master_box,
      sampleBox: finding.sample_box,
    }));
  }, [inspectionReport, levelSelections]);

  /* ------------------------------------------------------------------ */
  /* Listen for live BroadcastChannel updates from the main window      */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const unsubscribe = subscribeToStateUpdates(
      (message: DifferenceListSyncMessage) => {
        console.log("[DIFFERENCE LIST] Received synchronized update");

        // Apply the broadcast state to this window's store —
        // this makes live changes from the main Results page appear
        // instantly in the Difference List window without a reload.
        const state = useUploadStore.getState();
        state.setCommentSelections(message.commentSelections);
        state.setLevelSelections(message.levelSelections);
      }
    );

    return unsubscribe;
  }, []);

  /* ------------------------------------------------------------------ */
  /* Editable Level / Comment handlers — update shared store, which     */
  /* broadcasts to the main Results page as well.                       */
  /* ------------------------------------------------------------------ */

  const getLevelValue = (differenceId: number) =>
    levelSelections[differenceId] ?? "";

  const getCommentValue = (differenceId: number) =>
    commentSelections[differenceId] ?? "None";

  const handleLevelChange = (differenceId: number, value: string) => {
    console.log("[DIFFERENCE LIST] Updating difference");
    console.log("[DIFFERENCE LIST] Difference ID:", differenceId);
    console.log("[DIFFERENCE LIST] Updated Level:", value);

    setLevelSelections({
      ...levelSelections,
      [differenceId]: value,
    });
  };

  const handleCommentChange = (differenceId: number, value: string) => {
    console.log("[DIFFERENCE LIST] Updating difference");
    console.log("[DIFFERENCE LIST] Difference ID:", differenceId);
    console.log("[DIFFERENCE LIST] Updated Comment:", value);

    setCommentSelections({
      ...commentSelections,
      [differenceId]: value,
    });
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                            */
  /* ------------------------------------------------------------------ */

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#f5f5f5",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* =========================================================
          PAGE HEADER
         ========================================================= */}

      <Box
        sx={{
          bgcolor: "#2A276E",
          px: 3,
          py: 2.5,
          flexShrink: 0,
        }}
      >
        <Typography
          variant="h5"
          sx={{
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          Difference List
        </Typography>

        <Typography
          variant="body2"
          sx={{
            color: "#D0D0E8",
            mt: 0.5,
          }}
        >
          {sessionId ? `Inspection ID: ${sessionId}` : "No active inspection"}
        </Typography>
      </Box>

      {/* =========================================================
          INSPECTION INFO BAR
         ========================================================= */}

      <Box
        sx={{
          bgcolor: "#FFFFFF",
          px: 3,
          py: 1.5,
          borderBottom: "1px solid #d5d9dd",
          display: "flex",
          alignItems: "center",
          gap: 2.5,
          flexWrap: "wrap",
          flexShrink: 0,
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: "#50575e",
          }}
        >
          Master:{" "}
          <Box component="span" sx={{ fontWeight: 400 }}>
            {masterFileName ?? "—"}
          </Box>
        </Typography>

        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: "#50575e",
          }}
        >
          Sample:{" "}
          <Box component="span" sx={{ fontWeight: 400 }}>
            {sampleFileName ?? "—"}
          </Box>
        </Typography>

        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: "#50575e",
          }}
        >
          Total Differences:{" "}
          <Box component="span" sx={{ fontWeight: 400 }}>
            {differences.length}
          </Box>
        </Typography>
      </Box>

      {/* =========================================================
          DIFFERENCE TABLE
         ========================================================= */}

      <Box sx={{ p: 3, flex: 1 }}>
        <TableContainer
          component={Paper}
          elevation={0}
          sx={{
            border: "1px solid #d5d9dd",
            borderRadius: 1.5,
            maxHeight: "calc(100vh - 210px)",
            overflow: "auto",
          }}
        >
          <Table stickyHeader size="small" sx={{ minWidth: 1100 }}>
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
              {differences.map((difference) => {
                const isSelected = selectedId === difference.id;

                return (
                  <TableRow
                    key={difference.id}
                    hover
                    selected={isSelected}
                    onClick={() => {
                      setSelectedId(difference.id);
                      console.log(
                        "[DIFFERENCE LIST] Selected difference:",
                        difference.id
                      );
                    }}
                    sx={{
                      cursor: "pointer",
                      bgcolor: isSelected
                        ? "rgba(42, 39, 110, 0.06)"
                        : "transparent",
                      "&:hover": {
                        bgcolor: isSelected
                          ? "rgba(42, 39, 110, 0.08)"
                          : "#edf3ff",
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
                    </TableCell>
                  </TableRow>
                );
              })}

              {differences.length === 0 && (
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
                      No inspection data available. Run an inspection first.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  );
}