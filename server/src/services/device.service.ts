import prisma from "../config/database";
import { DeviceStatus } from "../types";

export class DeviceService {
  async findAll(
    page: number = 1,
    limit: number = 20,
    status?: DeviceStatus
  ) {
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};

    const [devices, total] = await Promise.all([
      prisma.device.findMany({
        where,
        skip,
        take: limit,
        include: {
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
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string) {
    const device = await prisma.device.findUnique({
      where: { id },
      include: {
        commands: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { requestedBy: { select: { username: true } } },
        },
        screenshots: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!device) throw new Error("Device not found");
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
    registrationToken: string;
  }) {
    const device = await prisma.device.create({
      data: {
        hostname: data.hostname,
        operatingSystem: data.operatingSystem,
        osVersion: data.osVersion,
        ipAddress: data.ipAddress,
        macAddress: data.macAddress,
        platform: data.platform,
        agentVersion: data.agentVersion,
        registrationToken: data.registrationToken,
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
      },
    });

    await prisma.deviceEvent.create({
      data: {
        deviceId: device.id,
        eventType: "REGISTERED",
        message: `Device registered: ${data.hostname}`,
      },
    });

    return device;
  }

  async heartbeat(deviceId: string, agentVersion: string) {
    const device = await prisma.device.update({
      where: { id: deviceId },
      data: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
        agentVersion,
      },
    });
    return device;
  }

  async setOffline(deviceId: string) {
    const device = await prisma.device.update({
      where: { id: deviceId },
      data: { status: DeviceStatus.OFFLINE },
    });
    return device;
  }

  async markOfflineDevices() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.device.updateMany({
      where: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: { lt: fiveMinutesAgo },
      },
      data: { status: DeviceStatus.OFFLINE },
    });
  }

  async delete(id: string) {
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
