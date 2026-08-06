import { useState, useEffect, useCallback, useRef } from "react";
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
  Select,
  MenuItem,
  IconButton,
  Tooltip,
} from "@mui/material";
import { CameraAlt, Refresh, ArrowBack, Visibility, Monitor, FiberManualRecord, Stop } from "@mui/icons-material";
import { devicesAPI, commandsAPI, screenshotsAPI, Device, Command, Screenshot } from "../services/api";
import { getAdminSocket } from "../services/websocket";
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
  const [role, setRole] = useState<"ASESOR" | "SUPERVISOR">("ASESOR");
  const [savingRole, setSavingRole] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });
  const [liveActive, setLiveActive] = useState(false);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveIntervalMs, setLiveIntervalMs] = useState(2000);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingPumpRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameRef = useRef<{ imageBase64: string; mimeType: string } | null>(null);

  const loadDevice = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await devicesAPI.get(id);
      setDevice(data);
      setRole(data.role || "ASESOR");
      const [cmdRes, ssRes] = await Promise.all([
        commandsAPI.listByDevice(id),
        screenshotsAPI.listByDevice(id),
      ]);
      setCommands(cmdRes.data.commands || []);
      setScreenshots(ssRes.data.screenshots || []);
    } catch {
      setError("No se encontró el dispositivo o no se pudo cargar.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDevice();
  }, [loadDevice]);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) return;
    const socket = getAdminSocket(token);

    const onFrame = (data: { deviceId: string; imageBase64: string; mimeType?: string }) => {
      if (data.deviceId !== id) return;
      setLiveFrame(`data:${data.mimeType || "image/jpeg"};base64,${data.imageBase64}`);
      setLiveError(null);
      lastFrameRef.current = {
        imageBase64: data.imageBase64,
        mimeType: data.mimeType || "image/jpeg",
      };
      if (recordingRef.current) {
        drawFrameToCanvas(data.imageBase64, data.mimeType || "image/jpeg");
      }
    };
    const onFrameError = (data: { deviceId: string; error: string }) => {
      if (data.deviceId !== id) return;
      setLiveError(data.error);
    };

    socket.on("live-frame", onFrame);
    socket.on("live-frame-error", onFrameError);

    return () => {
      socket.off("live-frame", onFrame);
      socket.off("live-frame-error", onFrameError);
    };
  }, [id]);

  const startLiveView = useCallback(() => {
    const token = localStorage.getItem("accessToken");
    if (!token || !id) return;
    const socket = getAdminSocket(token);
    setLiveActive(true);
    setLiveFrame(null);
    setLiveError(null);
    socket.emit("live-view-frame", { deviceId: id });
    liveTimerRef.current = setInterval(() => {
      socket.emit("live-view-frame", { deviceId: id });
    }, liveIntervalMs);
  }, [id, liveIntervalMs]);

  const stopLiveView = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    const token = localStorage.getItem("accessToken");
    if (token) getAdminSocket(token).emit("stop-live-view", { deviceId: id });
    setLiveActive(false);
    setLiveFrame(null);
    setLiveError(null);
  }, [id]);

  const changeLiveInterval = useCallback(
    (ms: number) => {
      setLiveIntervalMs(ms);
      if (!liveActive || !liveTimerRef.current) return;
      const token = localStorage.getItem("accessToken");
      if (!token || !id) return;
      const socket = getAdminSocket(token);
      clearInterval(liveTimerRef.current);
      socket.emit("live-view-frame", { deviceId: id });
      liveTimerRef.current = setInterval(() => {
        socket.emit("live-view-frame", { deviceId: id });
      }, ms);
    },
    [liveActive, id]
  );

  const drawFrameToCanvas = useCallback((imageBase64: string, mimeType: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && canvas.width === 0) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = `data:${mimeType};base64,${imageBase64}`;
  }, []);

  const startRecording = useCallback(() => {
    if (!liveFrame) return;
    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth || 1280;
      canvas.height = img.naturalHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const stream = canvas.captureStream(4);
      streamRef.current = stream;
      chunksRef.current = [];

      const mime = MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
          ? "video/webm;codecs=vp8"
          : "";
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch {
        recorder = new MediaRecorder(stream);
      }
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (recordingPumpRef.current) {
          clearInterval(recordingPumpRef.current);
          recordingPumpRef.current = null;
        }
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `vista-en-vivo-${device?.hostname || "equipo"}-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        canvasRef.current = null;
        recordingRef.current = false;
        setRecording(false);
      };
      recorder.start(1000);
      recordingRef.current = true;
      setRecording(true);

      recordingPumpRef.current = setInterval(() => {
        const canvas = canvasRef.current;
        const frame = lastFrameRef.current;
        if (!canvas || !frame) return;
        const img = new Image();
        img.onload = () => {
          const ctx = canvas.getContext("2d");
          if (ctx && canvas.width > 0) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
        };
        img.src = `data:${frame.mimeType};base64,${frame.imageBase64}`;
      }, 250);
    };
    img.src = liveFrame;
  }, [liveFrame, device]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
      const token = localStorage.getItem("accessToken");
      if (token && id) getAdminSocket(token).emit("stop-live-view", { deviceId: id });
    },
    [id]
  );

  const handleScreenshot = async () => {
    if (!id) return;
    setRequestingScreenshot(true);
    try {
      await screenshotsAPI.request(id, screenshotReason);
      setScreenshotDialog(false);
      setScreenshotReason("");
      setSnackbar({ open: true, message: "Captura solicitada correctamente", severity: "success" });
      loadDevice();
    } catch {
      setSnackbar({ open: true, message: "Error al solicitar la captura", severity: "error" });
    } finally {
      setRequestingScreenshot(false);
    }
  };

  const handleRoleChange = async () => {
    if (!id) return;
    setSavingRole(true);
    try {
      const { data } = await devicesAPI.update(id, { role });
      setRole(data.role || role);
      setDevice((prev) => (prev ? { ...prev, role: data.role || role } : prev));
      setSnackbar({ open: true, message: "Rol del dispositivo actualizado", severity: "success" });
    } catch {
      setSnackbar({ open: true, message: "Error al actualizar el rol", severity: "error" });
    } finally {
      setSavingRole(false);
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
    return <ErrorState message={error || "Dispositivo no encontrado"} onRetry={loadDevice} />;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton onClick={() => navigate("/devices")} size="small" aria-label="Volver a dispositivos">
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
                Información del Dispositivo
              </Typography>
              <Grid container spacing={2.5}>
                {[
                  { label: "Dirección IP", value: device.ipAddress },
                  { label: "Plataforma", value: device.platform || "-" },
                  { label: "Versión del Agente", value: device.agentVersion || "Desconocida" },
                  { label: "Dirección MAC", value: device.macAddress || "-" },
                  { label: "Registrado", value: new Date(device.registeredAt).toLocaleDateString() },
                  { label: "Última Conexión", value: device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Nunca" },
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
              <Box
                sx={{
                  mt: 3,
                  pt: 2.5,
                  borderTop: "1px solid",
                  borderColor: "divider",
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                <Box sx={{ minWidth: 220 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                    Rol del equipo
                  </Typography>
                  <Select
                    size="small"
                    fullWidth
                    value={role}
                    onChange={(e) => setRole(e.target.value as "ASESOR" | "SUPERVISOR")}
                    sx={{ fontSize: "0.875rem" }}
                  >
                    <MenuItem value="ASESOR">Asesor</MenuItem>
                    <MenuItem value="SUPERVISOR">Supervisor</MenuItem>
                  </Select>
                </Box>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleRoleChange}
                  disabled={savingRole || role === device.role}
                  sx={{ textTransform: "none" }}
                >
                  {savingRole ? "Guardando..." : "Guardar Rol"}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "text.secondary", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.05em" }}>
                Acciones
              </Typography>
              <Button
                fullWidth
                variant={liveActive ? "contained" : "outlined"}
                color={liveActive ? "error" : "primary"}
                startIcon={<Monitor />}
                onClick={liveActive ? stopLiveView : startLiveView}
                disabled={device.status !== "ONLINE" && !liveActive}
                sx={{ mb: 1.5 }}
              >
                {liveActive ? "Detener Vista en Vivo" : "Ver en Vivo"}
              </Button>
              <Button
                fullWidth
                variant="contained"
                startIcon={<CameraAlt />}
                onClick={() => setScreenshotDialog(true)}
                disabled={device.status !== "ONLINE"}
                sx={{ mb: 1.5 }}
              >
                Solicitar Captura
              </Button>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Refresh />}
                onClick={loadDevice}
                sx={{ borderColor: "divider", color: "text.secondary" }}
              >
                Actualizar
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {liveActive && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
              <Typography variant="subtitle2" sx={{ color: "text.secondary", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.05em" }}>
                Vista en Vivo
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Button
                  size="small"
                  variant={recording ? "contained" : "outlined"}
                  color={recording ? "error" : "primary"}
                  startIcon={recording ? <Stop /> : <FiberManualRecord />}
                  onClick={recording ? stopRecording : startRecording}
                  disabled={!recording && !liveFrame}
                  sx={{ textTransform: "none", mr: 1 }}
                >
                  {recording ? "Detener y Descargar" : "Grabar"}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  Intervalo
                </Typography>
                <Select
                  size="small"
                  value={liveIntervalMs}
                  onChange={(e) => changeLiveInterval(Number(e.target.value))}
                  sx={{ minWidth: 90, fontSize: "0.8125rem" }}
                >
                  <MenuItem value={1000}>1 s</MenuItem>
                  <MenuItem value={2000}>2 s</MenuItem>
                  <MenuItem value={5000}>5 s</MenuItem>
                </Select>
                <CircularProgress size={14} sx={{ color: "success.main" }} />
                <Typography variant="caption" color="text.secondary">
                  Actualizando...
                </Typography>
              </Box>
            </Box>
            {liveError ? (
              <Typography variant="body2" color="error">
                {liveError}
              </Typography>
            ) : liveFrame ? (
              <Box
                component="img"
                src={liveFrame}
                alt="Vista en vivo"
                sx={{ width: "100%", borderRadius: 1, border: "1px solid", borderColor: "divider" }}
              />
            ) : (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress size={32} sx={{ color: "primary.main" }} />
              </Box>
            )}
          </CardContent>
        </Card>
      )}

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
            <Tab label={`Comandos (${commands.length})`} />
            <Tab label={`Capturas (${screenshots.length})`} />
          </Tabs>

          <Box sx={{ p: 0 }}>
            {tab === 0 && (
              commands.length === 0 ? (
                <EmptyState
                  icon={<CameraAlt />}
                  title="Aún no hay comandos"
                  description="Los comandos enviados a este dispositivo aparecerán aquí."
                />
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Tipo</TableCell>
                        <TableCell>Estado</TableCell>
                        <TableCell>Solicitado Por</TableCell>
                        <TableCell>Creado</TableCell>
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
                  title="Aún no hay capturas"
                  description="Solicita una captura desde un dispositivo en línea para verla aquí."
                />
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Vista Previa</TableCell>
                        <TableCell>Tamaño</TableCell>
                        <TableCell>Solicitado Por</TableCell>
                        <TableCell>Fecha</TableCell>
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
                            <Tooltip title="Ver captura">
                              <IconButton
                                size="small"
                                onClick={() => {
                                  const filename = ss.filePath.split("/").pop();
                                  window.open(`/uploads/screenshots/${filename}`, "_blank");
                                }}
                                aria-label="Ver captura"
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
        <DialogTitle sx={{ fontWeight: 600 }}>Solicitar Captura</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Motivo (opcional)"
            value={screenshotReason}
            onChange={(e) => setScreenshotReason(e.target.value)}
            multiline
            rows={3}
            sx={{ mt: 1 }}
            placeholder="¿Por qué necesitas esta captura?"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setScreenshotDialog(false)} sx={{ color: "text.secondary" }}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={handleScreenshot}
            disabled={requestingScreenshot}
          >
            {requestingScreenshot ? "Solicitando..." : "Solicitar"}
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
