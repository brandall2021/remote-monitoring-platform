import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors";
import { config } from "../config";

// Mapeo central de errores. La regla: el detalle técnico va al log del server, y al cliente solo
// llega lo que el código marcó explícitamente como público. Antes no existía esa frontera: los
// controladores respondían { error: err.message } con el texto crudo de Prisma o del driver, y
// eso se podía obtener desde /api/devices/register sin ninguna credencial.
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.publicMessage });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation error",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      console.error(`[P2002] ${req.method} ${req.path}`, err.meta);
      res.status(409).json({ error: "Ya existe un registro con esos datos" });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Recurso no encontrado" });
      return;
    }
    console.error(`[Prisma ${err.code}] ${req.method} ${req.path}:`, err.meta);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (err.name === "UnauthorizedError") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  console.error(`[ERROR] ${req.method} ${req.path}:`, err);

  res.status(500).json({
    error: "Internal server error",
    // En desarrollo ayuda; en producción, nada de internals.
    ...(config.nodeEnv === "development" && { details: err.message }),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  // Sin el path en el cuerpo: la 404 ya llega en el status y echoing de URLs facilita sondeo de
  // rutas.
  res.status(404).json({ error: "Route not found" });
}
