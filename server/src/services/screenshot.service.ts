import prisma from "../config/database";
import path from "path";
import fs from "fs/promises";
import { config } from "../config";

export class ScreenshotService {
  async request(deviceId: string, requestedById: string, reason: string) {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });
    if (!device) throw new Error("Device not found");

    const command = await prisma.deviceCommand.create({
      data: {
        deviceId,
        requestedById,
        commandType: "SCREENSHOT",
        payload: { reason },
      },
      include: {
        device: { select: { hostname: true } },
        requestedBy: { select: { username: true } },
      },
    });

    return command;
  }

  async saveScreenshot(data: {
    deviceId: string;
    requestedById: string;
    filePath: string;
    fileSize: number;
    width?: number;
    height?: number;
  }) {
    const screenshot = await prisma.screenshot.create({
      data: {
        deviceId: data.deviceId,
        requestedById: data.requestedById,
        filePath: data.filePath,
        fileSize: data.fileSize,
        width: data.width,
        height: data.height,
      },
      include: {
        device: { select: { hostname: true } },
        requestedBy: { select: { username: true } },
      },
    });

    await prisma.deviceEvent.create({
      data: {
        deviceId: data.deviceId,
        eventType: "SCREENSHOT_CAPTURED",
        message: "Screenshot captured",
        userId: data.requestedById,
      },
    });

    return screenshot;
  }

  async findById(id: string) {
    const screenshot = await prisma.screenshot.findUnique({
      where: { id },
      include: {
        device: { select: { hostname: true, id: true } },
        requestedBy: { select: { username: true } },
      },
    });
    if (!screenshot) throw new Error("Screenshot not found");
    return screenshot;
  }

  async findByDevice(deviceId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [screenshots, total] = await Promise.all([
      prisma.screenshot.findMany({
        where: { deviceId },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.screenshot.count({ where: { deviceId } }),
    ]);

    return {
      screenshots,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async findAll(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [screenshots, total] = await Promise.all([
      prisma.screenshot.findMany({
        skip,
        take: limit,
        include: {
          device: { select: { hostname: true } },
          requestedBy: { select: { username: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.screenshot.count(),
    ]);

    return {
      screenshots,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async delete(id: string) {
    const screenshot = await prisma.screenshot.findUnique({ where: { id } });
    if (screenshot) {
      await fs.unlink(screenshot.filePath).catch(() => {});
      await prisma.screenshot.delete({ where: { id } });
    }
  }
}

export const screenshotService = new ScreenshotService();
