import { Outlet } from "react-router-dom";

import { Box } from "@mui/material";

import Header from "./Header";

export default function MainLayout() {
  return (
    <Box>
      <Header />

      <Box>
        <Outlet />
      </Box>
    </Box>
  );
}