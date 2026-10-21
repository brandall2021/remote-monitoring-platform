import { Response } from "express";
import { Request } from "express";
import { config } from "../config";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// El refresh token vive solo en una cookie HttpOnly: el JavaScript de la SPA no puede leerla, así
// que un XSS ya no exporta una sesión de 7 días. El access token (15 min) queda en memoria del
// cliente y viaja por header.
//
// Path=/api/auth limita dónde se envía: ningún otro endpoint del server la necesita.
export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(config.cookies.refreshName, refreshToken, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    path: "/api/auth",
    maxAge: SEVEN_DAYS_MS,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(config.cookies.refreshName, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    path: "/api/auth",
  });
}

export function readRefreshCookie(req: Request): string | undefined {
  const fromCookie = (req as { cookies?: Record<string, string> }).cookies?.[
    config.cookies.refreshName
  ];
  if (fromCookie) return fromCookie;
  // Compatibilidad para clientes antiguos (agente de pruebas, scripts) mientras se migra.
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  return typeof fromBody === "string" && fromBody.length > 0 ? fromBody : undefined;
}
