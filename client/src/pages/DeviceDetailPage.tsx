import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  Tabs,
  Tab,
  Snackbar,
  Alert,
  IconButton,
  Tooltip,
} from "@mui/material";
import { CameraAlt, Refresh, ArrowBack, Visibility } from "@mui/icons-material";
import { devicesAPI, commandsAPI, screenshotsAPI, Device, Command, Screenshot } from "../services/api";
import StatusBadge from "../components/StatusBadge";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [screenshotDialog, setScreenshotDialog] = useState(false);
  const [screenshotReason, setScreenshotReason] = useState("");
  const [requestingScreenshot, setRequestingScreenshot] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });

  const loadDevice = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await devicesAPI.get(id);
      setDevice(data);
      const [cmdRes, ssRes] = await Promise.all([
        commandsAPI.listByDevice(id),
        screenshotsAPI.listByDevice(id),
      ]);
      setCommands(cmdRes.data.commands || []);
      setScreenshots(ssRes.data.screenshots || []);
    } catch {
      setError("Device not found or failed to load.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDevice();
  }, [loadDevice]);

  const handleScreenshot = async () => {
    if (!id) return;
    setRequestingScreenshot(true);
    try {
      await screenshotsAPI.request(id, screenshotReason);
      setScreenshotDialog(false);
      setScreenshotReason("");
      setSnackbar({ open: true, message: "Screenshot requested successfully", severity: "success" });
      loadDevice();
    } catch {
      setSnackbar({ open: true, message: "Failed to request screenshot", severity: "error" });
    } finally {
      setRequestingScreenshot(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress size={32} sx={{ color: "primary.main" }} />
      </Box>
    );
  }

  if (error || !device) {
    return <ErrorState message={error || "Device not found"} onRetry={loadDevice} />;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton onClick={() => navigate("/devices")} size="small" aria-label="Back to devices">
          <ArrowBack fontSize="small" />
        </IconButton>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600, letterSpacing: "-0.02em" }}>
            {device.hostname}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 0.5 }}>
            <StatusBadge status={device.status.toLowerCase() as "online" | "offline"} size="medium" />
            <Typography variant="body2" color="text.secondary">
              {device.operatingSystem} {device.osVersion || ""}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "text.secondary", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.05em" }}>
                Device Information
              </Typography>
              <Grid container spacing={2.5}>
                {[
                  { label: "IP Address", value: device.ipAddress },
                  { label: "Platform", value: device.platform || "-" },
                  { label: "Agent Version", value: device.agentVersion || "Unknown" },
                  { label: "MAC Address", value: device.macAddress || "-" },
                  { label: "Registered", value: new Date(device.registeredAt).toLocaleDateString() },
                  { label: "Last Seen", value: device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never" },
                ].map((item) => (
                  <Grid item xs={6} sm={4} key={item.label}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
                      {item.label}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {item.value}
                    </Typography>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "text.secondary", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.05em" }}>
                Actions
              </Typography>
              <Button
                fullWidth
                variant="contained"
                startIcon={<CameraAlt />}
                onClick={() => setScreenshotDialog(true)}
                disabled={device.status !== "ONLINE"}
                sx={{ mb: 1.5 }}
              >
                Request Screenshot
              </Button>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Refresh />}
                onClick={loadDevice}
                sx={{ borderColor: "divider", color: "text.secondary" }}
              >
                Refresh
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent sx={{ p: 0 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{
              px: 3,
              borderBottom: "1px solid",
              borderColor: "divider",
              "& .MuiTab-root": { textTransform: "none", fontWeight: 500 },
            }}
          >
            <Tab label={`Commands (${commands.length})`} />
            <Tab label={`Screenshots (${screenshots.length})`} />
          </Tabs>

          <Box sx={{ p: 0 }}>
            {tab === 0 && (
              commands.length === 0 ? (
                <EmptyState
                  icon={<CameraAlt />}
                  title="No commands yet"
                  description="Commands sent to this device will appear here."
                />
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Type</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Requested By</TableCell>
                        <TableCell>Created</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {commands.map((cmd) => (
                        <TableRow key={cmd.id}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {cmd.commandType}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="caption"
                              sx={{
                                px: 1,
                                py: 0.5,
                                borderRadius: 1,
                                fontWeight: 500,
                                backgroundColor:
                                  cmd.status === "COMPLETED" ? "rgba(34, 197, 94, 0.1)" :
                                  cmd.status === "FAILED" ? "rgba(239, 68, 68, 0.1)" :
                                  "rgba(245, 158, 11, 0.1)",
                                color:
                                  cmd.status === "COMPLETED" ? "success.main" :
                                  cmd.status === "FAILED" ? "error.main" :
                                  "warning.main",
                              }}
                            >
                              {cmd.status}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {cmd.requestedBy?.username || "-"}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {new Date(cmd.createdAt).toLocaleString()}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )
            )}

            {tab === 1 && (
              screenshots.length === 0 ? (
                <EmptyState
                  icon={<CameraAlt />}
                  title="No screenshots yet"
                  description="Request a screenshot from an online device to see it here."
                />
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Preview</TableCell>
                        <TableCell>Size</TableCell>
                        <TableCell>Requested By</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {screenshots.map((ss) => (
                        <TableRow key={ss.id}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontFamily: '"Geist Mono", monospace', fontSize: "0.8125rem" }}>
                              {ss.id.slice(0, 8)}...
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {ss.fileSize ? `${(ss.fileSize / 1024).toFixed(1)} KB` : "-"}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {ss.requestedBy?.username || "-"}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">
                              {new Date(ss.createdAt).toLocaleString()}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Tooltip title="View screenshot">
                              <IconButton
                                size="small"
                                onClick={() => {
                                  const filename = ss.filePath.split("/").pop();
                                  window.open(`/uploads/screenshots/${filename}`, "_blank");
                                }}
                                aria-label="View screenshot"
                              >
                                <Visibility fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )
            )}
          </Box>
        </CardContent>
      </Card>

      <Dialog
        open={screenshotDialog}
        onClose={() => setScreenshotDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Request Screenshot</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Reason (optional)"
            value={screenshotReason}
            onChange={(e) => setScreenshotReason(e.target.value)}
            multiline
            rows={3}
            sx={{ mt: 1 }}
            placeholder="Why do you need this screenshot?"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setScreenshotDialog(false)} sx={{ color: "text.secondary" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleScreenshot}
            disabled={requestingScreenshot}
          >
            {requestingScreenshot ? "Requesting..." : "Request"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
