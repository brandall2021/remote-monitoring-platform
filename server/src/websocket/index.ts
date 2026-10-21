import { Server as SocketIOServer, Namespace, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { verifyAccessToken } from "../security/jwt";
import { hasPermission } from "../security/permissions";
import { safeCompare } from "../security/tokens";
import { canExecute, isAllowedCommandType } from "./commandPolicy";
import { detectImage } from "../lib/image";
import { deviceService } from "../services/device.service";
import { commandService } from "../services/command.service";
import { screenshotService } from "../services/screenshot.service";
import { writeAuditLog } from "../middleware/audit";
import prisma from "../config/database";
import { config } from "../config";
import { CommandType, Permission, Role } from "../types";

export interface AdminSocket extends Socket {
  userId?: string;
  role?: Role;
}

interface AgentSocket extends Socket {
  deviceId?: string;
}

let agentNamespace: Namespace | null = null;

function toBuffer(payload: Buffer | ArrayBuffer): Buffer | null {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  return null;
}

export function emitCommandToAgent(
  deviceId: string,
  commandId: string,
  type: string,
  payload?: Record<string, unknown>
): void {
  if (!agentNamespace) return;
  agentNamespace.to(deviceId).emit("command", { commandId, type, payload });
}

// El namespace /admin autentificaba el JWT y marcaba isAdmin, pero ningún handler volvía a
// consultar permisos: un OPERATOR conectado por WebSocket podía apagar, reiniciar, bloquear y
// ver el escritorio en vivo de cualquier equipo, aunque el RBAC de HTTP se lo negara. Cada acción
// pasa ahora por este guard.
export function requireAdminPermission(
  socket: AdminSocket,
  permission: Permission,
  action: string
): boolean {
  if (!socket.userId || !socket.role) {
    socket.emit("error", { message: "Sesión no válida" });
    return false;
  }
  if (!hasPermission(socket.role, permission)) {
    socket.emit("error", { message: `El rol ${socket.role} no puede ejecutar ${action}` });
    void writeAuditLog({
      userId: socket.userId,
      action: `WS_${action}_DENIED`,
      resource: "websocket",
      details: { permission, role: socket.role },
    });
    return false;
  }
  return true;
}

export function setupWebSocket(server: HttpServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: config.cors.origin,
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingInterval: config.websocket.pingIntervalMs,
    pingTimeout: config.websocket.pingTimeoutMs,
    maxHttpBufferSize: config.websocket.maxHttpBufferSize,
  });

  const adminNamespace = io.of("/admin");
  const agentNs = io.of("/agent");
  agentNamespace = agentNs;

  adminNamespace.use(async (socket: AdminSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1];
      if (!token) {
        return next(new Error("Authentication required"));
      }
      const payload = verifyAccessToken(token);

      // Se relee el usuario en base: un JWT de 15 minutos no debe seguir habilitando el canal
      // después de que desactivaron o bajaron de rol a esa persona.
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, isActive: true, role: { select: { name: true } } },
      });
      if (!user || !user.isActive) {
        return next(new Error("Usuario inactivo"));
      }

      socket.userId = user.id;
      socket.role = user.role.name as Role;
      next();
    } catch (error) {
      next(new Error("Invalid token"));
    }
  });

  agentNs.use(async (socket: AgentSocket, next) => {
    try {
      const { deviceId, token } = socket.handshake.auth ?? {};
      if (!deviceId || !token) {
        return next(new Error("Device ID and token required"));
      }

      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { registrationToken: true },
      });

      if (!device || !safeCompare(String(token), device.registrationToken)) {
        return next(new Error("Invalid device credentials"));
      }

      socket.deviceId = deviceId;
      next();
    } catch (error) {
      next(new Error("Authentication failed"));
    }
  });

  adminNamespace.on("connection", (socket: AdminSocket) => {
    console.log(`[ADMIN] Connected: ${socket.userId} (${socket.role})`);

    socket.on("request-screenshot", async (data: { deviceId?: string; reason?: string }) => {
      try {
        if (!data?.deviceId) return;
        if (!requireAdminPermission(socket, Permission.SCREENSHOTS_REQUEST, "request-screenshot")) return;

        const command = await screenshotService.request(
          data.deviceId,
          socket.userId!,
          typeof data.reason === "string" ? data.reason.slice(0, 300) : "Admin requested screenshot"
        );

        agentNs.to(data.deviceId).emit("command", {
          commandId: command.id,
          type: CommandType.SCREENSHOT,
          payload: command.payload,
        });

        adminNamespace.emit("screenshot-requested", {
          commandId: command.id,
          deviceId: data.deviceId,
        });

        void writeAuditLog({
          userId: socket.userId,
          action: "WS_SCREENSHOT_REQUEST",
          resource: "device",
          resourceId: data.deviceId,
          details: { commandId: command.id, via: "websocket" },
        });
      } catch (error) {
        console.error("[ADMIN] request-screenshot error:", error);
        socket.emit("error", { message: "No se pudo solicitar la captura" });
      }
    });

    socket.on("send-command", async (data: {
      deviceId?: string;
      commandType?: unknown;
      payload?: Record<string, unknown>;
    }) => {
      try {
        if (!data?.deviceId) return;

        // Ni tipos desconocidos ni comandos fuera de la lista llegan al agente.
        if (!isAllowedCommandType(data.commandType)) {
          socket.emit("error", { message: "Tipo de comando no permitido" });
          return;
        }
        if (!canExecute(socket.role ?? ("" as Role), data.commandType)) {
          socket.emit("error", { message: `El rol ${socket.role} no puede ejecutar ${data.commandType}` });
          void writeAuditLog({
            userId: socket.userId,
            action: "WS_COMMAND_DENIED",
            resource: "device",
            resourceId: data.deviceId,
            details: { commandType: data.commandType, role: socket.role },
          });
          return;
        }
        if (!requireAdminPermission(socket, Permission.COMMANDS_EXECUTE, "send-command")) return;

        const command = await commandService.create({
          deviceId: data.deviceId,
          requestedById: socket.userId!,
          commandType: data.commandType,
          payload: data.payload,
        });

        agentNs.to(data.deviceId).emit("command", {
          commandId: command.id,
          type: data.commandType,
          payload: data.payload,
        });

        adminNamespace.emit("command-sent", {
          commandId: command.id,
          deviceId: data.deviceId,
          type: data.commandType,
        });

        void writeAuditLog({
          userId: socket.userId,
          action: "WS_COMMAND_SENT",
          resource: "device",
          resourceId: data.deviceId,
          details: { commandId: command.id, commandType: data.commandType },
        });
      } catch (error) {
        console.error("[ADMIN] send-command error:", error);
        socket.emit("error", { message: "No se pudo enviar el comando" });
      }
    });

    // Ver el escritorio en vivo es más invasivo que ver una captura guardada: exige el permiso con
    // el que se dispara la captura (SCREENSHOTS_REQUEST), no solo SCREENSHOTS_VIEW.
    socket.on("live-view-frame", (data: { deviceId?: string }) => {
      if (!data?.deviceId) return;
      if (!requireAdminPermission(socket, Permission.SCREENSHOTS_REQUEST, "live-view")) return;
      socket.join(`live:${data.deviceId}`);
      agentNs.to(data.deviceId).emit("live-command");
      void writeAuditLog({
        userId: socket.userId,
        action: "WS_LIVE_VIEW_START",
        resource: "device",
        resourceId: data.deviceId,
      });
    });

    socket.on("stop-live-view", (data: { deviceId?: string }) => {
      if (!data?.deviceId) return;
      socket.leave(`live:${data.deviceId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[ADMIN] Disconnected: ${socket.userId}`);
    });
  });

  agentNs.on("connection", async (socket: AgentSocket) => {
    const deviceId = socket.deviceId!;
    console.log(`[AGENT] Connected: ${deviceId}`);

    socket.join(deviceId);

    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { status: true },
    });

    if (device && device.status !== "ONLINE") {
      await deviceService.logPowerEvent(deviceId, "POWER_ON");
    }

    await deviceService.heartbeat(deviceId, String(socket.handshake.auth?.agentVersion || "unknown"));

    adminNamespace.emit("device-status", {
      deviceId,
      status: "ONLINE",
    });

    socket.on("heartbeat", async (data: { agentVersion?: string }) => {
      try {
        await deviceService.heartbeat(deviceId, String(data?.agentVersion || "unknown"));
        adminNamespace.emit("device-status", {
          deviceId,
          status: "ONLINE",
        });
      } catch (error) {
        console.error(`Heartbeat error for ${deviceId}:`, error);
      }
    });

    socket.on("command-result", async (data: {
      commandId?: string;
      status?: "COMPLETED" | "FAILED";
      result?: Record<string, unknown>;
      error?: string;
    }) => {
      try {
        if (!data?.commandId) return;

        // Un agente no puede cerrar comandos de otro dispositivo: la fila manda.
        const command = await prisma.deviceCommand.findUnique({
          where: { id: data.commandId },
          select: { id: true, deviceId: true, requestedById: true },
        });
        if (!command || command.deviceId !== deviceId) {
          console.warn(`[AGENT] ${deviceId} reportó resultado de un comando ajeno: ${data.commandId}`);
          void writeAuditLog({
            action: "WS_COMMAND_RESULT_REJECTED",
            resource: "device",
            resourceId: deviceId,
            details: { commandId: data.commandId, reason: "ownership mismatch" },
          });
          return;
        }

        if (data.status === "COMPLETED") {
          await commandService.execute(command.id, data.result || {});
        } else {
          await prisma.deviceCommand.update({
            where: { id: command.id },
            data: { status: "FAILED", error: typeof data.error === "string" ? data.error.slice(0, 2000) : null },
          });
        }

        const image = await persistScreenshot(deviceId, command.requestedById, data.result);
        if (image) {
          adminNamespace.emit("screenshot-created", {
            commandId: command.id,
            deviceId,
            screenshotId: image.id,
          });
        }

        adminNamespace.emit("command-completed", {
          commandId: command.id,
          deviceId,
          status: data.status,
        });
      } catch (error) {
        console.error(`Command result error for ${deviceId}:`, error);
      }
    });

    socket.on(
      "live-frame-result",
      (
        payload: Buffer | ArrayBuffer,
        meta?: { mimeType?: string; width?: number; height?: number }
      ) => {
        const buffer = toBuffer(payload);
        if (!buffer) return;
        // Cota por frame: sin ella, un agente comprometido puede mandar buffers enormes a todas las
        // salas de live view conectadas.
        if (buffer.length > config.websocket.maxHttpBufferSize) return;
        // Si ningún panel está escuchando, el frame se descarta sin reserializar ni difundir.
        if (adminNamespace.sockets.size === 0) return;

        adminNamespace.to(`live:${deviceId}`).emit("live-frame", buffer, {
          deviceId,
          mimeType: meta?.mimeType || "image/jpeg",
          width: meta?.width,
          height: meta?.height,
        });
      }
    );

    socket.on("live-frame-error", (data: { error?: string }) => {
      adminNamespace.to(`live:${deviceId}`).emit("live-frame-error", {
        deviceId,
        error: data?.error || "Error capturando la pantalla",
      });
    });

    socket.on("disconnect", async () => {
      console.log(`[AGENT] Disconnected: ${deviceId}`);
      const current = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { status: true },
      });

      if (current && current.status === "ONLINE") {
        await deviceService.logPowerEvent(deviceId, "POWER_OFF", "connection closed");
      }

      await deviceService.setOffline(deviceId);
      adminNamespace.emit("device-status", {
        deviceId,
        status: "OFFLINE",
      });
    });
  });

  const sweeper = setInterval(async () => {
    try {
      await deviceService.markOfflineDevices();
    } catch (error) {
      console.error("markOfflineDevices error:", error);
    }
  }, 60000);
  // Que el intervalo no impida un shutdown limpio del proceso.
  sweeper.unref();

  return io;
}

// Persiste la imagen que reporta el agente, con cota de tamaño y tipo deducido del contenido.
async function persistScreenshot(
  deviceId: string,
  requestedById: string,
  result?: Record<string, unknown>
) {
  const encoded = result?.imageBase64;
  if (typeof encoded !== "string" || encoded.length === 0) return null;

  // 4/3 del base64: la cota se aplica sobre el binario decodificado.
  if (encoded.length > Math.ceil((config.uploads.maxScreenshotBytes * 4) / 3)) {
    console.warn(`[AGENT] ${deviceId} envió una captura que excede la cota; se descarta`);
    return null;
  }

  const buffer = Buffer.from(encoded, "base64");
  const detected = detectImage(buffer);
  if (!detected) {
    console.warn(`[AGENT] ${deviceId} envió un payload que no es PNG/JPEG/WEBP; se descarta`);
    return null;
  }
  if (buffer.length > config.uploads.maxScreenshotBytes) return null;

  const dir = path.resolve(config.uploads.screenshotsDir);
  await fs.promises.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${randomUUID()}.${detected.extension}`);
  await fs.promises.writeFile(filePath, buffer);

  return screenshotService.saveScreenshot({
    deviceId,
    requestedById,
    filePath,
    fileSize: buffer.length,
    mimeType: detected.mimeType,
    width: typeof result?.width === "number" ? result.width : undefined,
    height: typeof result?.height === "number" ? result.height : undefined,
  });
}
