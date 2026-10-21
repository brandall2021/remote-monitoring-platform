import { Response } from "express";
import { userService, Actor } from "../services/user.service";
import { AuthRequest } from "../middleware/auth";
import { asyncHandler, unauthorized } from "../lib/errors";
import { parsePagination } from "../middleware/pagination";
import { z } from "zod";

const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]),
});

const updateUserSchema = z
  .object({
    email: z.string().email().optional(),
    firstName: z.string().min(1).max(60).optional(),
    lastName: z.string().min(1).max(60).optional(),
    isActive: z.boolean().optional(),
    role: z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Body vacío" });

const passwordSchema = z.object({ password: z.string().min(8).max(128) });
const selfPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

// Todo el control de escalada vive en el servicio; el controller solo saca al actor del JWT.
function actor(req: AuthRequest): Actor {
  if (!req.user) throw unauthorized();
  return { userId: req.user.userId, role: req.user.role };
}

export class UserController {
  findAll = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    res.json(await userService.findAll(page, limit));
  });

  findById = asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await userService.findById(req.params.id));
  });

  create = asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = createUserSchema.parse(req.body);
    res.status(201).json(await userService.create(actor(req), body));
  });

  update = asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = updateUserSchema.parse(req.body);
    res.json(await userService.update(actor(req), req.params.id, body));
  });

  delete = asyncHandler(async (req: AuthRequest, res: Response) => {
    await userService.delete(actor(req), req.params.id);
    res.json({ message: "User deleted successfully" });
  });

  changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { password } = passwordSchema.parse(req.body);
    await userService.changePassword(actor(req), req.params.id, password);
    res.json({ message: "Password changed successfully" });
  });

  // Un usuario con permiso de gestión puede cambiar la contraseña de otro, pero no le conviene
  // pasar por ahí para cambiar la suya: este endpoint exige la contraseña actual.
  changeOwnPassword = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { currentPassword, newPassword } = selfPasswordSchema.parse(req.body);
    res.json(await userService.selfChangePassword(actor(req), currentPassword, newPassword));
  });
}

export const userController = new UserController();
