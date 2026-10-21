import fs from "fs";
import os from "os";
import path from "path";

// Estado vivo del agente en disco, para que el icono de la bandeja (RmTray.exe) pueda mostrar
//.connectado / sin conexión / último heartbeat sin tener que hablar con el server ni leer el token.
//
// Se escribe en dos lugares porque hay dos topologías de despliegue:
//   - modo logon: el agente corre COMO el usuario -> %LOCALAPPDATA%\RemoteMonitoringAgent
//   - modo Session 0 (SYSTEM): el agente corre como SYSTEM -> %PROGRAMDATA%\RemoteMonitoringAgent
// El tray lee ambos y se queda con el renglón más nuevo por `updatedAt`.
//
// El archivo a propósito NO lleva el registrationToken: es el único camino por el que un proceso
// que corre como usuario puede leer algo de esta instalación sin tocar la credencial.

export type AgentState = "connected" | "disconnected" | "starting" | "stopped";

export type AgentStatus = {
  state: AgentState;
  serverUrl: string;
  deviceId?: string;
  hostname: string;
  role: string;
  pid: number;
  updatedAt: string;
  lastHeartbeatAt?: string;
  lastError?: string;
};

const STATUS_BASENAME = "status.json";

export function statusFilePaths(
  env: NodeJS.ProcessEnv = process.env
): { machine: string; user: string } {
  const programData = env.ProgramData || env.APPDATA || os.tmpdir();
  const localAppData = env.LOCALAPPDATA || env.APPDATA || os.tmpdir();

  return {
    machine: path.join(programData, "RemoteMonitoringAgent", STATUS_BASENAME),
    user: path.join(localAppData, "RemoteMonitoringAgent", STATUS_BASENAME),
  };
}

function writeAtomic(file: string, json: string): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, json, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch {
    // El otro path (o el tray sin datos) sigue siendo una opción: nunca tiramos al agente por un
    // archivo de estado.
    return false;
  }
}

const STATES: AgentState[] = ["connected", "disconnected", "starting", "stopped"];
const MAX_TEXT = 300;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_TEXT ? `${trimmed.slice(0, MAX_TEXT)}…` : trimmed;
}

// Proyección estricta: lo único que puede terminar en el disco son estos campos. Cualquier otra
// clave que alguien agregue al objeto (o que llegue por la pipe desde el supervisor) se descarta
// acá, no en el lector. Es la garantía de que status.json —legible por cualquier usuario local, y
// eso es justo lo que quiere el icono de la bandeja— no puede convertirse en una fuga de secretos.
function projectStatus(input: Partial<AgentStatus>): AgentStatus {
  const state = STATES.includes(input.state as AgentState) ? (input.state as AgentState) : "disconnected";
  const status: AgentStatus = {
    state,
    serverUrl: text(input.serverUrl) || "",
    hostname: text(input.hostname) || os.hostname(),
    role: text(input.role) || "standalone",
    pid: typeof input.pid === "number" && Number.isFinite(input.pid) ? Math.trunc(input.pid) : process.pid,
    updatedAt:
      text(input.updatedAt) && Number.isFinite(Date.parse(String(input.updatedAt)))
        ? String(input.updatedAt)
        : new Date().toISOString(),
  };

  const deviceId = text(input.deviceId);
  if (deviceId) status.deviceId = deviceId;
  const lastHeartbeatAt = text(input.lastHeartbeatAt);
  if (lastHeartbeatAt) status.lastHeartbeatAt = lastHeartbeatAt;
  const lastError = text(input.lastError);
  if (lastError) status.lastError = lastError;

  return status;
}

// Escribe en ambos destinos. Devuelve los que quedaron bien, solo para el log/test.
export function writeAgentStatus(status: Partial<AgentStatus>): string[] {
  const json = `${JSON.stringify(projectStatus(status), null, 2)}\n`;
  const { machine, user } = statusFilePaths();
  const written: string[] = [];

  if (writeAtomic(machine, json)) written.push(machine);
  if (user !== machine && writeAtomic(user, json)) written.push(user);

  return written;
}

export function readAgentStatus(file: string): AgentStatus | null {
  try {
    const raw = fs.readFileSync(file, "utf-8").replace(/^﻿/, "");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.updatedAt !== "string" || typeof parsed.hostname !== "string") return null;
    if (!STATES.includes(parsed.state as AgentState)) return null;

    return projectStatus(parsed as Partial<AgentStatus>);
  } catch {
    return null;
  }
}

// El tray no necesita un watcher: lee los dos archivos y se queda con el más nuevo. Con eso
// sobrevive a que una de las dos topologías no exista en la máquina.
export function newestStatus(
  files: string[] = Object.values(statusFilePaths()),
  now: number = Date.now()
): { status: AgentStatus; file: string } | null {
  let best: { status: AgentStatus; file: string } | null = null;

  for (const file of files) {
    const status = readAgentStatus(file);
    if (!status) continue;

    const stamp = Date.parse(status.updatedAt);
    // Un estado más viejo que STALE_AFTER_MS ya no representa nada: el proceso puede estar muerto
    // sin haber alcanzado a escribir "stopped".
    if (!Number.isFinite(stamp) || now - stamp > STATUS_STALE_MS) continue;

    if (!best || stamp > Date.parse(best.status.updatedAt)) best = { status, file };
  }

  return best;
}

// 3 latidos de heartbeat + margen: coincide con DEVICE_OFFLINE_AFTER_MS del server.
export const STATUS_STALE_MS = 120_000;

export function isStale(status: AgentStatus, now: number = Date.now()): boolean {
  const stamp = Date.parse(status.updatedAt);
  if (!Number.isFinite(stamp)) return true;
  return now - stamp > STATUS_STALE_MS;
}

export function makeStatus(partial: Omit<AgentStatus, "hostname" | "pid" | "updatedAt">): AgentStatus {
  return {
    ...partial,
    hostname: os.hostname(),
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  };
}
