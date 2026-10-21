import { Response, NextFunction } from "express";
import prisma from "../config/database";
import { AuthRequest } from "./auth";

// Campos que nunca pueden terminar en la tabla de auditoría, ni siquiera parcialmente.
const REDACTED_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "token",
  "refreshtoken",
  "accesstoken",
  "registrationtoken",
  "passwordhash",
  "secret",
  "imagebase64",
]);

export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => sanitizeForAudit(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Claves sensibles adentro del body: se reemplaza el valor, no la clave, para que el log
      // siga diciendo qué operación se hizo.
      out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? "[redacted]" : sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}…[${value.length} chars]`;
  }
  return value;
}

export interface AuditRecord {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  details?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Punto único de escritura: lo usan el middleware HTTP y los handlers de WebSocket, para que el
// canal en tiempo real deje de ser el agujero por el que las acciones no se registran.
export async function writeAuditLog(record: AuditRecord): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: record.userId ?? null,
        action: record.action,
        resource: record.resource,
        resourceId: record.resourceId ?? null,
        details: (sanitizeForAudit(record.details ?? {}) as object) ?? {},
        ipAddress: record.ipAddress ?? null,
        userAgent: record.userAgent ?? null,
      },
    });
  } catch (error) {
    // Un fallo de auditoría no puede tumbar la operación: se loggea y sigue.
    console.error("Audit log error:", error);
  }
}

// Registra la mutación después de que haya tenido éxito. Antes se logueaba antes de next(), con
// lo que un POST 500 igualmente dejaba un "CREATE" en el historial.
export function auditLog(action: string, resource: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      const id =
        (res.locals?.resourceId as string) ||
        req.params?.id ||
        (req.body as Record<string, unknown> | undefined)?.deviceId ||
        null;

      void writeAuditLog({
        userId: req.user?.userId ?? null,
        action,
        resource,
        resourceId: id ? String(id) : null,
        details: {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          body: sanitizeForAudit(req.body ?? {}),
          params: req.params,
        },
        ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });
    next();
  };
}
