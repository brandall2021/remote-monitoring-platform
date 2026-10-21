import prisma from "../config/database";
import path from "path";
import fs from "fs/promises";
import { createReadStream } from "fs";
import { config } from "../config";
import { notFoundError, badRequest } from "../lib/errors";
import { parsePagination } from "../middleware/pagination";

// `filePath` es una ruta absoluta del server: no aporta nada al panel y filtra la estructura del
// filesystem. El contenido se pide por id a /api/screenshots/:id/image.
export function publicRow<T extends { filePath?: string }>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.filePath;
  return copy as T;
}

export class ScreenshotService {
  async request(deviceId: string, requestedById: string, reason: string) {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });
    if (!device) throw notFoundError("Device not found");

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
    mimeType?: string;
    width?: number;
    height?: number;
  }) {
    const screenshot = await prisma.screenshot.create({
      data: {
        deviceId: data.deviceId,
        requestedById: data.requestedById,
        filePath: data.filePath,
        fileSize: data.fileSize,
        // El tipo lo decide el server según los bytes recibidos, no lo que declaró el agente.
        mimeType: data.mimeType || "image/png",
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
    if (!screenshot) throw notFoundError("Screenshot not found");
    return publicRow(screenshot);
  }

  // Reemplaza al antiguo express.static("/uploads/screenshots"), que servía cualquier captura con
  // solo conocer la URL. Aquí la identidad del archivo es un id de base de datos, y la ruta
  // absoluta se resuelve contra el directorio de uploads con verificación de contenido: un
  // filePath contaminado (por un agente comprometido) no puede sacar lectura fuera de ese dir.
  async resolveFile(id: string) {
    const screenshot = await prisma.screenshot.findUnique({ where: { id } });
    if (!screenshot) throw notFoundError("Screenshot not found");

    const dir = path.resolve(config.uploads.screenshotsDir);
    const abs = path.resolve(dir, path.basename(screenshot.filePath));
    const stored = path.resolve(screenshot.filePath);

    if (stored !== abs || !abs.startsWith(dir + path.sep)) {
      throw badRequest("Ruta de archivo inválida");
    }

    return {
      absPath: abs,
      mimeType: screenshot.mimeType || "image/png",
      fileSize: screenshot.fileSize,
      createdAt: screenshot.createdAt,
    };
  }

  openStream(absPath: string) {
    return createReadStream(absPath);
  }

  async findByDevice(deviceId: string, page: number = 1, limit: number = 20) {
    const bounded = parsePagination({ page, limit });
    const skip = bounded.skip;
    const [screenshots, total] = await Promise.all([
      prisma.screenshot.findMany({
        where: { deviceId },
        skip,
        take: bounded.limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.screenshot.count({ where: { deviceId } }),
    ]);

    return {
      screenshots: screenshots.map(publicRow),
      pagination: { total, page: bounded.page, limit: bounded.limit, pages: Math.ceil(total / bounded.limit) },
    };
  }

  async findAll(page: number = 1, limit: number = 20) {
    const bounded = parsePagination({ page, limit });
    const skip = bounded.skip;
    const [screenshots, total] = await Promise.all([
      prisma.screenshot.findMany({
        skip,
        take: bounded.limit,
        include: {
          device: { select: { hostname: true } },
          requestedBy: { select: { username: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.screenshot.count(),
    ]);

    return {
      screenshots: screenshots.map(publicRow),
      pagination: { total, page: bounded.page, limit: bounded.limit, pages: Math.ceil(total / bounded.limit) },
    };
  }

  async delete(id: string) {
    const screenshot = await prisma.screenshot.findUnique({ where: { id } });
    if (!screenshot) return;
    // Borra a través de la misma validación de containment que la lectura.
    const { absPath } = await this.resolveFile(id);
    await fs.unlink(absPath).catch(() => {});
    await prisma.screenshot.delete({ where: { id } });
  }
}

export const screenshotService = new ScreenshotService();
