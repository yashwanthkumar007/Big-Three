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
  TextField,
  Typography,
} from "@mui/material";

import {
  useUploadStore,
  subscribeToStateUpdates,
  type DifferenceListSyncMessage,
} from "@/store/uploadStore";
import type { InspectionDifference } from "./InspectionResults";
import { useSetupConfig } from "@/shared/hooks/useSetupConfig";
import {
  configuredLevelOptions,
  configuredCommentOptions,
  isEditableCommentPlaceholder,
} from "@/shared/utils/setupLevels";
import {
  logAuditEvent,
  updateInspectionDifferenceComment,
} from "@/features/admin/systemApi";

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

  // Toggle: clicking the already-selected difference deselects it.
  const toggleSelect = (differenceId: number) => {
    setSelectedId((prev) => (prev === differenceId ? null : differenceId));
  };

  /* ------------------------------------------------------------------ */
  /* Admin-configured levels and comments (Setup Levels & Comments)      */
  /* ------------------------------------------------------------------ */

  const { data: setupConfig } = useSetupConfig();

  const configuredLevels = useMemo(() => {
    const options = configuredLevelOptions(setupConfig ?? null).filter(
      (value) => value && value.trim() !== ""
    );
    return [...new Set(options)];
  }, [setupConfig]);

  const configuredComments = useMemo(() => {
    const options = configuredCommentOptions(setupConfig ?? null);
    const defaultComment = setupConfig?.comments.default1?.trim();
    const all = defaultComment ? [defaultComment, ...options] : options;
    return [...new Set(all)];
  }, [setupConfig]);

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

    // Audit: record level assignment on a difference (best-effort).
    void logAuditEvent({
      event: "DIFFERENCE_LEVEL_CHANGED",
      action: "Update Level",
      module: "Text Inspection",
      description: `Level updated for difference ${differenceId} to "${value}".`,
      inspectionId: sessionId ?? undefined,
      differenceId,
      metadata: { level: value },
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

    // Audit: record comment/status selection on a difference (best-effort).
    void logAuditEvent({
      event: "DIFFERENCE_COMMENT_UPDATED",
      action: "Update Difference Comment",
      module: "Text Inspection",
      description: `Comment updated for difference ${differenceId} to "${value}".`,
      inspectionId: sessionId ?? undefined,
      differenceId,
      metadata: { comment: value },
    });
  };

  /**
   * Double-click on a "Comment1" / "Comment 2" … placeholder lets the user
   * type their own comment. The typed text replaces the placeholder in the
   * shared store (so it shows in the main Results page and the PDF report)
   * and is persisted in Cosmos DB so it survives across sessions.
   */
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [editingPlaceholder, setEditingPlaceholder] = useState("");

  const handleStartEdit = (difference: InspectionDifference) => {
    const currentValue = getCommentValue(difference.id);
    if (isEditableCommentPlaceholder(currentValue)) {
      setEditingCommentId(difference.id);
      setEditingCommentText("");
      setEditingPlaceholder(currentValue);
    }
  };

  const handleSaveEdit = (differenceId: number) => {
    const trimmed = editingCommentText.trim();
    if (trimmed) {
      setCommentSelections({
        ...commentSelections,
        [differenceId]: trimmed,
      });

      if (sessionId) {
        void updateInspectionDifferenceComment(
          sessionId,
          differenceId,
          {
            configuredComment: editingPlaceholder,
            userComment: trimmed,
          }
        ).catch((error) => {
          console.warn(
            "[DIFFERENCE LIST] Failed to persist user comment:",
            error
          );
        });
      }
    }
    setEditingCommentId(null);
    setEditingCommentText("");
    setEditingPlaceholder("");
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
                    // NOTE: navigation is intentionally NOT on the row. Only
                    // the ID / Master / Sample cells jump to the difference in
                    // the PDF viewers — clicking inside the Level or Comment
                    // cells (to pick a level/comment) must never redirect the
                    // viewers (user-experience bug fix).
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
                      onClick={() => toggleSelect(difference.id)}
                      sx={{
                        fontSize: 14,
                        color: "#535a62",
                        cursor: "pointer",
                      }}
                    >
                      {difference.id}
                    </TableCell>

                    <TableCell
                      onClick={() => toggleSelect(difference.id)}
                      sx={{
                        fontSize: 14,
                        color: "#535a62",
                        cursor: "pointer",
                      }}
                    >
                      {difference.type}
                    </TableCell>

                    <TableCell
                      onClick={() => toggleSelect(difference.id)}
                      sx={{
                        fontSize: 14,
                        color: "#535a62",
                        maxWidth: 300,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                      }}
                      title={difference.master}
                    >
                      {difference.master}
                    </TableCell>

                    <TableCell
                      onClick={() => toggleSelect(difference.id)}
                      sx={{
                        fontSize: 14,
                        color: "#535a62",
                        maxWidth: 300,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
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
                          {configuredLevels
                            .filter((option) => option !== "None")
                            .map((option) => (
                              <MenuItem key={option} value={option}>
                                {option}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                    </TableCell>

                    <TableCell>
                      {editingCommentId === difference.id ? (
                        <TextField
                          size="small"
                          fullWidth
                          autoFocus
                          value={editingCommentText}
                          onChange={(event) =>
                            setEditingCommentText(event.target.value)
                          }
                          onBlur={() => handleSaveEdit(difference.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              handleSaveEdit(difference.id);
                            } else if (event.key === "Escape") {
                              setEditingCommentId(null);
                              setEditingCommentText("");
                            }
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          sx={{
                            "& .MuiInputBase-root": {
                              height: 30,
                              fontSize: 13,
                            },
                          }}
                        />
                      ) : (
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
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            handleStartEdit(difference);
                          }}
                          onChange={(event) => {
                            handleCommentChange(
                              difference.id,
                              event.target.value as string
                            );
                          }}
                        >
                          {configuredComments.map((option) => (
                            <MenuItem key={option} value={option}>
                              {option}
                            </MenuItem>
                          ))}

                          {/* Persisted user comment (e.g. typed via
                              double-click) that is not one of the configured
                              options — render it so the Select value is
                              always valid. */}
                          {(() => {
                            const current = getCommentValue(difference.id);
                            if (
                              current === "" ||
                              current === "None" ||
                              configuredComments.includes(current)
                            ) {
                              return null;
                            }
                            return (
                              <MenuItem key={current} value={current}>
                                {current}
                              </MenuItem>
                            );
                          })()}

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
                      )}
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