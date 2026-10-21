import crypto from "crypto";
import prisma from "../config/database";
import { DeviceRole, DeviceStatus } from "../types";
import { config } from "../config";
import { notFoundError } from "../lib/errors";
import { parsePagination } from "../middleware/pagination";

// El registrationToken por dispositivo es la credencial con la que un agente se autentica por
// WebSocket: quien la tiene, ES ese equipo. Por eso ninguna lectura destinada al panel la devuelve.
// El único lugar donde sale del server es la respuesta de /register, al agente que recién se creó.
export const DEVICE_PUBLIC_SELECT = {
  id: true,
  hostname: true,
  alias: true,
  agentVersion: true,
  operatingSystem: true,
  osVersion: true,
  ipAddress: true,
  macAddress: true,
  platform: true,
  role: true,
  status: true,
  lastSeenAt: true,
  registeredAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class DeviceService {
  async findAll(page: number = 1, limit: number = 20, status?: DeviceStatus) {
    const bounded = parsePagination({ page, limit });
    const where = status ? { status } : {};

    const [devices, total] = await Promise.all([
      prisma.device.findMany({
        where,
        skip: bounded.skip,
        take: bounded.limit,
        select: {
          ...DEVICE_PUBLIC_SELECT,
          _count: { select: { commands: true, screenshots: true } },
        },
        orderBy: { lastSeenAt: "desc" },
      }),
      prisma.device.count({ where }),
    ]);

    return {
      devices,
      pagination: {
        total,
        page: bounded.page,
        limit: bounded.limit,
        pages: Math.ceil(total / bounded.limit),
      },
    };
  }

  async findById(id: string) {
    const device = await prisma.device.findUnique({
      where: { id },
      select: {
        ...DEVICE_PUBLIC_SELECT,
        commands: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { requestedBy: { select: { username: true } } },
        },
        screenshots: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            deviceId: true,
            requestedById: true,
            fileSize: true,
            mimeType: true,
            width: true,
            height: true,
            createdAt: true,
          },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!device) throw notFoundError("Device not found");
    return device;
  }

  async register(data: {
    hostname: string;
    operatingSystem: string;
    osVersion?: string;
    ipAddress: string;
    macAddress?: string;
    platform: string;
    agentVersion: string;
  }) {
    // Token unico por dispositivo: se genera en el server y se devuelve al
    // agente para la autenticacion por WebSocket. El registrationToken que
    // llega es el token compartido de onboarding (AGENT_REGISTRATION_TOKEN),
    // validado en el controller. Esto permite registrar N equipos con el mismo
    // token de onboarding sin violar la restriccion unica de la tabla.
    const deviceToken = crypto.randomBytes(24).toString("base64url");

    const device = await prisma.device.create({
      data: {
        hostname: data.hostname,
        operatingSystem: data.operatingSystem,
        osVersion: data.osVersion,
        ipAddress: data.ipAddress,
        macAddress: data.macAddress,
        platform: data.platform,
        agentVersion: data.agentVersion,
        registrationToken: deviceToken,
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
      },
      select: { ...DEVICE_PUBLIC_SELECT, registrationToken: true },
    });

    await prisma.deviceEvent.create({
      data: {
        deviceId: device.id,
        eventType: "REGISTERED",
        message: `Device registered: ${data.hostname}`,
      },
    });

    await this.logPowerEvent(device.id, "POWER_ON");

    return device;
  }

  async update(id: string, data: { role?: DeviceRole; alias?: string | null }) {
    return prisma.device.update({
      where: { id },
      data,
      select: DEVICE_PUBLIC_SELECT,
    });
  }

  async logPowerEvent(
    deviceId: string,
    eventType: "POWER_ON" | "POWER_OFF",
    reason?: string
  ) {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, hostname: true, ipAddress: true },
    });
    if (!device) return;

    const turnedOn = eventType === "POWER_ON";
    const message = turnedOn
      ? `Equipo encendido: ${device.hostname}`
      : `Equipo apagado: ${device.hostname}${reason ? ` (${reason})` : ""}`;

    await Promise.all([
      prisma.auditLog.create({
        data: {
          action: eventType,
          resource: "device",
          resourceId: device.id,
          details: {
            hostname: device.hostname,
            ipAddress: device.ipAddress,
            reason,
          },
        },
      }),
      prisma.deviceEvent.create({
        data: {
          deviceId: device.id,
          eventType,
          message,
          data: { reason },
        },
      }),
    ]);
  }

  async heartbeat(deviceId: string, agentVersion: string) {
    const device = await prisma.device.update({
      where: { id: deviceId },
      data: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
        agentVersion,
      },
      select: DEVICE_PUBLIC_SELECT,
    });
    return device;
  }

  async setOffline(deviceId: string) {
    const device = await prisma.device.update({
      where: { id: deviceId },
      data: { status: DeviceStatus.OFFLINE },
      select: DEVICE_PUBLIC_SELECT,
    });
    return device;
  }

  async markOfflineDevices() {
    // Antes tenía 5 min fijos contra un heartbeat de 30 s; ahora es configurable y tolera 3 latidos.
    const cutoff = new Date(Date.now() - config.websocket.offlineAfterMs);
    const stale = await prisma.device.findMany({
      where: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: { lt: cutoff },
      },
      select: { id: true },
    });

    for (const device of stale) {
      await this.logPowerEvent(device.id, "POWER_OFF", "heartbeat timeout");
    }

    await prisma.device.updateMany({
      where: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: { lt: cutoff },
      },
      data: { status: DeviceStatus.OFFLINE },
    });
  }

  async delete(id: string) {
    // Los screenshots viven en disco y la FK es Cascade: borrar la fila sin limpiar el archivo
    // deja capturas de escritorio huérfanas en el servidor para siempre.
    const shots = await prisma.screenshot.findMany({
      where: { deviceId: id },
      select: { id: true, filePath: true },
    });
    const { rm } = await import("fs/promises");
    for (const shot of shots) {
      await rm(shot.filePath, { force: true }).catch(() => {});
    }
    await prisma.device.delete({ where: { id } });
  }

  async getStats() {
    const [total, online, offline] = await Promise.all([
      prisma.device.count(),
      prisma.device.count({ where: { status: DeviceStatus.ONLINE } }),
      prisma.device.count({ where: { status: DeviceStatus.OFFLINE } }),
    ]);

    const recentCommands = await prisma.deviceCommand.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    const recentScreenshots = await prisma.screenshot.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    return { total, online, offline, recentCommands, recentScreenshots };
  }
}

export const deviceService = new DeviceService();
