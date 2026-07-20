import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  InputAdornment,
  IconButton,
} from "@mui/material";
import { Visibility, VisibilityOff, Monitor } from "@mui/icons-material";
import { useAuth } from "../hooks/useAuth";

export default function LoginPage() {
  const { login, isAuthenticated, error: authError, clearError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    return () => clearError();
  }, [clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch {
      setLocalError(authError || "Login failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated) return null;

  const displayError = localError || authError;

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        background: "linear-gradient(135deg, #020617 0%, #0F172A 50%, #020617 100%)",
        position: "relative",
        overflow: "hidden",
        "&::before": {
          content: '""',
          position: "absolute",
          top: "-50%",
          left: "-50%",
          width: "200%",
          height: "200%",
          background: "radial-gradient(circle at 30% 50%, rgba(34, 197, 94, 0.03) 0%, transparent 50%)",
          pointerEvents: "none",
        },
      }}
    >
      <Box
        sx={{
          flex: 1,
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          p: 8,
          position: "relative",
        }}
      >
        <Box sx={{ maxWidth: 480 }}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 3,
              background: "linear-gradient(135deg, #22C55E 0%, #3B82F6 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mb: 4,
            }}
          >
            <Monitor sx={{ fontSize: 24, color: "white" }} />
          </Box>
          <Typography
            variant="h2"
            sx={{
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              mb: 2,
            }}
          >
            Remote
            <br />
            Monitoring
            <br />
            Platform
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 380, lineHeight: 1.7 }}>
            Enterprise-grade device monitoring and management. Monitor, control, and secure your corporate endpoints from a single dashboard.
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 4,
          position: "relative",
        }}
      >
        <Card
          sx={{
            width: "100%",
            maxWidth: 420,
            border: "1px solid",
            borderColor: "divider",
            boxShadow: "0 20px 60px -15px rgba(0, 0, 0, 0.3)",
          }}
        >
          <CardContent sx={{ p: 5 }}>
            <Box sx={{ display: { xs: "flex", md: "none" }, alignItems: "center", gap: 1.5, mb: 4 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 2,
                  background: "linear-gradient(135deg, #22C55E 0%, #3B82F6 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Monitor sx={{ fontSize: 18, color: "white" }} />
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                RemoteMonitor
              </Typography>
            </Box>

            <Typography variant="h5" sx={{ fontWeight: 600, mb: 0.5 }}>
              Welcome back
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Sign in to your admin account
            </Typography>

            {displayError && (
              <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>
                {displayError}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth
                label="Password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                sx={{ mb: 3 }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                        size="small"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
                sx={{
                  py: 1.5,
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                }}
              >
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
