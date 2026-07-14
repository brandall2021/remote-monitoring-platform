import { Request, Response } from "express";
import { authService } from "../services/auth.service";
import { AuthRequest } from "../middleware/auth";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

export class AuthController {
  async login(req: Request, res: Response): Promise<void> {
    try {
      const body = loginSchema.parse(req.body);
      const result = await authService.login(
        body.email,
        body.password,
        req.ip || req.socket.remoteAddress || "",
        req.headers["user-agent"] || ""
      );
      res.json(result);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Validation error", details: error.errors });
        return;
      }
      res.status(401).json({ error: error.message });
    }
  }

  async refresh(req: Request, res: Response): Promise<void> {
    try {
      const body = refreshSchema.parse(req.body);
      const result = await authService.refresh(body.refreshToken);
      res.json(result);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Validation error", details: error.errors });
        return;
      }
      res.status(401).json({ error: error.message });
    }
  }

  async logout(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;
      if (refreshToken) {
        await authService.logout(refreshToken);
      }
      res.json({ message: "Logged out successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async profile(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const profile = await authService.getProfile(req.user.userId);
      res.json(profile);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export const authController = new AuthController();
