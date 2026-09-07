import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { Controller, useForm } from "react-hook-form";

import {
  createComment,
  createLevel,
  deleteComment,
  deleteLevel,
  getComments,
  getLevels,
  updateComment,
  updateLevel,
  type InspectionComment,
  type InspectionLevel,
} from "../systemApi";
import { BRAND_NAVY } from "../components/adminUtils";
import { ConfirmDialog, SnackBar, type Snack } from "../components/adminUi";

type LevelForm = { name: string; description: string; displayOrder: number };
type CommentForm = { comment: string; description: string };

export default function LevelsCommentsPage() {
  const [tab, setTab] = useState(0);
  const [levels, setLevels] = useState<InspectionLevel[]>([]);
  const [comments, setComments] = useState<InspectionComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snack, setSnack] = useState<Snack>(null);

  const [levelDialog, setLevelDialog] = useState<{ open: boolean; editing: InspectionLevel | null }>({
    open: false,
    editing: null,
  });
  const [commentDialog, setCommentDialog] = useState<{ open: boolean; editing: InspectionComment | null }>({
    open: false,
    editing: null,
  });
  const [pendingDelete, setPendingDelete] = useState<{
    kind: "level" | "comment";
    item: InspectionLevel | InspectionComment;
  } | null>(null);

  const levelForm = useForm<LevelForm>();
  const commentForm = useForm<CommentForm>();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [lv, cm] = await Promise.all([getLevels(), getComments()]);
      setLevels(lv);
      setComments(cm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const [lv, cm] = await Promise.all([getLevels(), getComments()]);
        if (!isMounted) return;
        setLevels(lv);
        setComments(cm);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to load settings.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, []);

  const openLevelDialog = (level: InspectionLevel | null) => {
    levelForm.reset(
      level
        ? { name: level.name, description: level.description, displayOrder: level.displayOrder }
        : { name: "", description: "", displayOrder: levels.length + 1 }
    );
    setLevelDialog({ open: true, editing: level });
  };

  const saveLevel = async (values: LevelForm) => {
    try {
      if (levelDialog.editing) {
        await updateLevel(levelDialog.editing.id, values);
        setSnack({ message: `Level "${values.name}" updated.`, severity: "success" });
      } else {
        await createLevel({ ...values, active: true });
        setSnack({ message: `Level "${values.name}" created.`, severity: "success" });
      }
      setLevelDialog({ open: false, editing: null });
      await load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to save level.", severity: "error" });
    }
  };

  const openCommentDialog = (comment: InspectionComment | null) => {
    commentForm.reset(
      comment ? { comment: comment.comment, description: comment.description } : { comment: "", description: "" }
    );
    setCommentDialog({ open: true, editing: comment });
  };

  const saveComment = async (values: CommentForm) => {
    try {
      if (commentDialog.editing) {
        await updateComment(commentDialog.editing.id, values);
        setSnack({ message: `Comment "${values.comment}" updated.`, severity: "success" });
      } else {
        await createComment({ ...values, active: true });
        setSnack({ message: `Comment "${values.comment}" created.`, severity: "success" });
      }
      setCommentDialog({ open: false, editing: null });
      await load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to save comment.", severity: "error" });
    }
  };

  const toggleLevel = async (level: InspectionLevel) => {
    try {
      await updateLevel(level.id, { active: !level.active });
      await load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to update level.", severity: "error" });
    }
  };

  const toggleComment = async (comment: InspectionComment) => {
    try {
      await updateComment(comment.id, { active: !comment.active });
      await load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to update comment.", severity: "error" });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;

    try {
      if (pendingDelete.kind === "level") {
        const levelItem = pendingDelete.item as InspectionLevel;
        await deleteLevel(levelItem.id);
        setSnack({ message: `Level "${levelItem.name}" deleted.`, severity: "success" });
      } else {
        const commentItem = pendingDelete.item as InspectionComment;
        await deleteComment(commentItem.id);
        setSnack({
          message: `Comment "${commentItem.comment}" deleted.`,
          severity: "success",
        });
      }
      setPendingDelete(null);
      await load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to delete.", severity: "error" });
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h4" sx={{ fontWeight: 700, color: BRAND_NAVY, mb: 2 }}>
        Setup Levels and Comments
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Severity levels and comments are available to reviewers when inspecting differences and appear in the generated PDF report.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          mb: 2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Tabs value={tab} onChange={(_, value: number) => setTab(value)}>
          <Tab label="Levels" />
          <Tab label="Comments" />
        </Tabs>
        <Button
          variant="contained"
          startIcon={<AddOutlinedIcon />}
          onClick={() => (tab === 0 ? openLevelDialog(null) : openCommentDialog(null))}
          sx={{ bgcolor: BRAND_NAVY, "&:hover": { bgcolor: "#1E1B54" }, mb: 0.5 }}
        >
          {tab === 0 ? "Add Level" : "Add Comment"}
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : tab === 0 ? (
        <TableContainer sx={{ border: "1px solid #E0E0E6", borderRadius: 2, bgcolor: "#fff" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: "#F5F6FA" }}>
                {["Display Order", "Name", "Description", "Active", "Actions"].map((header) => (
                  <TableCell key={header} sx={{ fontWeight: 700, color: BRAND_NAVY }}>
                    {header}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {levels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 5 }}>
                    <Typography color="text.secondary">No levels defined yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                levels.map((level) => (
                  <TableRow key={level.id} hover>
                    <TableCell>{level.displayOrder}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{level.name}</TableCell>
                    <TableCell>{level.description}</TableCell>
                    <TableCell>
                      <Switch checked={level.active} onChange={() => toggleLevel(level)} size="small" />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openLevelDialog(level)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setPendingDelete({ kind: "level", item: level })}
                        >
                          <DeleteOutlineOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <TableContainer sx={{ border: "1px solid #E0E0E6", borderRadius: 2, bgcolor: "#fff" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: "#F5F6FA" }}>
                {["Comment", "Description", "Active", "Actions"].map((header) => (
                  <TableCell key={header} sx={{ fontWeight: 700, color: BRAND_NAVY }}>
                    {header}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {comments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 5 }}>
                    <Typography color="text.secondary">No comments defined yet.</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                comments.map((comment) => (
                  <TableRow key={comment.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{comment.comment}</TableCell>
                    <TableCell>{comment.description}</TableCell>
                    <TableCell>
                      <Switch checked={comment.active} onChange={() => toggleComment(comment)} size="small" />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openCommentDialog(comment)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setPendingDelete({ kind: "comment", item: comment })}
                        >
                          <DeleteOutlineOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog
        open={levelDialog.open}
        onClose={() => setLevelDialog({ open: false, editing: null })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: BRAND_NAVY }}>
          {levelDialog.editing ? "Edit Level" : "Add Level"}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gap: 2, pt: 0.5 }}>
            <Controller
              name="name"
              control={levelForm.control}
              rules={{ required: "Name is required." }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Name *"
                  size="small"
                  error={Boolean(levelForm.formState.errors.name)}
                  helperText={levelForm.formState.errors.name?.message ?? " "}
                />
              )}
            />
            <Controller
              name="description"
              control={levelForm.control}
              render={({ field }) => (
                <TextField {...field} label="Description" size="small" multiline minRows={2} />
              )}
            />
            <Controller
              name="displayOrder"
              control={levelForm.control}
              rules={{
                required: "Display order is required.",
                min: { value: 1, message: "Must be at least 1." },
              }}
              render={({ field }) => (
                <TextField
                  {...field}
                  type="number"
                  label="Display Order *"
                  size="small"
                  error={Boolean(levelForm.formState.errors.displayOrder)}
                  helperText={levelForm.formState.errors.displayOrder?.message ?? " "}
                />
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setLevelDialog({ open: false, editing: null })} color="inherit">
            Cancel
          </Button>
          <Button onClick={levelForm.handleSubmit(saveLevel)} variant="contained" sx={{ bgcolor: BRAND_NAVY }}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={commentDialog.open}
        onClose={() => setCommentDialog({ open: false, editing: null })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: BRAND_NAVY }}>
          {commentDialog.editing ? "Edit Comment" : "Add Comment"}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gap: 2, pt: 0.5 }}>
            <Controller
              name="comment"
              control={commentForm.control}
              rules={{ required: "Comment is required." }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Comment *"
                  size="small"
                  error={Boolean(commentForm.formState.errors.comment)}
                  helperText={commentForm.formState.errors.comment?.message ?? " "}
                />
              )}
            />
            <Controller
              name="description"
              control={commentForm.control}
              render={({ field }) => (
                <TextField {...field} label="Description" size="small" multiline minRows={2} />
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setCommentDialog({ open: false, editing: null })} color="inherit">
            Cancel
          </Button>
          <Button onClick={commentForm.handleSubmit(saveComment)} variant="contained" sx={{ bgcolor: BRAND_NAVY }}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Please Confirm"
        message={
          pendingDelete
            ? pendingDelete.kind === "level"
              ? `Delete "${(pendingDelete.item as InspectionLevel).name}"? This action cannot be undone.`
              : `Delete "${(pendingDelete.item as InspectionComment).comment}"? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        confirmColor="error"
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      <SnackBar snack={snack} onClose={() => setSnack(null)} />
    </Box>
  );
}

