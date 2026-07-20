import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import LoadingSpinner from "./components/LoadingSpinner";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import DevicesPage from "./pages/DevicesPage";
import DeviceDetailPage from "./pages/DeviceDetailPage";
import UsersPage from "./pages/UsersPage";
import AuditPage from "./pages/AuditPage";
import ScreenshotsPage from "./pages/ScreenshotsPage";
import MainLayout from "./layouts/MainLayout";
import { Box, Typography, Button } from "@mui/material";
import { Link } from "react-router-dom";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <LoadingSpinner fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" />;
  return <>{children}</>;
}

function NotFoundPage() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        textAlign: "center",
        p: 4,
      }}
    >
      <Typography variant="h1" sx={{ fontSize: "6rem", fontWeight: 700, color: "text.secondary", lineHeight: 1 }}>
        404
      </Typography>
      <Typography variant="h6" sx={{ mb: 1, color: "text.primary" }}>
        Page not found
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        The page you are looking for does not exist or has been moved.
      </Typography>
      <Button component={Link} to="/" variant="contained">
        Back to Dashboard
      </Button>
    </Box>
  );
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="devices/:id" element={<DeviceDetailPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="screenshots" element={<ScreenshotsPage />} />
          <Route path="audit" element={<AuditPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
