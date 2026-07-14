import { Request, Response, NextFunction } from "express";
import { Permission } from "../types";
import { hasPermission } from "../security/permissions";
import { AuthRequest } from "./auth";

export function requirePermission(...permissions: Permission[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const hasAll = permissions.every((p) =>
      hasPermission(req.user!.role, p)
    );
    if (!hasAll) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
