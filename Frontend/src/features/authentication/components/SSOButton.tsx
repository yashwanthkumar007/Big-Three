import { Button } from "@mui/material";

export default function SSOButton() {
  return (
    <Button
      fullWidth
      variant="contained"
      sx={{
        bgcolor: "#000",
        py: 1.5,
        "&:hover": {
          bgcolor: "#222"
        }
      }}
    >
      SSO Login
    </Button>
  );
}