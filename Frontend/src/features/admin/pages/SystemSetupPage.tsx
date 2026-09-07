import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Typography,
} from "@mui/material";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import PersonSearchOutlinedIcon from "@mui/icons-material/PersonSearchOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import CommentOutlinedIcon from "@mui/icons-material/CommentOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import TextFieldsOutlinedIcon from "@mui/icons-material/TextFieldsOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import QrCode2OutlinedIcon from "@mui/icons-material/QrCode2Outlined";
import ChevronRightOutlinedIcon from "@mui/icons-material/ChevronRightOutlined";

import { getSystemInformation, type SystemInformation } from "../systemApi";

const BRAND_NAVY = "#2A276E";
const BRAND_PURPLE = "#703E97";

function AdminNavItem({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: "pointer",
        border: "1px solid #E0E0E6",
        boxShadow: "none",
        transition: "all .2s ease",
        "&:hover": { borderColor: BRAND_PURPLE, boxShadow: "0 2px 10px rgba(112,62,151,.15)" },
      }}
    >
      <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: 2, "&:last-child": { pb: 2 } }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "#F1EFFA",
            color: BRAND_PURPLE,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, color: BRAND_NAVY }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {description}
          </Typography>
        </Box>
        <ChevronRightOutlinedIcon sx={{ color: "#9CA3AF" }} />
      </CardContent>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="subtitle2"
      sx={{
        fontWeight: 700,
        color: BRAND_NAVY,
        textTransform: "uppercase",
        letterSpacing: ".05em",
        mb: 1.5,
        pb: 1,
        borderBottom: "2px solid " + BRAND_PURPLE,
        display: "inline-block",
      }}
    >
      {children}
    </Typography>
  );
}

export default function SystemSetupPage() {
  const navigate = useNavigate();
  const [info, setInfo] = useState<SystemInformation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSystemInformation()
      .then(setInfo)
      .catch((err: Error) => setError(err.message));
  }, []);

  const infoRows = info
    ? ([
        ["Application Version:", info.applicationVersion],
        ["Company Name:", info.companyName],
        ["License Type:", info.licenseType],
        ["Number of Users:", String(info.numberOfUsers)],
        ["SSO Enabled:", info.ssoEnabled ? "Yes" : "No"],
        ["REST API Authentication:", info.restApiAuthenticationType],
      ] as Array<[string, string]>)
    : [];

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h4" sx={{ fontWeight: 700, color: BRAND_NAVY, mb: 3 }}>
        System Setup
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.1fr) minmax(0, 2fr)" }, gap: 3 }}>
        <Box>
          <SectionTitle>MedInspect Information</SectionTitle>
          <Card sx={{ border: "1px solid #E0E0E6", boxShadow: "none" }}>
            <CardContent>
              {!info && !error ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : (
                infoRows.map(([label, value]) => (
                  <Box key={label} sx={{ display: "flex", alignItems: "center", py: 0.75 }}>
                    <Typography variant="body2" sx={{ width: 240, color: "#6B7280" }}>
                      {label}
                    </Typography>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {value}
                      </Typography>
                    </Box>
                  </Box>
                ))
              )}
            </CardContent>
          </Card>
        </Box>

        <Box>
          <SectionTitle>Account Maintenance</SectionTitle>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 2, mb: 3 }}>
            <AdminNavItem
              title="User Management"
              description="Add, edit, disable and delete users"
              icon={<GroupOutlinedIcon />}
              onClick={() => navigate("/settings/users")}
            />
            <AdminNavItem
              title="Logged-in Users"
              description="View and terminate active sessions"
              icon={<PersonSearchOutlinedIcon />}
              onClick={() => navigate("/settings/logged-in-users")}
            />
          </Box>

          <SectionTitle>Audit Trail</SectionTitle>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 2, mb: 3 }}>
            <AdminNavItem
              title="View Audit Trail"
              description="Immutable record of all actions"
              icon={<HistoryOutlinedIcon />}
              onClick={() => navigate("/settings/audit-trail")}
            />
          </Box>

          <SectionTitle>App Options</SectionTitle>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 2, mb: 3 }}>
            <AdminNavItem
              title="Setup Levels and Comments"
              description="Inspection severity levels and reviewer comments"
              icon={<CommentOutlinedIcon />}
              onClick={() => navigate("/settings/levels-comments")}
            />
            <AdminNavItem
              title="Setup User Dictionary"
              description="Custom words ignored by spelling inspection"
              icon={<MenuBookOutlinedIcon />}
              onClick={() => navigate("/settings/user-dictionary")}
            />
          </Box>

          <SectionTitle>Manage Profiles</SectionTitle>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 2 }}>
            <AdminNavItem
              title="Custom Text Profiles"
              description="Text inspection configuration"
              icon={<TextFieldsOutlinedIcon />}
              onClick={() => navigate("/settings/profiles/text")}
            />
            <AdminNavItem
              title="Custom Graphics Profiles"
              description="Graphics inspection configuration"
              icon={<ImageOutlinedIcon />}
              onClick={() => navigate("/settings/profiles/graphics")}
            />
            <AdminNavItem
              title="Custom Barcode Profiles"
              description="Barcode inspection configuration"
              icon={<QrCode2OutlinedIcon />}
              onClick={() => navigate("/settings/profiles/barcode")}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
