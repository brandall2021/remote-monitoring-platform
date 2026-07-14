import os from "os";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

export interface AgentConfig {
  serverUrl: string;
  deviceId: string;
  registrationToken: string;
  agentVersion: string;
  heartbeatInterval: number;
}

const CONFIG_FILE = path.join(
  process.env.APPDATA || process.env.HOME || ".",
  "remote-monitor-agent.json"
);

export function loadConfig(): AgentConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to load config:", error);
  }
  return null;
}

export function saveConfig(config: AgentConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`Config saved to ${CONFIG_FILE}`);
  } catch (error) {
    console.error("Failed to save config:", error);
  }
}

export function getSystemInfo() {
  return {
    hostname: os.hostname(),
    operatingSystem: os.platform(),
    osVersion: os.release(),
    platform: os.arch(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus().length,
    uptime: os.uptime(),
    username: os.userInfo().username,
    networkInterfaces: Object.entries(os.networkInterfaces())
      .flatMap(([name, interfaces]) =>
        (interfaces || [])
          .filter((i) => !i.internal && i.family === "IPv4")
          .map((i) => ({ name, address: i.address, mac: i.mac }))
      ),
  };
}

export function generateDeviceId(): string {
  return uuidv4();
}
