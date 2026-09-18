import { io, Socket } from "socket.io-client";
import axios from "axios";
import { AgentConfig, loadConfig, saveConfig, getSystemInfo, generateDeviceId } from "./config";
import {
  takeScreenshot,
  takeLiveFrame,
  getSystemInfo as getDetailedSystemInfo,
  getProcessList,
  lockScreen,
  shutdown,
  restart,
  logout,
} from "./commands";

let socket: Socket | null = null;
let config: AgentConfig | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let isCapturing = false;

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
    agentVersion: process.env.AGENT_VERSION || "1.0.0",
    registrationToken,
  });

  if (!data?.id || !data?.registrationToken) {
    throw new Error("The server returned an invalid device registration response");
  }

  const agentConfig: AgentConfig = {
    serverUrl: normalizedServerUrl,
    deviceId: data.id,
    registrationToken: data.registrationToken,
    agentVersion: process.env.AGENT_VERSION || "1.0.0",
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
    startHeartbeat();
  });

  socket.on("disconnect", (reason) => {
    console.log(`Disconnected: ${reason}`);
    stopHeartbeat();
  });

  socket.on("connect_error", (error) => {
    console.error(`Connection error: ${error.message}`);
  });

  socket.on("command", async (data: { commandId: string; type: string; payload?: any }) => {
    console.log(`Received command: ${data.type} (${data.commandId})`);
    await handleCommand(data);
  });

  socket.on("live-command", async () => {
    await handleLiveCommand();
  });
}

async function handleLiveCommand(): Promise<void> {
  if (!socket || !socket.connected) return;
  if (isCapturing) return;

  isCapturing = true;
  try {
    const result = await takeLiveFrame();
    socket.emit("live-frame-result", {
      imageBase64: result.imageBase64,
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
        result = await takeScreenshot();
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
  console.log("=== Remote Monitoring Agent ===");
  console.log(`Version: ${process.env.AGENT_VERSION || "1.0.0"}`);

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

  connectSocket();

  process.on("SIGINT", () => {
    console.log("Shutting down...");
    stopHeartbeat();
    if (socket) socket.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("Shutting down...");
    stopHeartbeat();
    if (socket) socket.disconnect();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Agent failed:", error);
  process.exit(1);
});
