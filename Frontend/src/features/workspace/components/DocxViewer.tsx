import { useEffect, useRef, useState } from "react";

import { Box, CircularProgress, Typography } from "@mui/material";

import { renderAsync } from "docx-preview";

import type { InspectionDifference } from "./InspectionResults";
import type { BoundingBox } from "@/shared/api/inspectionApi";

type DocxViewerProps = {
  file: File;
  pageNumber?: number;
  zoom?: number;
  onNumPagesChange?: (numPages: number) => void;
  /** Parity props mirrored from PdfViewer. */
  inspectionType?: string;
  side?: "master" | "sample";
  selectedDifference?: InspectionDifference | null;
  naturalWidth?: number;
  naturalHeight?: number;
  zeroBasedPageIndex?: boolean;
  cropMode?: boolean;
  onCropComplete?: (page0Based: number, box: BoundingBox) => void;
};

const getBoundingBox = (
  difference: InspectionDifference | null | undefined,
  side: "master" | "sample"
): BoundingBox | null => {
  if (!difference) {
    return null;
  }

  if (side === "master") {
    return difference.masterBox ?? null;
  }

  return difference.sampleBox ?? null;
};

export default function DocxViewer({
  file,
  pageNumber = 1,
  zoom = 100,
  onNumPagesChange,
  side = "master",
  selectedDifference,
  cropMode,
}: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(1);

  const cropEnabled = Boolean(cropMode) && side === "master";
  const showMissingCoordinatesNotice =
    Boolean(selectedDifference) && !getBoundingBox(selectedDifference, side);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    let cancelled = false;

    container.innerHTML = "";
    setLoading(true);
    setError(null);

    file
      .arrayBuffer()
      .then((buffer) => {
        if (cancelled) {
          return;
        }

        return renderAsync(new Blob([buffer]), container);
      })
      .then(() => {
        if (cancelled) {
          return;
        }

        const sections = Array.from(
          container.querySelectorAll("section.docx")
        ) as HTMLElement[];
        const count = Math.max(1, sections.length);

        // Show only the first page initially; pagination effect handles the rest.
        sections.forEach((section, index) => {
          section.style.display = index === 0 ? "" : "none";
        });

        setNumPages(count);
        onNumPagesChange?.(count);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        setError(
          err instanceof Error ? err.message : "Failed to render document."
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file, onNumPagesChange]);

  // Toggle which page is visible when pageNumber changes.
  useEffect(() => {
    const container = containerRef.current;

    if (!container || loading) {
      return;
    }

    const sections = Array.from(
      container.querySelectorAll("section.docx")
    ) as HTMLElement[];

    if (sections.length === 0) {
      return;
    }

    const index = Math.max(
      0,
      Math.min(sections.length - 1, (pageNumber ?? 1) - 1)
    );

    sections.forEach((section, i) => {
      section.style.display = i === index ? "" : "none";
    });
  }, [pageNumber, loading]);

  return (
    <Box
      sx={{
        position: "relative",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        bgcolor: "#FFFFFF",
      }}
    >
      <Box
        sx={{
          height: "100%",
          width: "100%",
          overflow: "auto",
          bgcolor: "#FFFFFF",
          boxSizing: "border-box",
        }}
      >
        {loading && (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Typography color="error" sx={{ mb: 2, p: 2 }}>
            {error}
          </Typography>
        )}

        <div
          ref={containerRef}
          style={{
            transform: `scale(${(zoom ?? 100) / 100})`,
            transformOrigin: "top left",
          }}
        />
      </Box>

      {/* Page indicator overlay (parity with PDF viewer) */}
      {!loading && !error && numPages > 0 && (
        <Box
          sx={{
            position: "absolute",
            right: 20,
            bottom: 20,
            px: 2,
            py: 0.75,
            bgcolor: "#FFFFFF",
            borderRadius: 1,
            boxShadow: 2,
            zIndex: 30,
          }}
        >
          <Typography
            variant="body2"
            sx={{ fontWeight: 600 }}
          >
            Page {pageNumber} / {numPages}
          </Typography>
        </Box>
      )}

      {cropEnabled && (
        <Box
          sx={{
            position: "absolute",
            left: 20,
            top: 20,
            px: 1.5,
            py: 0.75,
            bgcolor: "rgba(255,255,255,0.95)",
            border: "1px solid #6a1b9a",
            borderRadius: 1,
            boxShadow: 1,
            zIndex: 30,
          }}
        >
          <Typography
            variant="caption"
            sx={{ color: "#6a1b9a", fontWeight: 600 }}
          >
            Crop Compare: drag a rectangle on the page to inspect that region.
          </Typography>
        </Box>
      )}

      {showMissingCoordinatesNotice && (
        <Box
          sx={{
            position: "absolute",
            left: 20,
            top: 20,
            px: 1.5,
            py: 0.75,
            bgcolor: "rgba(255,255,255,0.95)",
            border: "1px solid #e1b200",
            borderRadius: 1,
            boxShadow: 1,
            zIndex: 30,
          }}
        >
          <Typography
            variant="caption"
            sx={{ color: "#8a6d00", fontWeight: 600 }}
          >
            No coordinates available for this {side} difference.
          </Typography>
        </Box>
      )}
    </Box>
  );
}

