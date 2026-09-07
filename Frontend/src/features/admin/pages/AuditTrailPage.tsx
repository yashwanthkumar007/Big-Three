import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import { getAuditLogs, type AuditLog } from "../systemApi";
import { BRAND_NAVY, fmtDateTime } from "../components/adminUtils";

const MODULES = [
  "All",
  "Authentication",
  "User Management",
  "Profile",
  "System Setup",
  "Text Inspection",
  "REST API",
];

const statusChip = (status: AuditLog["status"]) => (
  <Chip
    size="small"
    label={status}
    color={status === "Success" ? "success" : status === "Failed" ? "error" : "warning"}
    sx={{ fontWeight: 600 }}
  />
);

const COLUMNS = ["Date/Time", "User", "Action", "Module", "Description", "IP Address", "Status"];

export default function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState("All");
  const [module, setModule] = useState("All");
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  useEffect(() => {
    getAuditLogs()
      .then(setLogs)
      .catch((err: Error) => setError(err.message));
  }, []);

  const users = useMemo(
    () => ["All", ...Array.from(new Set((logs ?? []).map((log) => log.user)))],
    [logs]
  );

  const filtered = useMemo(() => {
    let rows = logs ?? [];

    if (user !== "All") {
      rows = rows.filter((row) => row.user === user);
    }

    if (module !== "All") {
      rows = rows.filter((row) => row.module === module);
    }

    if (status !== "All") {
      rows = rows.filter((row) => row.status === status);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (row) =>
          row.description.toLowerCase().includes(q) ||
          row.user.toLowerCase().includes(q) ||
          row.action.toLowerCase().includes(q)
      );
    }

    return rows;
  }, [logs, user, module, status, search]);

  const paged = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h4" sx={{ fontWeight: 700, color: BRAND_NAVY, mb: 2 }}>
        Audit Trail
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Immutable log of administrative and inspection actions. Records cannot be edited or deleted.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" },
          gap: 2,
          mb: 2,
        }}
      >
        <TextField
          select
          size="small"
          label="User"
          value={user}
          onChange={(event) => {
            setUser(event.target.value);
            setPage(0);
          }}
        >
          {users.map((u) => (
            <MenuItem key={u} value={u}>
              {u}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Module"
          value={module}
          onChange={(event) => {
            setModule(event.target.value);
            setPage(0);
          }}
        >
          {MODULES.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(0);
          }}
        >
          {["All", "Success", "Failed", "Warning"].map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          size="small"
          label="Search"
          placeholder="Search description, user or action"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </Box>

      <TableContainer sx={{ border: "1px solid #E0E0E6", borderRadius: 2, bgcolor: "#fff" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F5F6FA" }}>
              {COLUMNS.map((header) => (
                <TableCell key={header} sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap" }}>
                  {header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {!logs ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 5 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 5 }}>
                  <Typography color="text.secondary">No audit records match the selected filters.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paged.map((log) => (
                <TableRow key={log.id} hover>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(log.date)}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{log.user}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={log.action}
                      sx={{ fontWeight: 600, bgcolor: "#F1EFFA", color: BRAND_NAVY }}
                    />
                  </TableCell>
                  <TableCell>{log.module}</TableCell>
                  <TableCell>{log.description}</TableCell>
                  <TableCell>{log.ipAddress}</TableCell>
                  <TableCell>{statusChip(log.status)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50]}
        />
      </TableContainer>
    </Box>
  );
}

