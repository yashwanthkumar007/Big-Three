import { Box, Typography } from "@mui/material";

import OrganizationLogo from "@/assets/logos/viatris logo.png";

export default function LoginHeader() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        mb: 2.5,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 1,
        }}
      >
        <Box
          component="img"
          src={OrganizationLogo}
          alt="Organization Logo"
          sx={{
            height: 70,
          }}
        />

        <Typography
          variant="h5"
          sx={{ fontWeight: 800, color: '#070443', fontSize: '1.4rem' }}
        >
          MedInspect
        </Typography>
      </Box>

      <Typography
        variant="h5"
        sx={{ fontWeight: 700, color: '#2A276E', fontSize: '1.4rem' }}
      >
        Login
      </Typography>
    </Box>
  );
}