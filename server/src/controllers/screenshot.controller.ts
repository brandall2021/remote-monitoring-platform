import { Response } from "express";
import { createReadStream } from "fs";
import { screenshotService } from "../services/screenshot.service";
import { emitCommandToAgent } from "../websocket";
import { AuthRequest } from "../middleware/auth";
import { parsePagination } from "../middleware/pagination";
import { asyncHandler, badRequest, notFoundError } from "../lib/errors";
import { z } from "zod";
import fs from "fs";

const requestSchema = z.object({
  deviceId: z.string().min(1),
  reason: z.string().max(300).optional(),
});

export class ScreenshotController {
  request = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) throw badRequest("No autenticado");

    const { deviceId, reason } = requestSchema.parse(req.body);

    const command = await screenshotService.request(
      deviceId,
      req.user.userId,
      reason || "No reason provided"
    );

    emitCommandToAgent(
      deviceId,
      command.id,
      "SCREENSHOT",
      command.payload as Record<string, unknown> | undefined
    );

    res.status(201).json(command);
  });

  findAll = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    res.json(await screenshotService.findAll(page, limit));
  });

  findById = asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await screenshotService.findById(req.params.id));
  });

  findByDevice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    res.json(await screenshotService.findByDevice(req.params.deviceId, page, limit));
  });

  // Único camino para ver el contenido de una captura. Requiere el permiso SCREENSHOTS_VIEW y
  // resuelve la ruta dentro del directorio de uploads; el viejo mount estático de
  // /uploads/screenshots queda eliminado.
  image = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { absPath, mimeType, createdAt } = await screenshotService.resolveFile(req.params.id);

    if (!(await fs.promises.access(absPath).then(() => true).catch(() => false))) {
      throw notFoundError("Archivo no disponible");
    }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${req.params.id}"`);
    // private: un proxy compartido no puede cachear el escritorio de un empleado.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Last-Modified", createdAt.toUTCString());
    res.setHeader("X-Content-Type-Options", "nosniff");

    const stream = createReadStream(absPath);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).json({ error: "No se pudo leer el archivo" });
      else res.destroy();
    });
    stream.pipe(res);
  });

  delete = asyncHandler(async (req: AuthRequest, res: Response) => {
    await screenshotService.delete(req.params.id);
    res.json({ message: "Screenshot deleted successfully" });
  });
}

export const screenshotController = new ScreenshotController();
