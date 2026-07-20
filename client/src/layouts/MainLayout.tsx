import { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  Typography,
  Tooltip,
} from "@mui/material";
import {
  Menu as MenuIcon,
  Dashboard,
  Computer,
  People,
  PhotoCamera,
  Assessment,
  Logout,
  Person,
  Circle,
} from "@mui/icons-material";
import { useAuth } from "../hooks/useAuth";
import { getAdminSocket } from "../services/websocket";

const DRAWER_WIDTH = 240;

const menuItems = [
  { text: "Dashboard", icon: <Dashboard fontSize="small" />, path: "/" },
  { text: "Devices", icon: <Computer fontSize="small" />, path: "/devices" },
  { text: "Screenshots", icon: <PhotoCamera fontSize="small" />, path: "/screenshots" },
  { text: "Users", icon: <People fontSize="small" />, path: "/users" },
  { text: "Audit Log", icon: <Assessment fontSize="small" />, path: "/audit" },
];

function isSelected(path: string, pathname: string) {
  if (path === "/") return pathname === "/";
  return pathname.startsWith(path);
}

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [onlineDevices, setOnlineDevices] = useState(0);
  const [socketConnected, setSocketConnected] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) return;

    const socket = getAdminSocket(token);

    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("device-status", (data: { deviceId: string; status: string }) => {
      if (data.status === "ONLINE") {
        setOnlineDevices((prev) => prev + 1);
      } else {
        setOnlineDevices((prev) => Math.max(0, prev - 1));
      }
    });

    if (socket.connected) setSocketConnected(true);

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("device-status");
    };
  }, []);

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ p: 2.5, pb: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 2,
              background: "linear-gradient(135deg, #22C55E 0%, #3B82F6 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Circle sx={{ fontSize: 16, color: "white" }} />
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, letterSpacing: "-0.01em" }}>
            RemoteMonitor
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ borderColor: "divider" }} />

      <List sx={{ px: 1.5, py: 1, flex: 1 }}>
        {menuItems.map((item) => {
          const active = isSelected(item.path, location.pathname);
          return (
            <ListItemButton
              key={item.path}
              selected={active}
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                px: 1.5,
                py: 1,
                "&.Mui-selected": {
                  backgroundColor: "rgba(34, 197, 94, 0.08)",
                  "&:hover": { backgroundColor: "rgba(34, 197, 94, 0.12)" },
                },
                "&:hover": {
                  backgroundColor: "rgba(255, 255, 255, 0.04)",
                },
              }}
            >
              <ListItemIcon
                sx={{
                  color: active ? "primary.main" : "text.secondary",
                  minWidth: 36,
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                primaryTypographyProps={{
                  fontSize: "0.875rem",
                  fontWeight: active ? 600 : 400,
                  color: active ? "text.primary" : "text.secondary",
                }}
              />
            </ListItemButton>
          );
        })}
      </List>

      <Divider sx={{ borderColor: "divider" }} />
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: socketConnected ? "success.main" : "error.main",
              boxShadow: socketConnected ? "0 0 8px rgba(34, 197, 94, 0.4)" : "none",
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {socketConnected ? "Connected" : "Disconnected"}
          </Typography>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { sm: `${DRAWER_WIDTH}px` },
          backgroundColor: "background.paper",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ minHeight: "56px !important" }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileOpen(!mobileOpen)}
            sx={{ display: { sm: "none" }, mr: 1 }}
            aria-label="Toggle navigation menu"
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{ flexGrow: 1 }} />

          <Tooltip title={`${onlineDevices} devices online`}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mr: 2, px: 1.5, py: 0.5, borderRadius: 2, backgroundColor: "rgba(34, 197, 94, 0.06)" }}>
              <Circle sx={{ fontSize: 8, color: "success.main" }} />
              <Typography variant="caption" sx={{ fontWeight: 500, color: "success.light" }}>
                {onlineDevices}
              </Typography>
            </Box>
          </Tooltip>

          <IconButton
            onClick={(e) => setAnchorEl(e.currentTarget)}
            aria-label="User menu"
            aria-haspopup="true"
          >
            <Avatar
              sx={{
                bgcolor: "primary.main",
                color: "background.default",
                width: 34,
                height: 34,
                fontSize: "0.875rem",
                fontWeight: 600,
              }}
            >
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </Avatar>
          </IconButton>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
            transformOrigin={{ horizontal: "right", vertical: "top" }}
            anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
            slotProps={{
              paper: {
                sx: {
                  mt: 1,
                  minWidth: 180,
                  borderRadius: 2,
                  border: "1px solid",
                  borderColor: "divider",
                },
              },
            }}
          >
            <MenuItem disabled sx={{ opacity: 0.7 }}>
              <Person sx={{ mr: 1, fontSize: 18 }} />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {user?.firstName} {user?.lastName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user?.email}
                </Typography>
              </Box>
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <Logout sx={{ mr: 1, fontSize: 18 }} />
              <Typography variant="body2">Logout</Typography>
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { sm: DRAWER_WIDTH }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{
            display: { xs: "block", sm: "none" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: DRAWER_WIDTH,
              backgroundColor: "background.paper",
              borderRight: "1px solid",
              borderColor: "divider",
            },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: "none", sm: "block" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: DRAWER_WIDTH,
              backgroundColor: "background.paper",
              borderRight: "1px solid",
              borderColor: "divider",
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: "56px",
          minHeight: "calc(100dvh - 56px)",
          backgroundColor: "background.default",
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
