import { useMemo } from "react";

import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";

import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";

import { getSession } from "@/shared/utils/auth";

const PRIMARY = "#2A276E";
const ACCENT = "#703E97";
const BG = "#F5F6FA";

type AdminFeature = {
  title: string;
  description: string;
  icon: React.ReactNode;
};

const ADMIN_FEATURES: AdminFeature[] = [
  {
    title: "User Management",
    description:
      "Create, edit and manage tenant users, assign account types and control access.",
    icon: <PersonAddAltOutlinedIcon />,
  },
  {
    title: "Inspection Reports",
    description:
      "Review and manage inspection reports generated across the organisation.",
    icon: <AssessmentOutlinedIcon />,
  },
  {
    title: "Security & Access",
    description:
      "Configure authentication policies, password rules and session settings.",
    icon: <SecurityOutlinedIcon />,
  },
  {
    title: "System Settings",
    description:
      "Manage application-level configuration and inspection defaults.",
    icon: <SettingsOutlinedIcon />,
  },
  {
    title: "Data & Storage",
    description:
      "Monitor storage usage, retention policies and data management.",
    icon: <StorageOutlinedIcon />,
  },
  {
    title: "Tenant Administration",
    description:
      "Administer tenant-level settings, branding and organisation details.",
    icon: <AdminPanelSettingsOutlinedIcon />,
  },
];

export default function AdminPage() {
  const adminName = useMemo(() => {
    const user = getSession();
    if (!user?.name) return "Tenant Administrator";
    return user.name;
  }, []);

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 72px)",
        bgcolor: BG,
        py: 4,
        px: { xs: 2, md: 6 },
      }}
    >
      <Box sx={{ maxWidth: 1100, mx: "auto" }}>
        {/* Header */}
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: "center", mb: 0.5 }}
        >
          <AdminPanelSettingsOutlinedIcon
            sx={{ fontSize: 40, color: PRIMARY }}
          />
          <Typography variant="h4" sx={{ fontWeight: 700, color: "#1B1B1B" }}>
            Admin Features
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
          <Typography variant="body1" color="text.secondary">
            Manage the MedInspect tenant. Welcome back, {adminName}.
          </Typography>
          <Chip
            size="small"
            label="Tenant Admin"
            sx={{
              bgcolor: `${ACCENT}1A`,
              color: ACCENT,
              fontWeight: 700,
            }}
          />
        </Stack>

        {/* Feature grid */}
        <Box
          sx={{
            mt: 4,
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
              md: "1fr 1fr 1fr",
            },
            gap: 3,
          }}
        >
          {ADMIN_FEATURES.map((feature) => (
            <Card
              key={feature.title}
              elevation={0}
              sx={{
                borderRadius: 3,
                border: "1px solid #EAECEF",
                boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
                transition: "all .25s ease",
                cursor: "pointer",
                "&:hover": {
                  transform: "translateY(-4px)",
                  boxShadow: "0 10px 24px rgba(42,39,110,0.12)",
                  borderColor: "#D9C9EF",
                },
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: `${PRIMARY}14`,
                    color: PRIMARY,
                    mb: 2,
                  }}
                >
                  {feature.icon}
                </Box>

                <Typography sx={{ fontWeight: 700, color: "#1B1B1B" }}>
                  {feature.title}
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.75 }}
                >
                  {feature.description}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Box>
    </Box>
  );
}