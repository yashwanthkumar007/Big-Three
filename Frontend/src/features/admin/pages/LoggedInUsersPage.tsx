import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";

import { getLoggedInUsers, terminateSession, type LoggedInUser } from "../systemApi";
import { BRAND_NAVY, fmtDateTime } from "../components/adminUtils";
import { ConfirmDialog, DetailDialog, SnackBar, type Snack } from "../components/adminUi";

const COLUMNS = ["User", "Email", "Login Time", "Last Activity", "IP Address", "Browser", "Operating System", "Session Status", "Actions"];

export default function LoggedInUsersPage() {
  const [sessions, setSessions] = useState<LoggedInUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewUser, setViewUser] = useState<LoggedInUser | null>(null);
  const [terminating, setTerminating] = useState<LoggedInUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<Snack>(null);

  const load = () => {
    getLoggedInUsers()
      .then(setSessions)
      .catch((err: Error) => setError(err.message));
  };

  useEffect(load, []);

  const doTerminate = async () => {
    if (!terminating) return;
    setBusy(true);
    try {
      await terminateSession(terminating.id);
      setSnack({ message: `Session for "${terminating.user}" terminated.`, severity: "success" });
      setTerminating(null);
      load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Failed to terminate session.", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const detailRows = viewUser
    ? ([
        ["User:", viewUser.user],
        ["Email:", viewUser.email],
        ["Login Time:", fmtDateTime(viewUser.loginTime)],
        ["Last Activity:", fmtDateTime(viewUser.lastActivity)],
        ["IP Address:", viewUser.ipAddress],
        ["Browser:", viewUser.browser],
        ["Operating System:", viewUser.operatingSystem],
        ["Session Status:", viewUser.sessionStatus],
      ] as Array<[string, string]>)
    : [];

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h4" sx={{ fontWeight: 700, color: BRAND_NAVY, mb: 2 }}>
        Logged-in Users
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
              {COLUMNS.map((h) => (
                <TableCell key={h} sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap" }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {!sessions ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 5 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 5 }}>
                  <Typography color="text.secondary">No active sessions.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{s.user}</TableCell>
                  <TableCell>{s.email}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(s.loginTime)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(s.lastActivity)}</TableCell>
                  <TableCell>{s.ipAddress}</TableCell>
                  <TableCell>{s.browser}</TableCell>
                  <TableCell>{s.operatingSystem}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={s.sessionStatus}
                      color={s.sessionStatus === "Active" ? "success" : s.sessionStatus === "Idle" ? "warning" : "default"}
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Tooltip title="View">
                      <IconButton size="small" onClick={() => setViewUser(s)}>
                        <VisibilityOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Terminate Session">
                      <IconButton size="small" color="error" onClick={() => setTerminating(s)}>
                        <LogoutOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <DetailDialog open={Boolean(viewUser)} title="Session Details" rows={detailRows} onClose={() => setViewUser(null)} />

      <ConfirmDialog
        open={Boolean(terminating)}
        title="Terminate Session"
        message={`Terminate the session for "${terminating?.user}"? The user will be logged out immediately.`}
        confirmLabel="Terminate"
        confirmColor="error"
        busy={busy}
        onClose={() => setTerminating(null)}
        onConfirm={doTerminate}
      />

      <SnackBar snack={snack} onClose={() => setSnack(null)} />
    </Box>
  );
}
