import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Snackbar,
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
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { Controller, useForm } from "react-hook-form";

import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  getProfiles,
  updateProfile,
  type InspectionProfile,
  type ProfileType,
} from "../systemApi";

const BRAND_NAVY = "#2A276E";

type FormValues = { name: string; description: string; status: "Active" | "Inactive" };

const LABELS: Record<ProfileType, string> = {
  text: "Custom Text Profiles",
  graphics: "Custom Graphics Profiles",
  barcode: "Custom Barcode Profiles",
};

const fmt = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "-";

export default function ProfilesPage({ type }: { type: ProfileType }) {
  const [profiles, setProfiles] = useState<InspectionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewProfile, setViewProfile] = useState<InspectionProfile | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; editing: InspectionProfile | null }>({ open: false, editing: null });
  const [pendingDelete, setPendingDelete] = useState<InspectionProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<{ message: string; severity: "success" | "error" } | null>(null);
  const { control, handleSubmit, reset, formState: { errors } } = useForm<FormValues>();

  const load = useCallback(() => {
    getProfiles(type)
      .then(setProfiles)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [type]);

  useEffect(() => {
    load();
  }, [load]);

  const openDialog = (profile: InspectionProfile | null) => {
    reset(
      profile
        ? { name: profile.name, description: profile.description, status: profile.status }
        : { name: "", description: "", status: "Active" }
    );
    setDialog({ open: true, editing: profile });
  };

  const save = async (values: FormValues) => {
    setBusy(true);
    try {
      if (dialog.editing) {
        await updateProfile(type, dialog.editing.id, values);
        setSnack({ message: `Profile "${values.name}" updated.`, severity: "success" });
      } else {
        await createProfile(type, values);
        setSnack({ message: `Profile "${values.name}" created.`, severity: "success" });
      }
      setDialog({ open: false, editing: null });
      load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to save profile.", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const doDuplicate = async (profile: InspectionProfile) => {
    try {
      await duplicateProfile(type, profile.id);
      setSnack({ message: `Profile "${profile.name}" duplicated.`, severity: "success" });
      load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to duplicate profile.", severity: "error" });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteProfile(type, pendingDelete.id);
      setSnack({ message: `Profile "${pendingDelete.name}" deleted.`, severity: "success" });
      setPendingDelete(null);
      load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to delete profile.", severity: "error" });
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: BRAND_NAVY }}>
          {LABELS[type]}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddOutlinedIcon />}
          onClick={() => openDialog(null)}
          sx={{ bgcolor: BRAND_NAVY, "&:hover": { bgcolor: "#1E1B54" } }}
        >
          Add Profile
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Configuration profiles applied when running a {type} inspection. Additional inspection settings will be added here over time.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer sx={{ border: "1px solid #E0E0E6", borderRadius: 2, bgcolor: "#fff" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F5F6FA" }}>
              {["Profile Name", "Description", "Status", "Created By", "Created Date", "Modified Date", "Actions"].map((header) => (
                <TableCell key={header} sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap" }}>
                  {header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 5 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : profiles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 5 }}>
                  <Typography color="text.secondary">No profiles yet. Click "Add Profile" to create one.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              profiles.map((profile) => (
                <TableRow key={profile.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{profile.name}</TableCell>
                  <TableCell>{profile.description}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={profile.status}
                      color={profile.status === "Active" ? "success" : "default"}
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell>{profile.createdBy}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmt(profile.createdAt)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmt(profile.modifiedAt)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Tooltip title="View">
                      <IconButton size="small" onClick={() => setViewProfile(profile)}>
                        <VisibilityOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openDialog(profile)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Duplicate">
                      <IconButton size="small" onClick={() => doDuplicate(profile)}>
                        <ContentCopyOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => setPendingDelete(profile)}>
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

      <Dialog open={Boolean(viewProfile)} onClose={() => setViewProfile(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: BRAND_NAVY }}>Profile Details</DialogTitle>
        <DialogContent dividers>
          {viewProfile &&
            ([
              ["Profile Name:", viewProfile.name],
              ["Description:", viewProfile.description],
              ["Status:", viewProfile.status],
              ["Created By:", viewProfile.createdBy],
              ["Created Date:", fmt(viewProfile.createdAt)],
              ["Modified By:", viewProfile.modifiedBy ?? "-"],
              ["Modified Date:", fmt(viewProfile.modifiedAt)],
            ] as Array<[string, string]>).map(([label, value]) => (
              <Box key={label} sx={{ display: "flex", py: 0.5 }}>
                <Typography variant="body2" sx={{ width: 140, color: "#6B7280" }}>
                  {label}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {value}
                </Typography>
              </Box>
            ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setViewProfile(null)} variant="contained" sx={{ bgcolor: BRAND_NAVY }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog.open} onClose={() => setDialog({ open: false, editing: null })} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: BRAND_NAVY }}>
          {dialog.editing ? "Edit Profile" : "Add Profile"}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gap: 2, pt: 0.5 }}>
            <Controller
              name="name"
              control={control}
              rules={{ required: "Profile name is required." }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Profile Name *"
                  size="small"
                  error={Boolean(errors.name)}
                  helperText={errors.name?.message ?? " "}
                />
              )}
            />
            <Controller
              name="description"
              control={control}
              render={({ field }) => <TextField {...field} label="Description" size="small" multiline minRows={2} />}
            />
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <TextField {...field} select label="Status" size="small">
                  {["Active", "Inactive"].map((status) => (
                    <MenuItem key={status} value={status}>
                      {status}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialog({ open: false, editing: null })} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleSubmit(save)} variant="contained" disabled={busy} sx={{ bgcolor: BRAND_NAVY }}>
            {busy ? <CircularProgress size={20} color="inherit" /> : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: BRAND_NAVY }}>Please Confirm</DialogTitle>
        <DialogContent>
          <Typography>Delete profile "{pendingDelete?.name}"? This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPendingDelete(null)} color="inherit">
            Cancel
          </Button>
          <Button onClick={confirmDelete} variant="contained" color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert severity={snack?.severity ?? "success"} onClose={() => setSnack(null)} variant="filled">
          {snack?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
