import { Box, Typography } from "@mui/material";
import { truncateFileName } from "@/shared/utils/truncateFileName";

type WorkspaceToolbarProps = {
  masterFileName: string;
  sampleFileName: string;
  differenceCount: number;
};

export default function WorkspaceToolbar({
  masterFileName,
  sampleFileName,
  differenceCount,
}: WorkspaceToolbarProps) {
  return (
    <Box
      sx={{
        width: "100%",
        px: 3,
        py: 2,
        bgcolor: "#ffffff",
        borderBottom: "1px solid #E5E7EB",
        display: "flex",
        alignItems: "center",
        gap: 3,
      }}
    >
      <Box
        sx={{
          height: 34,
          px: 1.2,
          display: "flex",
          alignItems: "center",

          // Flat solid dark-blue count badge (no glassmorphism)
          borderRadius: 2,
          border: "1px solid #1B1B4B",
          bgcolor: "#2A276E",
          boxShadow: "0 2px 6px rgba(27, 27, 60, 0.25)",
          transition: "all .25s ease",

          "&:hover": {
            bgcolor: "#232058",
            boxShadow: "0 4px 12px rgba(27, 27, 60, 0.35)",
            transform: "translateY(-1px)",
          },
        }}
      >
        <Typography
          sx={{
            fontSize: 15,
            fontWeight: 700,
            color: "#FFFFFF",
            textShadow: "0 1px 2px rgba(0, 0, 0, 0.35)",
            letterSpacing: 0.3,
          }}
        >
          {differenceCount}{" "}
          {differenceCount === 1 ? "Difference" : "Differences"}
        </Typography>
      </Box>

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <Typography
          variant="body2"
          sx={{ fontWeight: 700, color: "text.secondary" }}
        >
          Master
        </Typography>
        <Typography
          variant="body2"
          noWrap
          title={masterFileName}
          sx={{
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {truncateFileName(masterFileName)}
        </Typography>
      </Box>

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <Typography
          variant="body2"
          sx={{ fontWeight: 700, color: "text.secondary" }}
        >
          Sample
        </Typography>
        <Typography
          variant="body2"
          noWrap
          title={sampleFileName}
          sx={{
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {truncateFileName(sampleFileName)}
        </Typography>
      </Box>
    </Box>
  );
}