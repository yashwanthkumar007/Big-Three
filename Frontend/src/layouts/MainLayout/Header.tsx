import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  AppBar,
  Avatar,
  Box,
  Button,
  IconButton,
  Stack,
  Toolbar,
  Tooltip,
  Typography
} from "@mui/material";

import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import SpellcheckOutlinedIcon from "@mui/icons-material/SpellcheckOutlined";
import StickyNote2OutlinedIcon from "@mui/icons-material/StickyNote2Outlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";

import BarcodeIcon from "./BarcodeIcon";
import BrailleDotsIcon from "./BrailleDotsIcon";

import OrganizationLogo from "@/assets/logos/icon.png";
import { clearSession, isTenantAdmin } from "@/shared/utils/auth";
import { logout as logoutServerSession } from "@/features/authentication/services/authservice";

type User = {
  id: number;
  name: string;
  email: string;
  accountType?: string;
};

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();

  const username = useMemo(() => {
    const userStr = localStorage.getItem("user");

    if (userStr) {
      try {
        const user: User = JSON.parse(userStr);
        const emailUsername = user.email.split("@")[0];

        return (
          emailUsername.charAt(0).toUpperCase() +
          emailUsername.slice(1)
        );
      } catch (error) {
        console.error("Failed to parse user data:", error);
      }
    }

    return "User";
  }, []);

  // Only Tenant Admins see the Admin (gear) shortcut in the navbar.
  // Re-evaluated on every render (route changes re-render via useLocation),
  // so an account-type change (user → Administrator) shows the gear without
  // needing a code reload.
  const isAdmin = isTenantAdmin();

  const modules = [
    {
      name: "Text Inspection",
      icon: <DescriptionOutlinedIcon />,
      route: "/workspace/text/upload",
      // Only Text Inspection is implemented; every other module is a
      // "Coming Soon" placeholder — visible, clickable, but never navigates.
      available: true
    },
    {
      name: "Graphics Inspection",
      icon: <ExtensionOutlinedIcon />,
      route: "/workspace/graphics",
      available: false
    },
    {
      name: "Spelling Inspection",
      icon: <SpellcheckOutlinedIcon />,
      route: "/workspace/spelling",
      available: false
    },
    {
      name: "Braille Inspection",
      icon: <BrailleDotsIcon />,
      route: "/workspace/braille/upload",
      available: true
    },
    {
      name: "Barcode Inspection",
      icon: <BarcodeIcon size={22} />,
      // Matches the route registered in routes/index.tsx ("barcode/upload").
      route: "/workspace/barcode/upload",
      available: true
    },
    {
      name: "Notes Inspection",
      icon: <StickyNote2OutlinedIcon />,
      route: "/workspace/notes",
      available: false
    }
  ];

  const handleLogout = () => {
    // Delete the server-side session record first (best-effort) so this
    // login no longer appears under Logged-in Users, then clear locally.
    // Reason "user" records an intentional LOGOUT event in the audit trail.
    void logoutServerSession("user");
    clearSession();
    navigate("/login");
  };

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        background: "#2A276E",
        borderBottom: "1px solid #1B1B1B"
      }}
    >
      <Toolbar sx={{ height: 72 }}>
        {/* Left Section */}
        <Stack
          direction="row"
          spacing={0}
          sx={{ alignItems: "center" }}
        >
          <Box
            component="img"
            src={OrganizationLogo}
            alt="Logo"
            sx={{ height: 42,
               borderRadius: 4.5,
            }}
          />

          <Typography
         variant="h6"
         onClick={() => navigate("/dashboard")}
         sx={{
             fontWeight: 700,
             color: "white",
             cursor: "pointer",
             userSelect: "none",
             ml: 1,
             transition: "opacity .2s ease",

             "&:hover": {
              opacity: 0.8
           }
     }}
       >
  MedInspect
</Typography>

          {/* Module Icons */}
          <Stack
            direction="row"
            spacing={1}
            sx={{ ml: 2 }}
          >
            {modules.map((module) => {
              const isActive = location.pathname === module.route;

              return (
                <Tooltip
                  key={module.name}
                  // Unavailable modules show the inspection name with a
                  // "Coming Soon" note underneath on hover.
                  title={
                    module.available ? (
                      module.name
                    ) : (
                      <Box>
                        <Typography
                          sx={{ color: "inherit", fontSize: "0.875rem", fontWeight: 600 }}
                        >
                          {module.name}
                        </Typography>
                        <Typography
                          sx={{ color: "rgba(255,255,255,0.75)", fontSize: "0.75rem" }}
                        >
                          Coming Soon
                        </Typography>
                      </Box>
                    )
                  }
                  arrow
                  slotProps={{
                    tooltip: {
                      // Brand navy tooltip background (default MUI grey replaced).
                      sx: {
                        bgcolor: "#2A276E",
                        color: "#ffffff",
                        maxWidth: 240,
                        border: "1px solid rgba(255,255,255,0.25)",
                        "& .MuiTooltip-arrow": {
                          color: "#2A276E"
                        }
                      }
                    }
                  }}
                >
                  <IconButton
                    // Coming Soon modules stay clickable (so the hover tooltip
                    // fires) but NEVER navigate anywhere.
                    onClick={() => {
                      if (module.available) {
                        navigate(module.route);
                      }
                    }}
                    sx={{
                      borderRadius: 2,
                      transition: "all .25s ease",
                      cursor: module.available ? "pointer" : "default",

                      color: module.available
                        ? "white"
                        : "rgba(255,255,255,0.4)",

                      bgcolor: isActive
                        ? "#703E97"
                        : "transparent",

                      "&:hover": module.available
                        ? {
                            bgcolor: "#703E97",
                            transform: "translateY(-2px)"
                          }
                        : {
                            // Brand purple hover — same accent as the active
                            // module, just without the lift effect.
                            bgcolor: "#703E97"
                          }
                    }}
                  >
                    {module.icon}
                  </IconButton>
                </Tooltip>
              );
            })}
          </Stack>
        </Stack>

        <Box sx={{ flexGrow: 1 }} />

        {/* Right Section */}
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center" }}
        >
          <Avatar
            sx={{
              bgcolor: "#703E97"
            }}
          >
            {username.charAt(0).toUpperCase()}
          </Avatar>

          {/* Profile — clicking navigates directly to profile page */}
          <Tooltip
            title="My Profile"
            slotProps={{
              tooltip: {
                sx: { bgcolor: "#2A276E", color: "#FFFFFF", fontWeight: 600 }
              },
              arrow: { sx: { color: "#2A276E" } }
            }}
          >
            <Button
              onClick={() => navigate("/profile")}
              sx={{
                color: "white",
                textTransform: "none",
                fontWeight: 600,
                fontSize: "1rem",
                px: 1.5,
                py: 0.75,
                minWidth: "auto",
                borderRadius: 2,
                transition: "all .25s ease",

                bgcolor:
                  location.pathname === "/profile"
                    ? "#703E97"
                    : "transparent",

                "&:hover": {
                  bgcolor: "#703E97",
                  transform: "translateY(-2px)"
                }
              }}
            >
              {username}
            </Button>
          </Tooltip>

          {/* Admin (gear) shortcut — only visible to Tenant admin accounts,
              shown after the admin name */}
          {isAdmin && (
            <Tooltip
              title="System Setup"
              slotProps={{
                tooltip: {
                  sx: { bgcolor: "#2A276E", color: "#FFFFFF", fontWeight: 600 }
                },
                arrow: { sx: { color: "#2A276E" } }
              }}
            >
              <IconButton
                onClick={() => navigate("/settings/system")}
                sx={{
                  color: "white",
                  borderRadius: 2,
                  transition: "all .25s ease",

                  bgcolor:
                    location.pathname.startsWith("/settings") || location.pathname.startsWith("/admin")
                      ? "#703E97"
                      : "transparent",

                  "&:hover": {
                    bgcolor: "#703E97",
                    transform: "translateY(-2px)"
                  }
                }}
              >
                <SettingsOutlinedIcon />
              </IconButton>
            </Tooltip>
          )}

          {/* FAQ */}
          <Tooltip
            title="FAQ"
            slotProps={{
              tooltip: {
                sx: {
                  bgcolor: "rgba(42, 39, 110, 0.92)",
                  color: "#FFFFFF",
                  fontWeight: 600,
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  border: "1px solid rgba(255, 255, 255, 0.25)",
                },
              },
              arrow: { sx: { color: "#2A276E" } },
            }}
          >
            <IconButton
              onClick={() => navigate("/faq")}
              sx={{
                color: "white",
                borderRadius: 2,
                transition: "all .25s ease",

                bgcolor:
                  location.pathname === "/faq"
                    ? "#2A276E"
                    : "transparent",

                "&:hover": {
                  bgcolor: "#2A276E",
                  color: "#FFFFFF",
                  transform: "translateY(-2px)"
                }
              }}
            >
              <HelpOutlineOutlinedIcon />
            </IconButton>
          </Tooltip>

          {/* Logout */}
          <Tooltip
            title="Logout"
            slotProps={{
              tooltip: {
                sx: {
                  bgcolor: "rgba(42, 39, 110, 0.92)",
                  color: "#FFFFFF",
                  fontWeight: 600,
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  border: "1px solid rgba(255, 255, 255, 0.25)",
                },
              },
              arrow: { sx: { color: "#2A276E" } },
            }}
          >
            <IconButton
              onClick={handleLogout}
              sx={{
                color: "white",
                borderRadius: 2,
                transition: "all .25s ease",

                "&:hover": {
                  bgcolor: "#2A276E",
                  color: "#FFFFFF",
                  transform: "translateY(-2px)"
                }
              }}
            >
              <LogoutOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}