import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from "@mui/material";

import { useNavigate } from "react-router-dom";

import { useQuery } from "@tanstack/react-query";

import { useState } from "react";

import { fetchMyInspections, type InspectionMeta } from "@/shared/api/inspectionApi";

const PAGE_SIZE = 10;

const statusChipColor = (status: string) => {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "processing":
    case "submitted":
      return "warning";
    default:
      return "default";
  }
};

const formatDateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

// Shared style for truncating long file names with an ellipsis.
// A `title` attribute is added on the cell itself so the full name
// is still available on hover.
const truncatedCellSx = {
  maxWidth: 160,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

export default function DashboardPage() {
  const navigate = useNavigate();

  const [page, setPage] = useState(0);

  const { data: inspections, isLoading } = useQuery({
    queryKey: ["inspections"],
    queryFn: () => fetchMyInspections(),
    // Reuse data briefly when returning to the dashboard, avoiding a blank
    // loading state and duplicate request during quick navigation.
    staleTime: 5_000,
    // Keep processing/completed statuses fresh, but only poll while an
    // inspection is still running or queued.
    refetchInterval: (query) => {
      const rows = query.state.data as InspectionMeta[] | undefined;
      return rows?.some((inspection) => ["submitted", "processing"].includes(inspection.status))
        ? 15_000
        : false;
    },
  });

  const openInspection = (inspection: InspectionMeta) => {
    // Navigate to the stored-result page using ONLY the inspectionId as the
    // route identifier. The result page fetches the owner-verified inspection
    // and its stored results from the backend by this id — it does NOT rely
    // on Zustand/localStorage/router state, survives a browser refresh, and
    // NEVER re-runs the inspection engine.
    navigate(`/inspection-result/${inspection.inspectionId}`);
  };

  const rows = inspections ?? [];
  const pagedRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4">Dashboard</Typography>

      <Typography variant="h6" sx={{ mt: 4, mb: 2 }}>
        Recent Inspections
      </Typography>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Inspection ID</TableCell>
              <TableCell>Type</TableCell>
              <TableCell sx={{ width: 160 }}>Master File</TableCell>
              <TableCell sx={{ width: 160 }}>Sample File</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Completed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>Loading inspections…</TableCell>
              </TableRow>
            ) : pagedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  No inspections yet — start one from the workspace.
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map((inspection) => (
                <TableRow
                  key={inspection.inspectionId}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => openInspection(inspection)}
                >
                  <TableCell>{inspection.inspectionId}</TableCell>
                  <TableCell sx={{ textTransform: "capitalize" }}>
                    {inspection.inspectionType}
                  </TableCell>
                  <TableCell
                    sx={truncatedCellSx}
                    title={inspection.masterFile?.fileName ?? undefined}
                  >
                    {inspection.masterFile?.fileName ?? "—"}
                  </TableCell>
                  <TableCell
                    sx={truncatedCellSx}
                    title={inspection.sampleFile?.fileName ?? undefined}
                  >
                    {inspection.sampleFile?.fileName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={statusChipColor(inspection.status) as never}
                      label={
                        inspection.status === "processing"
                          ? "Processing…"
                          : inspection.status
                      }
                    />
                  </TableCell>
                  <TableCell>{formatDateTime(inspection.createdAt)}</TableCell>
                  <TableCell>{formatDateTime(inspection.completedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {rows.length > PAGE_SIZE && (
          <TablePagination
            component="div"
            count={rows.length}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[PAGE_SIZE]}
          />
        )}
      </TableContainer>
    </Box>
  );
}
