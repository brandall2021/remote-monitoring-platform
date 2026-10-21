import { Request, Response } from "express";
import { deviceService } from "../services/device.service";
import { AuthRequest } from "../middleware/auth";
import { DeviceRole, DeviceStatus } from "../types";
import { config } from "../config";
import { safeCompare } from "../security/tokens";
import { asyncHandler, forbidden, badRequest } from "../lib/errors";
import { parsePagination } from "../middleware/pagination";
import { z } from "zod";

const updateDeviceSchema = z.object({
  role: z.enum([DeviceRole.ASESOR, DeviceRole.SUPERVISOR]).optional(),
  alias: z.string().trim().max(120).nullable().optional(),
});

// El body de /register venía directo a prisma.device.create sin esquema: el agente podía fijar
// cualquier campo, incluido status. Se declara qué acepta el endpoint y nada más.
const registerSchema = z.object({
  hostname: z.string().trim().min(1).max(120),
  operatingSystem: z.string().trim().min(1).max(120),
  osVersion: z.string().trim().max(120).optional(),
  ipAddress: z.string().trim().min(1).max(64),
  macAddress: z.string().trim().max(64).optional(),
  platform: z.string().trim().min(1).max(40),
  agentVersion: z.string().trim().max(40).default("unknown"),
  registrationToken: z.string().min(16),
});

export class DeviceController {
  findAll = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status as DeviceStatus | undefined;
    res.json(await deviceService.findAll(page, limit, status));
  });

  findById = asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await deviceService.findById(req.params.id));
  });

  getStats = asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await deviceService.getStats());
  });

  register = asyncHandler(async (req: Request, res: Response) => {
    const body = registerSchema.parse(req.body);

    // safeCompare: con !== el server respondía antes de terminar la comparación, y eso deja
    // filtrar el token de onboarding por temporización desde la red.
    if (!safeCompare(body.registrationToken, config.agent.registrationToken)) {
      throw forbidden("Invalid registration token");
    }

    // El token compartido es solo credencial de alta: no se persiste en la fila, se guarda el
    // generado acá, único por dispositivo.
    const { registrationToken: _onboardingToken, ...deviceData } = body;
    const device = await deviceService.register(deviceData);
    res.status(201).json(device);
  });

  delete = asyncHandler(async (req: AuthRequest, res: Response) => {
    await deviceService.delete(req.params.id);
    res.json({ message: "Device deleted successfully" });
  });

  update = asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = updateDeviceSchema.parse(req.body);
    res.json(await deviceService.update(req.params.id, body));
  });
}

export const deviceController = new DeviceController();
