import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Typography,
  Box,
} from "@mui/material";

const BRAND_NAVY = "#2A276E";

export type Snack = { message: string; severity: "success" | "error" } | null;

export function SnackBar({ snack, onClose }: { snack: Snack; onClose: () => void }) {
  return (
    <Snackbar
      open={Boolean(snack)}
      autoHideDuration={4000}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
    >
      <Alert severity={snack?.severity ?? "success"} onClose={onClose} variant="filled">
        {snack?.message}
      </Alert>
    </Snackbar>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  confirmColor = "primary",
  busy = false,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: "primary" | "error";
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, color: BRAND_NAVY }}>{title}</DialogTitle>
      <DialogContent>
        <Typography>{message}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={onConfirm} variant="contained" color={confirmColor} disabled={busy}>
          {busy ? <CircularProgress size={20} color="inherit" /> : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function DetailDialog({
  open,
  title,
  rows,
  onClose,
}: {
  open: boolean;
  title: string;
  rows: Array<[string, string]>;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, color: BRAND_NAVY }}>{title}</DialogTitle>
      <DialogContent dividers>
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ display: "flex", py: 0.5 }}>
            <Typography variant="body2" sx={{ width: 150, flexShrink: 0, color: "#6B7280" }}>
              {label}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {value}
            </Typography>
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} variant="contained" sx={{ bgcolor: BRAND_NAVY }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
