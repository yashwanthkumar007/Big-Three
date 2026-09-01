import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
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
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import { Controller, useForm } from "react-hook-form";

import {
  createDictionaryEntry,
  deleteDictionaryEntry,
  getDictionary,
  updateDictionaryEntry,
  type DictionaryEntry,
} from "../systemApi";
import { BRAND_NAVY } from "../components/adminUtils";
import { ConfirmDialog, SnackBar, type Snack } from "../components/adminUi";

type FormValues = {
  word: string;
  language: string;
  description: string;
  status: "Active" | "Inactive";
};

export default function UserDictionaryPage() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; editing: DictionaryEntry | null }>({
    open: false,
    editing: null,
  });
  const [pendingDelete, setPendingDelete] = useState<DictionaryEntry | null>(null);
  const [snack, setSnack] = useState<Snack>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>();

  const load = () => {
    getDictionary()
      .then(setEntries)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openDialog = (entry: DictionaryEntry | null) => {
    reset(
      entry
        ? { word: entry.word, language: entry.language, description: entry.description ?? "", status: entry.status }
        : { word: "", language: "English", description: "", status: "Active" }
    );
    setDialog({ open: true, editing: entry });
  };

  const save = async (values: FormValues) => {
    try {
      if (dialog.editing) {
        await updateDictionaryEntry(dialog.editing.id, values);
        setSnack({ message: `Word "${values.word}" updated.`, severity: "success" });
      } else {
        await createDictionaryEntry(values);
        setSnack({ message: `Word "${values.word}" added to dictionary.`, severity: "success" });
      }
      setDialog({ open: false, editing: null });
      load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to save entry.", severity: "error" });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteDictionaryEntry(pendingDelete.id);
      setSnack({ message: `Word "${pendingDelete.word}" deleted.`, severity: "success" });
      setPendingDelete(null);
      load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to delete entry.", severity: "error" });
    }
  };

  const exportCsv = () => {
    const header = "Word,Language,Description,Status";
    const rows = entries.map((entry) => `${entry.word},${entry.language},${entry.description ?? ""},${entry.status}`);
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "medinspect-user-dictionary.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: BRAND_NAVY }}>
          Setup User Dictionary
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button startIcon={<FileDownloadOutlinedIcon />} onClick={exportCsv} variant="outlined">
            Export
          </Button>
          <Button
            variant="contained"
            startIcon={<AddOutlinedIcon />}
            onClick={() => openDialog(null)}
            sx={{ bgcolor: BRAND_NAVY, "&:hover": { bgcolor: "#1E1B54" } }}
          >
            Add Word
          </Button>
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Custom dictionary words are ignored by text inspection spelling validation.
      </Typography>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      <TableContainer sx={{ border: "1px solid #E0E0E6", borderRadius: 2, bgcolor: "#fff" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F5F6FA" }}>
              {["Word", "Language", "Description", "Status", "Actions"].map((header) => (
                <TableCell key={header} sx={{ fontWeight: 700, color: BRAND_NAVY }}>
                  {header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 5 }}>
                  Loading...
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 5 }}>
                  <Typography color="text.secondary">
                    The dictionary is empty. Add custom words used in your artwork.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{entry.word}</TableCell>
                  <TableCell>{entry.language}</TableCell>
                  <TableCell>{entry.description ?? "-"}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={entry.status}
                      color={entry.status === "Active" ? "success" : "default"}
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openDialog(entry)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => setPendingDelete(entry)}>
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

      <Dialog open={dialog.open} onClose={() => setDialog({ open: false, editing: null })} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: BRAND_NAVY }}>
          {dialog.editing ? "Edit Dictionary Entry" : "Add Dictionary Entry"}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gap: 2, pt: 0.5 }}>
            <Controller
              name="word"
              control={control}
              rules={{ required: "Word is required." }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Word *"
                  size="small"
                  error={Boolean(errors.word)}
                  helperText={errors.word?.message ?? " "}
                />
              )}
            />
            <Controller
              name="language"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Language" size="small" />
              )}
            />
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Description" size="small" multiline minRows={2} />
              )}
            />
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <TextField {...field} select label="Status" size="small">
                  <MenuItem value="Active">Active</MenuItem>
                  <MenuItem value="Inactive">Inactive</MenuItem>
                </TextField>
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialog({ open: false, editing: null })} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleSubmit(save)} variant="contained" sx={{ bgcolor: BRAND_NAVY }}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Please Confirm"
        message={pendingDelete ? `Delete the word "${pendingDelete.word}"?` : ""}
        confirmLabel="Delete"
        confirmColor="error"
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      <SnackBar snack={snack} onClose={() => setSnack(null)} />
    </Box>
  );
}
