import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
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
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";

import { getLoggedInUsers, type LoggedInUser } from "../systemApi";
import { BRAND_NAVY, fmtDateTime } from "../components/adminUtils";
import { DetailDialog, SnackBar, type Snack } from "../components/adminUi";

const COLUMNS = [
  "User",
  "Email",
  "Login Time",
  "Last Activity",
  "IP Address",
  "Browser",
  "Operating System",
  "Session Status",
  "Actions",
];

export default function LoggedInUsersPage() {
  const [sessions, setSessions] = useState<LoggedInUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewUser, setViewUser] = useState<LoggedInUser | null>(null);
  const [snack, setSnack] = useState<Snack>(null);

  const load = () => {
    getLoggedInUsers()
      .then(setSessions)
      .catch((err: Error) => setError(err.message));
  };

  useEffect(load, []);

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

  const statusChip = (status: LoggedInUser["sessionStatus"]) => {
    const styles =
      status === "Active"
        ? {
            bgcolor: "rgba(46,125,50,.12)",
            color: "#2E7D32",
          }
        : status === "Idle"
        ? {
            bgcolor: "rgba(237,108,2,.12)",
            color: "#ED6C02",
          }
        : {
            bgcolor: "rgba(97,97,97,.12)",
            color: "#616161",
          };

    return (
      <Chip
        size="small"
        label={status}
        sx={{
          fontWeight: 700,
          borderRadius: 2,
          ...styles,
        }}
      />
    );
  };

  return (
    <Box
      sx={{
        p: { xs: 2, md: 4 },
        minHeight: "100vh",
        background: "linear-gradient(180deg,#F7F8FC 0%,#EEF1FA 100%)",
      }}
    >
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          borderRadius: 3,
          background: "#fff",
          boxShadow: "0 10px 30px rgba(42,39,110,.08)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box
            sx={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#2A276E,#3F3B99)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GroupsOutlinedIcon sx={{ color: "#fff" }} />
          </Box>

          <Box>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 700,
                color: BRAND_NAVY,
                lineHeight: 1.2,
              }}
            >
              Logged-in Users
            </Typography>

            <Typography color="text.secondary">
              Monitor active user sessions across the application.
            </Typography>
          </Box>
        </Box>
      </Paper>

      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 3,
            borderRadius: 2,
          }}
        >
          {error}
        </Alert>
      )}

      {/* Table */}
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 3,
          overflow: "hidden",
          border: "1px solid rgba(42,39,110,.08)",
          boxShadow: "0 12px 35px rgba(42,39,110,.08)",
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F4F5FB" }}>
              {COLUMNS.map((h) => (
                <TableCell
                  key={h}
                  sx={{
                    fontWeight: 700,
                    color: BRAND_NAVY,
                    whiteSpace: "nowrap",
                    py: 2,
                  }}
                >
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {!sessions ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMNS.length}
                  align="center"
                  sx={{ py: 6 }}
                >
                  <CircularProgress sx={{ color: BRAND_NAVY }} />
                  <Typography sx={{ mt: 2 }} color="text.secondary">
                    Loading active sessions...
                  </Typography>
                </TableCell>
              </TableRow>
            ) : sessions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMNS.length}
                  align="center"
                  sx={{ py: 6 }}
                >
                  <GroupsOutlinedIcon
                    sx={{
                      fontSize: 42,
                      color: "#B0B6C9",
                      mb: 1,
                    }}
                  />
                  <Typography color="text.secondary">
                    No active sessions.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((s) => (
                <TableRow
                  key={s.id}
                  hover
                  sx={{
                    transition: "all .2s ease",
                    "&:hover": {
                      bgcolor: "rgba(42,39,110,.04)",
                    },
                  }}
                >
                  <TableCell sx={{ fontWeight: 600 }}>{s.user}</TableCell>

                  <TableCell>{s.email}</TableCell>

                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {fmtDateTime(s.loginTime)}
                  </TableCell>

                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {fmtDateTime(s.lastActivity)}
                  </TableCell>

                  <TableCell>{s.ipAddress}</TableCell>

                  <TableCell>{s.browser}</TableCell>

                  <TableCell>{s.operatingSystem}</TableCell>

                  <TableCell>{statusChip(s.sessionStatus)}</TableCell>

                  <TableCell>
                    <Tooltip title="View Session Details">
                      <IconButton
                        size="small"
                        onClick={() => setViewUser(s)}
                        sx={{
                          borderRadius: 2,
                          transition: "all .2s ease",
                          "&:hover": {
                            bgcolor: "rgba(42,39,110,.12)",
                            color: BRAND_NAVY,
                          },
                        }}
                      >
                        <VisibilityOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Session Details */}
      <DetailDialog
        open={Boolean(viewUser)}
        title="Session Details"
        rows={detailRows}
        onClose={() => setViewUser(null)}
      />

      <SnackBar snack={snack} onClose={() => setSnack(null)} />
    </Box>
  );
}