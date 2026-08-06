import { Response } from "express";
import { deviceService } from "../services/device.service";
import { AuthRequest } from "../middleware/auth";
import { DeviceRole, DeviceStatus } from "../types";
import { config } from "../config";
import { z } from "zod";

const updateDeviceSchema = z.object({
  role: z.enum([DeviceRole.ASESOR, DeviceRole.SUPERVISOR]),
});

export class DeviceController {
  async findAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as DeviceStatus | undefined;
      const result = await deviceService.findAll(page, limit, status);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async findById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const device = await deviceService.findById(req.params.id);
      res.json(device);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }

  async getStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const stats = await deviceService.getStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async register(req: Request, res: Response): Promise<void> {
    try {
      const { registrationToken } = req.body;
      if (registrationToken !== config.agent.registrationToken) {
        res.status(403).json({ error: "Invalid registration token" });
        return;
      }

      const device = await deviceService.register(req.body);
      res.status(201).json(device);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      await deviceService.delete(req.params.id);
      res.json({ message: "Device deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const body = updateDeviceSchema.parse(req.body);
      const device = await deviceService.updateRole(req.params.id, body.role);
      res.json(device);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Validation error", details: error.errors });
        return;
      }
      res.status(400).json({ error: error.message });
    }
  }
}

import { Request } from "express";

export const deviceController = new DeviceController();
