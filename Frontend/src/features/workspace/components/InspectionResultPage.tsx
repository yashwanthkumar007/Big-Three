
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
} from "@/shared/api/inspectionApi";
import type { InspectionType } from "@/store/uploadStore";
import { useBarcodeJobStatus } from "@/shared/hooks/useBarcodeJobStatus";
import { BARCODE_STAGE_LABELS } from "@/shared/config/barcodeInspectionConfig";

import InspectionResults, {
  type InspectionDifference,
  type InspectionResult,
} from "./InspectionResults";
import BarcodeInspectionResults, {
  type BarcodeResultPageModel,
} from "./BarcodeInspectionResults";

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
  const { inspectionId } = useParams<{ inspectionId: string }>();

  const [selectedDifference, setSelectedDifference] =
    useState<InspectionDifference | null>(null);

  const {
    data: inspection,
    isLoading,
    isError: inspectionError,
    error: inspectionErrorDetails,
  } = useQuery({
    queryKey: ["inspection", inspectionId],
    queryFn: () => {
      if (!inspectionId) {
        throw new Error("Inspection ID is missing.");
      }
      return fetchInspection(inspectionId);
    },
    enabled: Boolean(inspectionId),
  });

  const isBarcode = inspection?.inspectionType === "barcode";
  const isBraille = inspection?.inspectionType === "braille";

  const barcodeJob = useBarcodeJobStatus(
    isBarcode ? inspection?.barcodeJobId ?? null : null
  );

  const masterFileName =
    inspection?.masterFile?.fileName ??
    inspection?.inspectionFile?.fileName ??
    "master.pdf";

  const sampleFileName =
    inspection?.sampleFile?.fileName ?? "sample.pdf";

  const barcodeFileQuery = useQuery({
    queryKey: ["inspection-files", inspectionId, "barcode"],
    queryFn: async (): Promise<File> => {
      if (!inspectionId) {
        throw new Error("Inspection ID is missing.");
      }

      const file = await fetchInspectionFile(
        inspectionId,
        "master",
        masterFileName
      );

      if (!file) {
        throw new Error("The barcode document is unavailable.");
      }

      return file;
    },
    enabled: Boolean(
      inspectionId &&
        inspection &&
        inspection.status === "completed" &&
        isBarcode
    ),
    retry: 1,
  });

  const filesQuery = useQuery({
    queryKey: [
      "inspection-files",
      inspectionId,
      masterFileName,
      sampleFileName,
      inspection?.inspectionType,
    ],
    queryFn: async (): Promise<{
      masterFile: File;
      sampleFile: File;
    }> => {
      if (!inspectionId) {
        throw new Error("Inspection ID is missing.");
      }

      const masterFile = await fetchInspectionFile(
        inspectionId,
        "master",
        masterFileName
      );

      if (!masterFile) {
        throw new Error("The master document is unavailable.");
      }

      if (isBraille) {
        return {
          masterFile,
          sampleFile: masterFile,
        };
      }

      const sampleFile = await fetchInspectionFile(
        inspectionId,
        "sample",
        sampleFileName
      );

      if (!sampleFile) {
        throw new Error("The sample document is unavailable.");
      }

      return { masterFile, sampleFile };
    },
    enabled: Boolean(
      inspectionId &&
        inspection &&
        inspection.status === "completed" &&
        !isBarcode
    ),
    retry: 1,
  });

  const barcodeResultModel = useMemo<BarcodeResultPageModel>(() => {
    const report = inspection?.result?.report;
    const sourceBarcodes =
      barcodeJob.barcodes.length > 0
        ? barcodeJob.barcodes
        : inspection?.barcodeResults ?? [];
    const jobBarcodes = sourceBarcodes
      .map((barcode) => ({
        id: barcode.id,
        type: barcode.type,
        decodedValue: barcode.decodedValue,
        grade: barcode.grade,
        page: Math.max(0, (barcode.page ?? 1) - 1),
        box: barcode.bbox ?? null,
        pageWidth: barcode.pageWidth ?? null,
        pageHeight: barcode.pageHeight ?? null,
        coordinateSystem: barcode.coordinateSystem ?? null,
        quality:
          (barcode.qualityMetrics as Record<string, string> | null) ?? null,
        verification: barcode.verification ?? null,
      }));
    const savedBarcodes = (report?.findings ?? [])
      .filter((finding) => finding.type === "Barcode")
      .map((finding) => {
        const page = Math.max(0, (finding.page ?? 1) - 1);
        const pageDimensions = report?.pages.find(
          (reportPage) => reportPage.page === page,
        );

        return {
          id: finding.id,
          type: finding.barcode_type ?? finding.type,
          decodedValue: finding.decoded_value ?? finding.master ?? "",
          grade: finding.grade ?? null,
          page,
          box: finding.master_box ?? null,
          pageWidth: pageDimensions?.master_width ?? null,
          pageHeight: pageDimensions?.master_height ?? null,
          coordinateSystem: "pixels",
          quality: null,
        };
      });
    const barcodes = (jobBarcodes.length > 0 ? jobBarcodes : savedBarcodes)
      .sort(
        (a, b) =>
          a.page - b.page ||
          (a.box?.y ?? 0) - (b.box?.y ?? 0) ||
          (a.box?.x ?? 0) - (b.box?.x ?? 0)
      );

    return {
      inspectionId: inspection?.inspectionId ?? inspectionId ?? "",
      fileName: masterFileName,
      barcodes: barcodes.map((barcode, index) => ({
        ...barcode,
        id: index + 1,
      })),
    };
  }, [
    barcodeJob.barcodes,
    inspection?.barcodeResults,
    inspection?.inspectionId,
    inspectionId,
    masterFileName,
    inspection?.result?.report,
  ]);

  const result = useMemo<InspectionResult | null>(() => {
    const report = inspection?.result?.report;

    if (
      !inspection ||
      inspection.status !== "completed" ||
      !report
    ) {
      return null;
    }

    const differences: InspectionDifference[] = report.findings.map(
      (finding) => ({
        id: finding.id,
        type: finding.type,
        master: finding.master ?? "",
        sample: finding.sample ?? "",
        level: finding.grade ?? null,
        comment: finding.comment ?? null,
        status: finding.status ?? null,
        page: finding.page,
        masterBox: finding.master_box ?? null,
        sampleBox: finding.sample_box ?? null,
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

    return {
      inspectionId: inspection.inspectionId,
      inspectionType:
        (inspection.inspectionType as InspectionType) ?? "text",
      masterFileName,
      sampleFileName,
      totalDifferences: differences.length,
      differences,
      brailleLanguage: report.metadata?.language,
      pages: report.pages.map((page) => ({
        page: page.page,
        masterWidth: page.master_width,
        masterHeight: page.master_height,
        sampleWidth: page.sample_width,
        sampleHeight: page.sample_height,
        sampleImage: page.sample_image,
      })),
    };
  }, [inspection, masterFileName, sampleFileName]);

  const goToDashboard = () => navigate("/dashboard");

  if (!inspectionId) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">Inspection ID is missing.</Alert>
        <Button onClick={goToDashboard} sx={{ mt: 2 }}>
          BACK TO DASHBOARD
        </Button>
      </Box>
    );
  }

  if (isLoading) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>
          Loading Inspection Result…
        </Typography>
      </Box>
    );
  }

  if (inspectionError || !inspection) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {inspectionErrorDetails instanceof Error
            ? inspectionErrorDetails.message
            : "Unable to load this inspection."}
        </Alert>
        <Button variant="contained" onClick={goToDashboard} sx={{ mt: 2 }}>
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

        {inspection.status === "processing" && (
          <Box
            sx={{
              mt: 3,
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <CircularProgress size={20} />
            <Typography>
              This inspection is still processing. Results are not available
              yet.
            </Typography>
          </Box>
        )}

        <Button
          variant="outlined"
          onClick={goToDashboard}
          sx={{ mt: 3 }}
        >
          BACK TO DASHBOARD
        </Button>
      </Box>
    );
  }

  if (isBarcode) {
    if (barcodeFileQuery.isError) {
      return (
        <Box sx={{ p: 4 }}>
          <Alert severity="error">
            {barcodeFileQuery.error instanceof Error
              ? barcodeFileQuery.error.message
              : "Unable to load the barcode document."}
          </Alert>
          <Button
            sx={{ mt: 2 }}
            onClick={() => void barcodeFileQuery.refetch()}
          >
            Retry
          </Button>
        </Box>
      );
    }

    if (barcodeFileQuery.isPending || !barcodeFileQuery.data) {
      return (
        <Box sx={{ p: 6, textAlign: "center" }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>
            Loading Barcode Inspection Result…
          </Typography>
        </Box>
      );
    }

    return (
      <BarcodeInspectionResults
        result={barcodeResultModel}
        file={barcodeFileQuery.data}
        jobStatus={
          inspection.status === "completed"
            ? null
            : barcodeJob.status ?? "queued"
        }
        stageLabel={BARCODE_STAGE_LABELS[barcodeJob.stage]}
        progress={
          barcodeJob.totalPages > 0
            ? {
                currentPage: barcodeJob.currentPage,
                totalPages: barcodeJob.totalPages,
              }
            : null
        }
        error={
          inspection.status === "completed" ? null : barcodeJob.error ?? null
        }
        onCancel={barcodeJob.cancel}
        isCancelling={barcodeJob.isCancelling}
      />
    );
  }

  if (filesQuery.isError) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          {filesQuery.error instanceof Error
            ? filesQuery.error.message
            : "Unable to load the inspection documents."}
        </Alert>
        <Button
          sx={{ mt: 2 }}
          onClick={() => void filesQuery.refetch()}
        >
          Retry
        </Button>
      </Box>
    );
  }

  if (filesQuery.isPending || !filesQuery.data) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>
          Loading Inspection Result…
        </Typography>
      </Box>
    );
  }

  if (!result) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="warning">
          The inspection is completed, but its saved report was not returned
          by the backend. Check that the inspection API includes
          result.report.findings and result.report.pages.
        </Alert>
      </Box>
    );
  }

  return (
    <InspectionResults
      result={result}
      masterFile={filesQuery.data.masterFile}
      sampleFile={filesQuery.data.sampleFile}
      selectedDifference={selectedDifference}
      onDifferenceSelect={setSelectedDifference}
    />
  );
}
