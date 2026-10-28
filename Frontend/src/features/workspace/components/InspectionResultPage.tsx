import { useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";

import { useNavigate, useParams } from "react-router-dom";

import { useQuery } from "@tanstack/react-query";

import {
  fetchInspection,
  fetchInspectionFile,
  type InspectionMeta,
} from "@/shared/api/inspectionApi";
import type { InspectionType } from "@/store/uploadStore";

import InspectionResults, {
  type InspectionDifference,
  type InspectionResult,
} from "./InspectionResults";

/*
 * Stored Inspection Result Page — reuses the ORIGINAL results UI.
 *
 * Opens a previously completed inspection and shows the exact same
 * InspectionResults screen used after a fresh run. It loads the
 * owner-verified inspection by inspectionId, reconstructs the real
 * master/sample File objects through the owner-verified file endpoint, and
 * renders <InspectionResults />. It NEVER runs the Python inspection engine
 * and depends only on the route inspectionId (refresh-safe).
 */

const statusLabel = (status: string) => {
  switch (status) {
    case "completed":
      return "Completed";
    case "processing":
      return "Processing…";
    case "failed":
      return "Failed";
    case "submitted":
      return "Submitted";
    case "uploaded":
      return "Uploaded";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
};

export default function InspectionResultPage() {
  const navigate = useNavigate();
  const { inspectionId } = useParams();

  const { data: inspection, isLoading, isError } = useQuery({
    queryKey: ["inspection", inspectionId],
    queryFn: () => fetchInspection(inspectionId as string),
    enabled: Boolean(inspectionId),
  });

  if (isLoading || (!inspection && !isError)) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading Inspection Result…</Typography>
      </Box>
    );
  }

  if (isError || !inspection) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Unable to load this inspection. It may have been removed, or you do
          not have access to it.
        </Alert>
        <Button
  variant="contained"
  onClick={() => navigate("/dashboard")}
  sx={{
    mt: 4,
    backgroundColor: "#2A276E !important",
    color: "#FFFFFF",
    "&:hover": {
      backgroundColor: "rgba(42, 39, 110, 0.9) !important",
    },
  }}
>
  BACK TO DASHBOARD
</Button>
      </Box>
    );
  }

  if (inspection.status !== "completed") {
    return (
      <Box sx={{ p: 4 }}>
        <Typography variant="h5" sx={{ mb: 1 }}>
          {inspection.inspectionId}
        </Typography>
        <Typography color="text.secondary">
          Inspection type: {inspection.inspectionType} · Status:{" "}
          {statusLabel(inspection.status)}
        </Typography>
        {inspection.status === "processing" ? (
          <Box sx={{ mt: 3, display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={20} />
            <Typography>
              This inspection is still processing. Results are not available
              yet — no new inspection was started.
            </Typography>
          </Box>
        ) : inspection.status === "failed" ? (
          <Alert severity="error" sx={{ mt: 3 }}>
            This inspection failed
            {inspection.failedReason ? `: ${inspection.failedReason}` : "."}
          </Alert>
        ) : (
          <Alert severity="info" sx={{ mt: 3 }}>
            This inspection has not completed yet, so no results are available.
          </Alert>
        )}
        <Button
          variant="contained"
          sx={{ mt: 4 }}
          onClick={() => navigate("/dashboard")}
        >
          Back to Dashboard
        </Button>
      </Box>
    );
  }

  return <CompletedResultPage inspection={inspection} />;
}
function CompletedResultPage({ inspection }: { inspection: InspectionMeta }) {
  const [selectedDifference, setSelectedDifference] =
    useState<InspectionDifference | null>(null);

  const masterFileName = inspection.masterFile?.fileName ?? "master.pdf";
  const sampleFileName = inspection.sampleFile?.fileName ?? "sample.pdf";
  const report = inspection.result?.report ?? null;

  const isBraille = inspection.inspectionType === "braille";
  const { data: files, isPending, isError, error, refetch } = useQuery({
    queryKey: ["inspection-files", inspection.inspectionId],
    queryFn: async (): Promise<{ masterFile: File; sampleFile: File }> => {
      const masterFile = await fetchInspectionFile(
        inspection.inspectionId,
        "master",
        masterFileName
      );
      if (!masterFile) {
        throw new Error("The inspection document is unavailable.");
      }

      if (isBraille) {
        return { masterFile, sampleFile: masterFile };
      }

      const sampleFile = await fetchInspectionFile(
        inspection.inspectionId,
        "sample",
        sampleFileName
      );
      if (!sampleFile) {
        throw new Error("The Sample document is unavailable.");
      }

      return { masterFile, sampleFile };
    },
    enabled: Boolean(inspection.inspectionId),
    retry: 1,
  });

  const result = useMemo<InspectionResult | null>(() => {
    if (!report) {
      return null;
    }
    const differences: InspectionDifference[] = (report.findings ?? []).map(
      (finding) => ({
        id: finding.id,
        type: finding.type,
        master: finding.master,
        sample: finding.sample,
        level: null,
        comment: finding.comment,
        status: finding.status,
        page: finding.page,
        masterBox: finding.master_box,
        sampleBox: finding.sample_box,
        barcodeType: finding.barcode_type ?? null,
        decodedValue: finding.decoded_value ?? null,
        grade: finding.grade ?? null,
        brailleMetrics: finding.braille_metrics
          ? {
              lines: finding.braille_metrics.lines,
              characters: finding.braille_metrics.characters,
              dots: finding.braille_metrics.dots,
              dotHMillimeters: finding.braille_metrics.dot_h_mm,
              dotVMillimeters: finding.braille_metrics.dot_v_mm,
              characterMillimeters: finding.braille_metrics.character_mm,
              wordMillimeters: finding.braille_metrics.word_mm,
              lineMillimeters: finding.braille_metrics.line_mm,
            }
          : null,
      })
    );
    const pages =
      report.pages?.map((page) => ({
        page: page.page,
        masterWidth: page.master_width,
        masterHeight: page.master_height,
        sampleWidth: page.sample_width,
        sampleHeight: page.sample_height,
        sampleImage: page.sample_image,
      })) ?? [];
    return {
      inspectionId: inspection.inspectionId,
      inspectionType: (inspection.inspectionType as InspectionType) ?? "text",
      masterFileName,
      sampleFileName,
      totalDifferences: differences.length,
      differences,
      pages,
      brailleLanguage: report.metadata?.language,
      inspectionStatus: inspection.status,
    };
  }, [inspection, report, masterFileName, sampleFileName]);

  if (isError) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          {error instanceof Error
            ? error.message
            : "Unable to load the inspection documents."}
        </Alert>
        <Button sx={{ mt: 2 }} onClick={() => void refetch()}>
          Retry
        </Button>
      </Box>
    );
  }

  if (!report || !result) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          This completed inspection has no report available to display.
        </Alert>
      </Box>
    );
  }

  if (isPending || !files) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading Inspection Result…</Typography>
      </Box>
    );
  }

  return (
    <InspectionResults
      result={result}
      masterFile={files.masterFile}
      sampleFile={files.sampleFile}
      selectedDifference={selectedDifference}
      onDifferenceSelect={setSelectedDifference}
    />
  );
}