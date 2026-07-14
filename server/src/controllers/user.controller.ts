import { Response } from "express";
import { userService } from "../services/user.service";
import { AuthRequest } from "../middleware/auth";
import { z } from "zod";

const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]).optional(),
});

export class UserController {
  async findAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await userService.findAll(page, limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async findById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = await userService.findById(req.params.id);
      res.json(user);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }

  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = createUserSchema.parse(req.body);
      const user = await userService.create(body);
      res.status(201).json(user);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Validation error", details: error.errors });
        return;
      }
      res.status(400).json({ error: error.message });
    }
  }

  async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = updateUserSchema.parse(req.body);
      const user = await userService.update(req.params.id, body);
      res.json(user);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Validation error", details: error.errors });
        return;
      }
      res.status(400).json({ error: error.message });
    }
  }

  async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      await userService.delete(req.params.id);
      res.json({ message: "User deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async changePassword(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { password } = req.body;
      if (!password || password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }
      await userService.changePassword(req.params.id, password);
      res.json({ message: "Password changed successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export const userController = new UserController();
