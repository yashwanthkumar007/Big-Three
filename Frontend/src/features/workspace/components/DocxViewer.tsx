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
  onInitialBlankPageChange?: (skipped: boolean) => void;
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

const findTextRange = (
  root: HTMLElement,
  searchText: string
): Range | null => {
  const needle = searchText.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (!needle) {
    return null;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const offsets: Array<{ node: Text; offset: number }> = [];
  let normalizedText = "";
  let lastWasSpace = false;
  let currentNode = walker.nextNode();

  while (currentNode) {
    const textNode = currentNode as Text;
    for (let offset = 0; offset < textNode.length; offset += 1) {
      const character = textNode.data[offset];
      if (/\s/.test(character)) {
        if (normalizedText && !lastWasSpace) {
          normalizedText += " ";
          offsets.push({ node: textNode, offset });
        }
        lastWasSpace = true;
        continue;
      }

      const foldedCharacter = character.toLocaleLowerCase();
      for (let index = 0; index < foldedCharacter.length; index += 1) {
        normalizedText += foldedCharacter[index];
        offsets.push({ node: textNode, offset });
      }
      lastWasSpace = false;
    }

    currentNode = walker.nextNode();
  }

  const start = normalizedText.indexOf(needle);
  if (start < 0) {
    return null;
  }

  const startPosition = offsets[start];
  const endPosition = offsets[start + needle.length - 1];
  if (!startPosition || !endPosition) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset + 1);
  return range;
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
  onInitialBlankPageChange,
  side = "master",
  selectedDifference,
  cropMode,
}: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(1);
  const pageSectionsRef = useRef<HTMLElement[]>([]);

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
        const firstPageIsBlank =
          sections.length > 1 &&
          !sections[0].textContent?.trim() &&
          !sections[0].querySelector("img, svg, canvas, table, video, iframe, object, embed");
        const pageSections = firstPageIsBlank
          ? sections.slice(1)
          : sections;
        pageSectionsRef.current = pageSections;

        pageSections.forEach((section, index) => {
          section.style.display = index === 0 ? "" : "none";
        });

        if (firstPageIsBlank) {
          sections[0].style.display = "none";
        }

        const count = Math.max(1, pageSections.length);
        setNumPages(count);
        onNumPagesChange?.(count);
        onInitialBlankPageChange?.(firstPageIsBlank);
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
  }, [file, onNumPagesChange, onInitialBlankPageChange]);

  // Toggle which page is visible when pageNumber changes.
  useEffect(() => {
    const container = containerRef.current;

    if (!container || loading) {
      return;
    }

    const sections = pageSectionsRef.current;

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

  useEffect(() => {
    if (loading || !selectedDifference) {
      return;
    }

    const page = pageSectionsRef.current[
      Math.max(0, Math.min(pageSectionsRef.current.length - 1, pageNumber - 1))
    ];
    const searchText =
      side === "master"
        ? selectedDifference.master
        : selectedDifference.sample;
    if (!page || !searchText.trim()) {
      return;
    }

    const range = findTextRange(page, searchText);
    if (!range) {
      return;
    }

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  }, [loading, pageNumber, selectedDifference, side]);

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
