import { Response } from "express";
import { screenshotService } from "../services/screenshot.service";
import { AuthRequest } from "../middleware/auth";

export class ScreenshotController {
  async request(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const { deviceId, reason } = req.body;
      if (!deviceId) {
        res.status(400).json({ error: "deviceId is required" });
        return;
      }

      const command = await screenshotService.request(
        deviceId,
        req.user.userId,
        reason || "No reason provided"
      );

      res.status(201).json(command);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async findAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await screenshotService.findAll(page, limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async findById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const screenshot = await screenshotService.findById(req.params.id);
      res.json(screenshot);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }

  async findByDevice(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await screenshotService.findByDevice(
        req.params.deviceId,
        page,
        limit
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      await screenshotService.delete(req.params.id);
      res.json({ message: "Screenshot deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export const screenshotController = new ScreenshotController();
