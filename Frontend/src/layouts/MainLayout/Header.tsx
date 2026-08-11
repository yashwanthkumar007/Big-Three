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
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";

import BarcodeIcon from "./BarcodeIcon";
import BrailleDotsIcon from "./BrailleDotsIcon";

import OrganizationLogo from "@/assets/logos/viatris logo.png";

type User = {
  id: number;
  name: string;
  email: string;
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

  const modules = [
    {
      name: "Text Inspection",
      icon: <DescriptionOutlinedIcon />,
      route: "/workspace/text/upload"
    },
    {
      name: "Graphics Inspection",
      icon: <ExtensionOutlinedIcon />,
      route: "/workspace/graphics"
    },
    {
      name: "Spelling Inspection",
      icon: <SpellcheckOutlinedIcon />,
      route: "/workspace/spelling"
    },
    {
      name: "Braille Inspection",
      icon: <BrailleDotsIcon />,
      route: "/workspace/braille"
    },
    {
      name: "Barcode Inspection",
      icon: <BarcodeIcon size={22} />,
      route: "/workspace/barcode"
    },
    {
      name: "Notes Inspection",
      icon: <StickyNote2OutlinedIcon />,
      route: "/workspace/notes"
    }
  ];

  const handleLogout = () => {
    localStorage.removeItem("user");
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
          spacing={2}
          sx={{ alignItems: "center" }}
        >
          <Box
            component="img"
            src={OrganizationLogo}
            alt="Logo"
            sx={{ height: 42 }}
          />

          <Typography
         variant="h6"
         onClick={() => navigate("/dashboard")}
         sx={{
             fontWeight: 700,
             color: "white",
             cursor: "pointer",
             userSelect: "none",
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
                  title={module.name}
                  arrow
                >
                  <IconButton
                    onClick={() => navigate(module.route)}
                    sx={{
                      color: "white",
                      borderRadius: 2,
                      transition: "all .25s ease",
                      bgcolor: isActive
                        ? "#703E97"
                        : "transparent",

                      "&:hover": {
                        bgcolor: "#703E97",
                        transform: "translateY(-2px)"
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

          {/* Profile */}
          <Tooltip title="Profile">
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

          {/* FAQ */}
          <Tooltip title="FAQ">
            <IconButton
              onClick={() => navigate("/faq")}
              sx={{
                color: "white",
                borderRadius: 2,
                transition: "all .25s ease",

                bgcolor:
                  location.pathname === "/faq"
                    ? "#703E97"
                    : "transparent",

                "&:hover": {
                  bgcolor: "#703E97",
                  transform: "translateY(-2px)"
                }
              }}
            >
              <HelpOutlineOutlinedIcon />
            </IconButton>
          </Tooltip>

          {/* Logout */}
          <Tooltip title="Logout">
            <IconButton
              onClick={handleLogout}
              sx={{
                color: "white",
                borderRadius: 2,
                transition: "all .25s ease",

                "&:hover": {
                  bgcolor: "#703E97",
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