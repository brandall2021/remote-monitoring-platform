import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";

export function auditLog(
  action: string,
  resource: string,
  resourceId?: string,
  details?: Record<string, unknown>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      await prisma.auditLog.create({
        data: {
          userId: user?.userId || null,
          action,
          resource,
          resourceId: resourceId || (req.params as any).id || null,
          details: details || { body: req.body, params: req.params },
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
        },
      });
    } catch (error) {
      console.error("Audit log error:", error);
    }
    next();
  };
}
