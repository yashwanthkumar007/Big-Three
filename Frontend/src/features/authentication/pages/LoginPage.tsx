import { Box, Card } from "@mui/material";

import LoginFooter from "../components/LoginFooter";
import LoginForm from "../components/LoginForm";
import LoginHeader from "../components/LoginHeader";

export default function LoginPage() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#181A22",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        p: 4
      }}
    >
      <Card
        sx={{
          width: { xs: '100%', md: '55%' },
          maxWidth: 420,
          p: { xs: 1.25, md: 1.5 },
          borderRadius: 2,
        }}
      >
        <LoginHeader />

        <LoginForm />

        <LoginFooter />
      </Card>
    </Box>
  );
}