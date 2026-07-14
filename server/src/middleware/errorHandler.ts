import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (err.name === "ValidationError") {
    res.status(400).json({ error: "Validation error", details: err.message });
    return;
  }

  if (err.name === "UnauthorizedError") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.status(500).json({
    error: "Internal server error",
    ...(process.env.NODE_ENV === "development" && { details: err.message }),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}
