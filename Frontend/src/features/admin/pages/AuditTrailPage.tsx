import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Drawer,
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

import { getAuditLogs, type AuditLog, type AuditLogFilters } from "../systemApi";
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

const EVENTS = [
  "All",
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGOUT",
  "SESSION_EXPIRED",
  "SESSION_TERMINATED",
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DELETED",
  "ACCOUNT_TYPE_CHANGED",
  "USER_ENABLED",
  "USER_DISABLED",
  "FILE_UPLOADED",
  "FILE_SUBMITTED",
  "INSPECTION_CREATED",
  "INSPECTION_STARTED",
  "INSPECTION_COMPLETED",
  "INSPECTION_FAILED",
  "INSPECTION_VIEWED",
  "CROP_INSPECTION_COMPLETED",
  "CROP_INSPECTION_FAILED",
  "DIFFERENCE_VIEWED",
  "DIFFERENCE_LEVEL_CHANGED",
  "DIFFERENCE_STATUS_CHANGED",
  "DIFFERENCE_COMMENT_ADDED",
  "DIFFERENCE_COMMENT_UPDATED",
  "REPORT_CREATED",
  "REPORT_VIEWED",
  "REPORT_DOWNLOADED",
];

// Small standalone label used above the date pickers instead of MUI's
// floating label. Native <input type="date"> renders its own "dd-mm-yyyy"
// placeholder inside the field, and no amount of background-behind-label
// styling reliably keeps it clear of a floating label's notch — so we avoid
// the floating label entirely for these two fields.
const DateFieldLabel = ({ children }: { children: React.ReactNode }) => (
  <Typography
    variant="caption"
    sx={{ display: "block", color: "text.secondary", mb: 0.5, ml: 0.25 }}
  >
    {children}
  </Typography>
);

const statusChip = (status: string) => (
  <Chip
    size="small"
    label={status}
    color={status === "Success" ? "success" : status === "Failed" ? "error" : "warning"}
    sx={{ fontWeight: 600 }}
  />
);

const COLUMNS = ["Date/Time", "User", "Account Type", "Event", "Module", "Description", "IP Address", "Status"];

export default function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [module, setModule] = useState("All");
  const [eventFilter, setEventFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Fetch logs from backend with current filters
  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: AuditLogFilters = {
        page,
        limit: rowsPerPage,
        ...(module !== "All" ? { module } : {}),
        ...(eventFilter !== "All" ? { event: eventFilter } : {}),
        ...(statusFilter !== "All" ? { status: statusFilter } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      };
      const response = await getAuditLogs(filters);
      setLogs(response.items);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs.");
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  // Fetch logs when filters or pagination changes
  useEffect(() => {
  const loadLogs = async () => {
    await fetchLogs();
  };

  void loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, rowsPerPage, module, eventFilter, statusFilter, startDate, endDate]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (page !== 1) {
        setPage(1);
      } else {
        fetchLogs();
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleRowClick = (log: AuditLog) => {
    setSelectedLog(log);
    setDrawerOpen(true);
  };

  const handlePageChange = (_: unknown, newPage: number) => {
    setPage(newPage + 1); // MUI is 0-based, backend is 1-based
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(1);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, minHeight: "100vh", background: "linear-gradient(180deg,#F7F8FC 0%,#EEF1FA 100%)" }}>
      <Box sx={{ p: 3, mb: 3, borderRadius: 3, bgcolor: "#fff", boxShadow: "0 10px 30px rgba(42,39,110,.08)" }}><Box sx={{ display:"flex", alignItems:"center", gap:2 }}><Box sx={{ width:52, height:52, borderRadius:"50%", background:"linear-gradient(135deg,#2A276E,#3F3B99)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700 }}>🛡</Box><Box><Typography variant="h4" sx={{ fontWeight: 700, color: BRAND_NAVY }}>
        Audit Trail
      </Typography><Typography variant="body2" color="text.secondary">Immutable log of administrative and inspection actions. Records cannot be edited or deleted.</Typography></Box></Box></Box>
      <Typography variant="body2" color="text.secondary" sx={{ display:"none" }}>
        Immutable log of administrative and inspection actions. Records cannot be edited or deleted.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ p:3, mb:3, borderRadius:3, bgcolor:"#fff", boxShadow:"0 10px 30px rgba(42,39,110,.08)", display:"grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" },
          gap: 2,
        }}
      >
        <TextField
          select
          size="small"
          label="Module"
          value={module}
          onChange={(event) => {
            setModule(event.target.value);
            setPage(1);
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
          label="Event"
          value={eventFilter}
          onChange={(event) => {
            setEventFilter(event.target.value);
            setPage(1);
          }}
        >
          {EVENTS.map((e) => (
            <MenuItem key={e} value={e}>
              {e}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Status"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
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
          onChange={(event) => setSearch(event.target.value)}
        />

        <Box>
          <DateFieldLabel>Start Date</DateFieldLabel>
          <TextField
            size="small"
            type="date"
            fullWidth
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              setPage(1);
            }}
          />
        </Box>

        <Box>
          <DateFieldLabel>End Date</DateFieldLabel>
          <TextField
            size="small"
            type="date"
            fullWidth
            value={endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
              setPage(1);
            }}
          />
        </Box>
      </Box>

      <TableContainer sx={{ border:"1px solid rgba(42,39,110,.08)", borderRadius:3, bgcolor:"#fff", overflow:"hidden", boxShadow:"0 12px 35px rgba(42,39,110,.08)" }}>
        <Table size="small" sx={{ tableLayout: "fixed" }}>
          <TableHead>
            <TableRow sx={{ bgcolor:"#F4F5FB" }}>
              <TableCell sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap", width: 160 }}>
                Date/Time
              </TableCell>
              <TableCell sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap", width: 170 }}>
                Performed By
              </TableCell>
              <TableCell sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap", width: 120 }}>
                Account Type
              </TableCell>
              <TableCell sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap", width: 170 }}>
                Event
              </TableCell>
              <TableCell sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap", width: 130 }}>
                Module
              </TableCell>
              <TableCell sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap" }}>
                Description
              </TableCell>
              <TableCell sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap", width: 110 }}>
                IP Address
              </TableCell>
              <TableCell sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap", width: 100 }}>
                Status
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 5 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : !logs || logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 5 }}>
                  <Typography color="text.secondary">No audit records match the selected filters.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id} hover onClick={() => handleRowClick(log)} sx={{ cursor:"pointer", transition:"all .2s ease", "&:hover":{ bgcolor:"rgba(42,39,110,.04)" } }}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(log.timestamp)}</TableCell>
                  <TableCell sx={{ fontWeight: 600, wordBreak: "break-word" }}>{log.email}</TableCell>
                  <TableCell>{log.accountType}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={log.event}
                      sx={{ fontWeight:700, bgcolor:"rgba(42,39,110,.08)", color:BRAND_NAVY, borderRadius:2 }}
                    />
                  </TableCell>
                  <TableCell>{log.module}</TableCell>
                  <TableCell
                    sx={{
                      whiteSpace: "normal",
                      wordBreak: "break-word",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {log.description}
                  </TableCell>
                  <TableCell sx={{ wordBreak: "break-word" }}>{log.ipAddress}</TableCell>
                  <TableCell>{statusChip(log.status)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {total > rowsPerPage && (
          <TablePagination
            component="div"
            count={total}
            page={page - 1} // MUI is 0-based
            onPageChange={handlePageChange}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[10, 25, 50]}
          />
        )}
      </TableContainer>

      {/* Detail Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)} slotProps={{ paper:{ sx:{ width:{ xs:"100%", sm:460 }, bgcolor:"#FAFBFF" } } }}
      >
        {selectedLog && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ bgcolor: BRAND_NAVY, color:"#fff", mx:-3, mt:-3, mb:3, px:3, py:2.5 }}><Typography variant="h6" sx={{ fontWeight:700 }}>
              Audit Log Details
            </Typography>
            <DetailRow label="User" value={selectedLog.email} />
            <DetailRow label="Account Type" value={selectedLog.accountType} />
            <DetailRow label="Timestamp" value={fmtDateTime(selectedLog.timestamp)} />
            <DetailRow label="Event" value={selectedLog.event} />
            <DetailRow label="Action" value={selectedLog.action} />
            <DetailRow label="Application" value={selectedLog.application} />
            <DetailRow label="Module" value={selectedLog.module} />
            <DetailRow label="Entity Type" value={selectedLog.entityType} />
            <DetailRow label="Entity ID" value={selectedLog.entityId} />
            <DetailRow label="Inspection ID" value={selectedLog.inspectionId} />
            <DetailRow label="File ID" value={selectedLog.fileId} />
            <DetailRow label="File Name" value={selectedLog.fileName} />
            <DetailRow label="Master File" value={selectedLog.masterFileName} />
            <DetailRow label="Sample File" value={selectedLog.sampleFileName} />
            <DetailRow label="Status" value={selectedLog.status} />
            <DetailRow label="Description" value={selectedLog.description} />
            <DetailRow label="Session ID" value={selectedLog.sessionId} />
            <DetailRow label="IP Address" value={selectedLog.ipAddress} />
            <DetailRow label="User Agent" value={selectedLog.userAgent} />
            {selectedLog.changes && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: "#6B7280" }}>
                  Changes:
                </Typography>
                <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: 0 }}>
                  {JSON.stringify(selectedLog.changes, null, 2)}
                </pre>
              </Box>
            )}
            {selectedLog.metadata && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: "#6B7280" }}>
                  Metadata:
                </Typography>
                <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: 0 }}>
                  {JSON.stringify(selectedLog.metadata, null, 2)}
                </pre>
              </Box>
            )}
            </Box>
          </Box>
        )}
      </Drawer>
    </Box>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", py: 0.75 }}>
      <Typography variant="body2" sx={{ width: 140, color: "#6B7280", flexShrink: 0 }}>
        {label}:
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
        {value}
      </Typography>
    </Box>
  );
}
