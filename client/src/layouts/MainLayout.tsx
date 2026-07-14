import { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Typography,
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
  Badge,
  Divider,
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
  Notifications,
} from "@mui/icons-material";
import { useAuth } from "../hooks/useAuth";
import { getAdminSocket } from "../services/websocket";

const DRAWER_WIDTH = 260;

const menuItems = [
  { text: "Dashboard", icon: <Dashboard />, path: "/" },
  { text: "Devices", icon: <Computer />, path: "/devices" },
  { text: "Screenshots", icon: <PhotoCamera />, path: "/screenshots" },
  { text: "Users", icon: <People />, path: "/users" },
  { text: "Audit Log", icon: <Assessment />, path: "/audit" },
];

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [onlineDevices, setOnlineDevices] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) return;

    const socket = getAdminSocket(token);

    socket.on("device-status", (data: { deviceId: string; status: string }) => {
      if (data.status === "ONLINE") {
        setOnlineDevices((prev) => prev + 1);
      } else {
        setOnlineDevices((prev) => Math.max(0, prev - 1));
      }
    });

    return () => {
      socket.off("device-status");
    };
  }, []);

  const drawer = (
    <Box>
      <Box sx={{ p: 2, textAlign: "center" }}>
        <Typography variant="h6" fontWeight="bold" color="primary">
          RemoteMonitor
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Enterprise Platform
        </Typography>
      </Box>
      <Divider />
      <List sx={{ px: 1 }}>
        {menuItems.map((item) => (
          <ListItemButton
            key={item.path}
            selected={location.pathname === item.path}
            onClick={() => {
              navigate(item.path);
              setMobileOpen(false);
            }}
            sx={{
              borderRadius: 1,
              mb: 0.5,
              "&.Mui-selected": {
                backgroundColor: "primary.main",
                "&:hover": { backgroundColor: "primary.dark" },
              },
            }}
          >
            <ListItemIcon
              sx={{
                color: location.pathname === item.path ? "white" : "text.secondary",
                minWidth: 40,
              }}
            >
              {item.icon}
            </ListItemIcon>
            <ListItemText
              primary={item.text}
              primaryTypographyProps={{
                fontWeight: location.pathname === item.path ? "bold" : "normal",
                color: location.pathname === item.path ? "white" : "text.primary",
              }}
            />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex" }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { sm: `${DRAWER_WIDTH}px` },
          backgroundColor: "#132f4c",
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileOpen(!mobileOpen)}
            sx={{ display: { sm: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}></Typography>
          <Badge badgeContent={onlineDevices} color="success" sx={{ mr: 2 }}>
            <Notifications />
          </Badge>
          <IconButton onClick={(e) => setAnchorEl(e.currentTarget)}>
            <Avatar sx={{ bgcolor: "primary.main", width: 36, height: 36 }}>
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
          >
            <MenuItem disabled>
              <Person sx={{ mr: 1 }} /> {user?.firstName} {user?.lastName}
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <Logout sx={{ mr: 1 }} /> Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: DRAWER_WIDTH }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{
            display: { xs: "block", sm: "none" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: DRAWER_WIDTH,
              backgroundColor: "#0a1929",
              borderRight: "1px solid rgba(255,255,255,0.08)",
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
              backgroundColor: "#0a1929",
              borderRight: "1px solid rgba(255,255,255,0.08)",
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
          mt: "64px",
          minHeight: "calc(100vh - 64px)",
          backgroundColor: "#0a1929",
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
