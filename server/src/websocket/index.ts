import { Server as SocketIOServer, Namespace, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { verifyAccessToken } from "../security/jwt";
import { deviceService } from "../services/device.service";
import { commandService } from "../services/command.service";
import { screenshotService } from "../services/screenshot.service";
import prisma from "../config/database";
import { config } from "../config";
import { CommandType } from "../types";

interface AgentSocket extends Socket {
  deviceId?: string;
  isAdmin?: boolean;
  userId?: string;
}

let agentNamespace: Namespace | null = null;

export function emitCommandToAgent(
  deviceId: string,
  commandId: string,
  type: string,
  payload?: Record<string, unknown>
): void {
  if (!agentNamespace) return;
  agentNamespace.to(deviceId).emit("command", { commandId, type, payload });
}

export function setupWebSocket(server: HttpServer): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: config.cors.origin,
      methods: ["GET", "POST"],
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  const adminNamespace = io.of("/admin");
  const agentNs = io.of("/agent");
  agentNamespace = agentNs;

  adminNamespace.use(async (socket: AgentSocket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(" ")[1];
      if (!token) {
        return next(new Error("Authentication required"));
      }
      const payload = verifyAccessToken(token);
      socket.userId = payload.userId;
      socket.isAdmin = true;
      next();
    } catch (error) {
      next(new Error("Invalid token"));
    }
  });

  agentNs.use(async (socket: AgentSocket, next) => {
    try {
      const { deviceId, token } = socket.handshake.auth;
      if (!deviceId || !token) {
        return next(new Error("Device ID and token required"));
      }

      const device = await prisma.device.findUnique({
        where: { id: deviceId },
      });

      if (!device || device.registrationToken !== token) {
        return next(new Error("Invalid device credentials"));
      }

      socket.deviceId = deviceId;
      next();
    } catch (error) {
      next(new Error("Authentication failed"));
    }
  });

  adminNamespace.on("connection", (socket: AgentSocket) => {
    console.log(`[ADMIN] Connected: ${socket.userId}`);

    socket.on("request-screenshot", async (data: { deviceId: string; reason?: string }) => {
      try {
        if (!socket.userId) return;

        const command = await screenshotService.request(
          data.deviceId,
          socket.userId,
          data.reason || "Admin requested screenshot"
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
      } catch (error: any) {
        socket.emit("error", { message: error.message });
      }
    });

    socket.on("send-command", async (data: {
      deviceId: string;
      commandType: CommandType;
      payload?: Record<string, unknown>;
    }) => {
      try {
        if (!socket.userId) return;

        const command = await commandService.create({
          deviceId: data.deviceId,
          requestedById: socket.userId,
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
      } catch (error: any) {
        socket.emit("error", { message: error.message });
      }
    });

    socket.on("live-view-frame", (data: { deviceId?: string }) => {
      if (!socket.userId || !data?.deviceId) return;
      socket.join(`live:${data.deviceId}`);
      agentNs.to(data.deviceId).emit("live-command");
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

    await deviceService.heartbeat(deviceId, socket.handshake.auth.agentVersion || "unknown");

    adminNamespace.emit("device-status", {
      deviceId,
      status: "ONLINE",
    });

    socket.on("heartbeat", async (data: { agentVersion: string }) => {
      try {
        await deviceService.heartbeat(deviceId, data.agentVersion);
        adminNamespace.emit("device-status", {
          deviceId,
          status: "ONLINE",
        });
      } catch (error) {
        console.error(`Heartbeat error for ${deviceId}:`, error);
      }
    });

    socket.on("command-result", async (data: {
      commandId: string;
      status: "COMPLETED" | "FAILED";
      result?: Record<string, unknown>;
      error?: string;
    }) => {
      try {
        if (data.status === "COMPLETED") {
          await commandService.execute(data.commandId, data.result || {});
        } else {
          await prisma.deviceCommand.update({
            where: { id: data.commandId },
            data: { status: "FAILED", error: data.error },
          });
        }

        if (data.result && "imageBase64" in data.result) {
          const fs = require("fs");
          const path = require("path");
          const { v4: uuidv4 } = require("uuid");

          const screenshotsDir = config.uploads.screenshotsDir;
          fs.mkdirSync(screenshotsDir, { recursive: true });

          const filename = `${uuidv4()}.png`;
          const filePath = path.join(screenshotsDir, filename);

          const imageBuffer = Buffer.from(data.result.imageBase64 as string, "base64");
          fs.writeFileSync(filePath, imageBuffer);

          const command = await prisma.deviceCommand.findUnique({
            where: { id: data.commandId },
          });

          if (command) {
            await screenshotService.saveScreenshot({
              deviceId,
              requestedById: command.requestedById,
              filePath,
              fileSize: imageBuffer.length,
              width: (data.result as any).width,
              height: (data.result as any).height,
            });
          }
        }

        adminNamespace.emit("command-completed", {
          commandId: data.commandId,
          deviceId,
          status: data.status,
        });
      } catch (error: any) {
        console.error(`Command result error for ${deviceId}:`, error);
      }
    });

    socket.on("live-frame-result", (data: {
      imageBase64?: string;
      width?: number;
      height?: number;
    }) => {
      if (!data?.imageBase64) return;
      adminNamespace.to(`live:${deviceId}`).emit("live-frame", {
        deviceId,
        imageBase64: data.imageBase64,
        width: data.width,
        height: data.height,
      });
    });

    socket.on("live-frame-error", (data: { error?: string }) => {
      adminNamespace.to(`live:${deviceId}`).emit("live-frame-error", {
        deviceId,
        error: data?.error || "Error capturando la pantalla",
      });
    });

    socket.on("disconnect", async () => {
      console.log(`[AGENT] Disconnected: ${deviceId}`);
      await deviceService.setOffline(deviceId);
      adminNamespace.emit("device-status", {
        deviceId,
        status: "OFFLINE",
      });
    });
  });

  setInterval(async () => {
    await deviceService.markOfflineDevices();
  }, 60000);

  return io;
}
