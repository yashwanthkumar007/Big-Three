import { Box } from "@mui/material";
import { useEffect } from "react";

import UploadCard from "../components/UploadCard";
import { useUploadStore } from "@/store/uploadStore";

export default function TextInspectionPage() {
  const {
    clearAll,
    setInspectionType,
    setInspectionStatus,
  } = useUploadStore();

  useEffect(() => {
    // Clear any previous Text Inspection files/results
    // when entering the upload page.
    clearAll();

    // Reset inspection state.
    // Backend inspection will NOT start here.
    setInspectionStatus("idle");

    // Set the current inspection type.
    setInspectionType("text");
  }, [
    clearAll,
    setInspectionType,
    setInspectionStatus,
  ]);

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 72px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        pt: 6,
        bgcolor: "#FAFAFA",
      }}
    >
      <UploadCard
        title="Text Inspection"
        inspectionType="text"
      />
    </Box>
  );
}