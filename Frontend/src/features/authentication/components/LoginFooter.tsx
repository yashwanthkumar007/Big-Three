import { Box, Divider, Link, Typography } from "@mui/material";

import SSOButton from "./SSOButton";

export default function LoginFooter() {
  return (
    <>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          mt: 1,
          alignItems: 'center',
        }}
      >
        <Typography
          variant="body2"
          sx={{ fontSize: '0.875rem' }}
        >
          <Link
            href="#"
            underline="hover"
            color="#2A276E"
          >
            Forgot Password?
          </Link>
        </Typography>

        <Typography
          variant="body2"
          sx={{ fontSize: '0.875rem' }}
        >
          Don't have an account?{" "}
          <Link
            href="#"
            underline="hover"
            color="#2A276E"
          >
            Sign Up
          </Link>
        </Typography>
      </Box>

      <Divider sx={{ my: 4 }}>
        <Typography sx={{ fontWeight: 700 }}>OR</Typography>
      </Divider>

      <SSOButton />
    </>
  );
}