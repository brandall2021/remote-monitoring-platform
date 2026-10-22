import { io, Socket } from "socket.io-client";
import axios from "axios";
import { AgentConfig, loadConfig, saveConfig, getSystemInfo, generateDeviceId } from "./config";
import {
  takeScreenshot,
  takeLiveFrame,
  LiveFrameResult,
  getSystemInfo as getDetailedSystemInfo,
  getProcessList,
  lockScreen,
  shutdown,
  restart,
  logout,
} from "./commands";
import { AgentRole, resolveRole } from "./role";
import { clampLiveInterval, nextFrameDelayMs } from "./liveStream";
import { stopLiveCaptureWorker } from "./liveCaptureWorker";
import { SessionSupervisor } from "./sessionSupervisor";
import { SessionBridge } from "./sessionBridge";
import { SessionWorker } from "./sessionWorker";
import { createPowerShellBridgeRunner, defaultBridgeScriptPath } from "./sessionBridgeRunner";
import { createSessionSecret, readSessionSecret } from "./sessionSecret";
import { AgentState, makeStatus, writeAgentStatus } from "./agentStatus";

let lastError: string | undefined;

// Estado para la bandeja del sistema (RmTray.exe). En rol "session" el worker lo recibe por la pipe
// y lo persiste el; acá nunca se levanta ese rol, así que este helper solo aplica a standalone y
// supervisor. Fallar escribiendo el estado jamas puede tumbar al agente: es información cosmética.
function reportStatus(state: AgentState, extra?: { error?: string; heartbeat?: boolean }): void {
  if (extra?.error) lastError = extra.error;
  if (state === "connected") lastError = undefined;

  const status = makeStatus({
    state,
    serverUrl: config?.serverUrl || process.env.SERVER_URL || "",
    deviceId: config?.deviceId,
    role,
    lastError,
    lastHeartbeatAt:
      state === "connected" || extra?.heartbeat ? new Date().toISOString() : undefined,
  });

  // Primero lo escribe este proceso (funciona en standalone/logon, donde ya es el usuario).
  writeAgentStatus(status);

  // En modo Session 0 este proceso es SYSTEM y no puede escribir en el perfil del usuario: el
  // worker, que corre en la sesion interactiva, reescribe el mismo estado del otro lado de la pipe.
  if (supervisor) supervisor.broadcastStatus(status);
}

let socket: Socket | null = null;
let config: AgentConfig | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let isCapturing = false;
// Streaming de vista en vivo: cuando el server manda "live-start", el agente produce cuadros solo,
// con su propio ritmo. "live-command" sigue atendiendo de a un cuadro, para servers viejos.
let liveStreaming = false;
let liveStreamTimer: NodeJS.Timeout | null = null;
let liveStreamIntervalMs = 1000;
let role: AgentRole = "standalone";
let supervisor: SessionSupervisor | null = null;
let sessionBridge: SessionBridge | null = null;
let sessionWorker: SessionWorker | null = null;

async function registerDevice(serverUrl: string, registrationToken: string): Promise<AgentConfig> {
  console.log("Registering device...");

  const normalizedServerUrl = serverUrl.replace(/\/+$/, "");

  const sysInfo = getSystemInfo();
  const deviceId = generateDeviceId();

  const { data } = await axios.post(`${normalizedServerUrl}/api/devices/register`, {
    hostname: sysInfo.hostname,
    operatingSystem: sysInfo.operatingSystem,
    osVersion: sysInfo.osVersion,
    ipAddress:
      sysInfo.networkInterfaces.length > 0
        ? sysInfo.networkInterfaces[0].address
        : "unknown",
    macAddress:
      sysInfo.networkInterfaces.length > 0
        ? sysInfo.networkInterfaces[0].mac
        : undefined,
    platform: sysInfo.platform,
    agentVersion: process.env.AGENT_VERSION || "1.1.0",
    registrationToken,
  });

  if (!data?.id || !data?.registrationToken) {
    throw new Error("The server returned an invalid device registration response");
  }

  const agentConfig: AgentConfig = {
    serverUrl: normalizedServerUrl,
    deviceId: data.id,
    registrationToken: data.registrationToken,
    agentVersion: process.env.AGENT_VERSION || "1.1.0",
    heartbeatInterval: parseHeartbeat(process.env.HEARTBEAT_INTERVAL),
  };

  saveConfig(agentConfig);
  console.log(`Device registered with ID: ${data.id}`);
  return agentConfig;
}

function connectSocket(): void {
  if (!config) return;

  socket = io(`${config.serverUrl}/agent`, {
    auth: {
      deviceId: config.deviceId,
      token: config.registrationToken,
      agentVersion: config.agentVersion,
      // El server elige el protocolo de vista en vivo con esto: "2" acepta live-start/live-stop (push),
      // los agentes ya instalados que no lo mandan siguen recibiendo un live-command por cuadro.
      liveProtocol: "2",
    },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 30000,
    timeout: 20000,
    reconnectionAttempts: Infinity,
  });

  socket.on("connect", () => {
    console.log("Connected to server");
    reportStatus("connected");
    startHeartbeat();
  });

  socket.on("disconnect", (reason) => {
    console.log(`Disconnected: ${reason}`);
    stopLiveStream();
    reportStatus("disconnected", { error: reason });
    stopHeartbeat();
  });

  socket.on("connect_error", (error) => {
    console.error(`Connection error: ${error.message}`);
    reportStatus("disconnected", { error: error.message });
  });

  socket.on("command", async (data: { commandId: string; type: string; payload?: any }) => {
    console.log(`Received command: ${data.type} (${data.commandId})`);
    await handleCommand(data);
  });

  socket.on("live-command", async () => {
    await handleLiveCommand();
  });

  socket.on("live-start", (data?: { intervalMs?: unknown }) => {
    startLiveStream(data?.intervalMs);
  });

  socket.on("live-stop", () => {
    stopLiveStream();
  });
}

// Empieza (o reajusta) el streaming. Se puede recibir live-start varias veces: cambiar el intervalo
// en el panel manda otro, y el server lo reenvia como watchdog cuando nota que dejaron de llegar cuadros.
function startLiveStream(rawInterval: unknown): void {
  if (!socket || !socket.connected) return;

  liveStreamIntervalMs = clampLiveInterval(rawInterval);
  if (liveStreaming) return;

  liveStreaming = true;
  console.log(`Live stream started (${liveStreamIntervalMs} ms/frame)`);
  void streamTick();
}

function stopLiveStream(): void {
  liveStreaming = false;
  if (liveStreamTimer) {
    clearTimeout(liveStreamTimer);
    liveStreamTimer = null;
  }
  // Sin espectadores no tiene sentido dejar un powershell.exe capturando la pantalla: se cierra ya, en
  // vez de esperar el timeout de inactividad del worker.
  stopLiveCaptureWorker();
}

// Un cuadro y despues el siguiente: el proximo se programa cuando termina la captura, asi que el
// ritmo real es max(intervalo, tiempo de captura) en vez de un timer que corre en paralelo y
// descarta pedidos. Es la diferencia entre "1 JPEG por round-trip" y video continuo.
async function streamTick(): Promise<void> {
  if (!liveStreaming) return;
  if (!socket || !socket.connected) {
    stopLiveStream();
    return;
  }

  const startedAt = Date.now();
  isCapturing = true;
  try {
    const result = await requestLiveFrame();
    socket.emit("live-frame-result", result.data, {
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
    });
  } catch (error: any) {
    socket.emit("live-frame-error", { error: error.message || "Screenshot failed" });
  } finally {
    isCapturing = false;
  }

  if (!liveStreaming) return;
  liveStreamTimer = setTimeout(() => {
    liveStreamTimer = null;
    void streamTick();
  }, nextFrameDelayMs(liveStreamIntervalMs, Date.now() - startedAt));
}

async function handleLiveCommand(): Promise<void> {
  if (!socket || !socket.connected) return;
  // En modo streaming el loop ya regula su propio ritmo; un live-command suelto se ignora.
  if (isCapturing || liveStreaming) return;

  isCapturing = true;
  try {
    const result = await requestLiveFrame();
    socket.emit("live-frame-result", result.data, {
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
    });
  } catch (error: any) {
    socket.emit("live-frame-error", {
      error: error.message || "Screenshot failed",
    });
  } finally {
    isCapturing = false;
  }
}

async function requestScreenshot(): Promise<Record<string, unknown>> {
  if (role === "supervisor" && supervisor) {
    const frame = (await supervisor.request("screenshot")) as {
      data?: Buffer;
      width?: number;
      height?: number;
    };
    return {
      imageBase64: frame.data ? frame.data.toString("base64") : "",
      width: frame.width || 0,
      height: frame.height || 0,
      format: "png",
    };
  }
  return takeScreenshot() as unknown as Record<string, unknown>;
}

async function requestLiveFrame(): Promise<LiveFrameResult> {
  if (role === "supervisor" && supervisor) {
    return (await supervisor.request("live-frame")) as LiveFrameResult;
  }
  return takeLiveFrame();
}

function parseHeartbeat(value: string | undefined): number {
  const parsed = Number(value || 30000);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 5000), 300000) : 30000;
}

async function handleCommand(data: {
  commandId: string;
  type: string;
  payload?: any;
}): Promise<void> {
  try {
    let result: Record<string, unknown> = {};

    switch (data.type) {
      case "SCREENSHOT":
        result = await requestScreenshot();
        break;

      case "SYSTEM_INFO":
        result = await getDetailedSystemInfo();
        break;

      case "PROCESS_LIST":
        result = { processes: await getProcessList() };
        break;

      case "LOCK_SCREEN":
        await lockScreen();
        result = { message: "Screen locked" };
        break;

      case "SHUTDOWN":
        result = { message: "Shutdown initiated" };
        sendCommandResult(data.commandId, "COMPLETED", result);
        await shutdown();
        return;

      case "RESTART":
        result = { message: "Restart initiated" };
        sendCommandResult(data.commandId, "COMPLETED", result);
        await restart();
        return;

      case "LOGOUT":
        result = { message: "Logout initiated" };
        sendCommandResult(data.commandId, "COMPLETED", result);
        await logout();
        return;

      default:
        throw new Error(`Unknown command type: ${data.type}`);
    }

    sendCommandResult(data.commandId, "COMPLETED", result);
  } catch (error: any) {
    console.error(`Command ${data.type} failed:`, error.message);
    sendCommandResult(data.commandId, "FAILED", undefined, error.message);
  }
}

function sendCommandResult(
  commandId: string,
  status: "COMPLETED" | "FAILED",
  result?: Record<string, unknown>,
  error?: string
): void {
  if (socket && socket.connected) {
    socket.emit("command-result", { commandId, status, result, error });
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket && socket.connected) {
      socket.emit("heartbeat", { agentVersion: config?.agentVersion });
      // El tray muestra "hace N s del ultimo latido": si solo escribieramos al conectar, el icono
      // se pondria rojo a los 2 minutos aunque el canal este sano.
      reportStatus("connected", { heartbeat: true });
    }
  }, config?.heartbeatInterval || 30000);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function main(): Promise<void> {
  role = resolveRole(process.argv, process.env);

  console.log("=== Remote Monitoring Agent ===");
  console.log(`Version: ${process.env.AGENT_VERSION || "1.1.0"}`);
  console.log(`Role: ${role}`);

  if (role === "session") {
    await startSessionRole();
    return;
  }

  if (role === "supervisor") {
    await startSupervisor();
  }

  config = loadConfig();

  const serverUrl = config?.serverUrl || process.env.SERVER_URL;
  const registrationToken = config?.registrationToken || process.env.REGISTRATION_TOKEN;

  if (!serverUrl || !registrationToken) {
    console.error("Please set SERVER_URL and REGISTRATION_TOKEN or install a valid agent config");
    process.exit(1);
  }

  // The installer can leave a bootstrap config without a deviceId. Register
  // again after a transient network outage instead of exiting at logon.
  if (!config?.deviceId) {
    let delay = 5000;
    while (!config?.deviceId) {
      try {
        config = await registerDevice(serverUrl, registrationToken);
      } catch (error: any) {
        console.error(`Registration failed: ${error?.message || error}. Retrying in ${delay / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 60000);
      }
    }
  }

  console.log(`Server: ${config.serverUrl}`);
  console.log(`Device ID: ${config.deviceId}`);

  reportStatus("starting");
  connectSocket();

  const stopAndExit = (signal: string) => {
    console.log(`${signal} shutting down...`);
    stopLiveStream();
    stopHeartbeat();
    reportStatus("stopped");
    if (socket) socket.disconnect();
    if (sessionBridge) sessionBridge.stop();
    if (supervisor) supervisor.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => stopAndExit("SIGINT"));
  process.on("SIGTERM", () => stopAndExit("SIGTERM"));
}

async function startSessionRole(): Promise<void> {
  const secret = readSessionSecret();
  if (!secret) {
    // Fail closed: sin el secreto que inyecta el supervisor en el bloque de entorno, el worker no
    // puede probar quien es, y conectarse a ciegas solo rellena la pipe de conexiones descartadas.
    console.error("Missing RM_SESSION_SECRET: this worker must be started by the session supervisor");
    process.exit(1);
  }

  sessionWorker = new SessionWorker({ secret });
  sessionWorker.run();
  console.log("Session worker running. Waiting for requests from the supervisor.");

  process.on("SIGINT", () => {
    if (sessionWorker) sessionWorker.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    if (sessionWorker) sessionWorker.stop();
    process.exit(0);
  });
}

async function startSupervisor(): Promise<void> {
  const sessionSecret = createSessionSecret();

  supervisor = new SessionSupervisor({
    secret: sessionSecret,
    onWorkerChange: (hasWorker) => {
      if (!hasWorker && sessionBridge) sessionBridge.notifyWorkerDisconnected();
    },
  });
  await supervisor.start();
  console.log("Session pipe listening.");

  sessionBridge = new SessionBridge({
    runBridge: createPowerShellBridgeRunner({
      scriptPath: defaultBridgeScriptPath(),
      agentExePath: process.execPath,
      sessionSecret,
    }),
    hasLiveWorker: () => (supervisor ? supervisor.hasLiveWorker() : false),
  });
  sessionBridge.start();
  console.log("Session bridge armed.");
}

main().catch((error) => {
  console.error("Agent failed:", error);
  process.exit(1);
});
