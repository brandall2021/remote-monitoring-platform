import { Request, Response } from "express";
import { authService } from "../services/auth.service";
import { AuthRequest } from "../middleware/auth";
import { asyncHandler, unauthorized } from "../lib/errors";
import { readRefreshCookie, setRefreshCookie, clearRefreshCookie } from "../lib/cookies";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
});

export class AuthController {
  // El refreshToken ya no se devuelve en el JSON: se entrega solo como cookie HttpOnly. Un XSS en
  // la SPA pierde así la capacidad de exportar una sesión de 7 días.
  login = asyncHandler(async (req: Request, res: Response) => {
    const body = loginSchema.parse(req.body);
    const { refreshToken, ...result } = await authService.login(
      body.email,
      body.password,
      req.ip || req.socket.remoteAddress || "",
      req.headers["user-agent"] || ""
    );
    setRefreshCookie(res, refreshToken);
    res.json(result);
  });

  refresh = asyncHandler(async (req: Request, res: Response) => {
    const token = readRefreshCookie(req);
    if (!token) throw unauthorized("Sesión no válida");

    const { refreshToken, ...result } = await authService.refresh(token);
    setRefreshCookie(res, refreshToken);
    res.json(result);
  });

  logout = asyncHandler(async (req: Request, res: Response) => {
    const token = readRefreshCookie(req);
    if (token) await authService.logout(token);
    clearRefreshCookie(res);
    res.json({ message: "Logged out successfully" });
  });

  profile = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) throw unauthorized();
    res.json(await authService.getProfile(req.user.userId));
  });
}

export const authController = new AuthController();
