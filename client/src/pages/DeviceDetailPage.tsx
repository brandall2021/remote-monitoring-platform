import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  LinearProgress,
  Tabs,
  Tab,
} from "@mui/material";
import { CameraAlt, Refresh } from "@mui/icons-material";
import { devicesAPI, commandsAPI, screenshotsAPI } from "../services/api";
import { DeviceDetail, DeviceCommand, Screenshot } from "../types";

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [screenshotDialog, setScreenshotDialog] = useState(false);
  const [screenshotReason, setScreenshotReason] = useState("");
  const [requestingScreenshot, setRequestingScreenshot] = useState(false);

  const loadDevice = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await devicesAPI.get(id);
      setDevice(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevice();
  }, [id]);

  const handleScreenshot = async () => {
    if (!id) return;
    setRequestingScreenshot(true);
    try {
      await screenshotsAPI.request(id, screenshotReason);
      setScreenshotDialog(false);
      setScreenshotReason("");
      loadDevice();
    } finally {
      setRequestingScreenshot(false);
    }
  };

  if (loading || !device) return <LinearProgress />;

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        {device.hostname}
      </Typography>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Device Information</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Status</Typography>
                  <Chip label={device.status} color={device.status === "ONLINE" ? "success" : "error"} size="small" />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">IP Address</Typography>
                  <Typography>{device.ipAddress}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Operating System</Typography>
                  <Typography>{device.operatingSystem} {device.osVersion}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Agent Version</Typography>
                  <Typography>{device.agentVersion || "Unknown"}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Platform</Typography>
                  <Typography>{device.platform}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Last Seen</Typography>
                  <Typography>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never"}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Actions</Typography>
              <Button
                fullWidth
                variant="contained"
                startIcon={<CameraAlt />}
                onClick={() => setScreenshotDialog(true)}
                disabled={device.status !== "ONLINE"}
                sx={{ mb: 1 }}
              >
                Request Screenshot
              </Button>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Refresh />}
                onClick={loadDevice}
              >
                Refresh
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
            <Tab label={`Commands (${device.commands.length})`} />
            <Tab label={`Screenshots (${device.screenshots.length})`} />
            <Tab label={`Events (${device.events.length})`} />
          </Tabs>

          {tab === 0 && (
            <TableContainer component={Paper} variant="outlined">
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
                  {device.commands.map((cmd: DeviceCommand) => (
                    <TableRow key={cmd.id}>
                      <TableCell>{cmd.commandType}</TableCell>
                      <TableCell>
                        <Chip
                          label={cmd.status}
                          color={
                            cmd.status === "COMPLETED"
                              ? "success"
                              : cmd.status === "FAILED"
                              ? "error"
                              : "warning"
                          }
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{cmd.requestedBy?.username}</TableCell>
                      <TableCell>{new Date(cmd.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {tab === 1 && (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Size</TableCell>
                    <TableCell>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {device.screenshots.map((ss: Screenshot) => (
                    <TableRow key={ss.id}>
                      <TableCell>{ss.id.slice(0, 8)}</TableCell>
                      <TableCell>{ss.fileSize ? `${(ss.fileSize / 1024).toFixed(1)} KB` : "-"}</TableCell>
                      <TableCell>{new Date(ss.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {tab === 2 && (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Event</TableCell>
                    <TableCell>Message</TableCell>
                    <TableCell>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {device.events.map((evt) => (
                    <TableRow key={evt.id}>
                      <TableCell>
                        <Chip label={evt.eventType} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>{evt.message}</TableCell>
                      <TableCell>{new Date(evt.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog open={screenshotDialog} onClose={() => setScreenshotDialog(false)}>
        <DialogTitle>Request Screenshot</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Reason (optional)"
            value={screenshotReason}
            onChange={(e) => setScreenshotReason(e.target.value)}
            multiline
            rows={3}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScreenshotDialog(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleScreenshot}
            disabled={requestingScreenshot}
          >
            {requestingScreenshot ? "Requesting..." : "Request"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
