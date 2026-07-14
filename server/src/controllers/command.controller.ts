import { Response } from "express";
import { commandService } from "../services/command.service";
import { AuthRequest } from "../middleware/auth";
import { CommandType, CommandStatus } from "../types";

export class CommandController {
  async findAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as CommandStatus | undefined;
      const result = await commandService.findAll(page, limit, status);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async findByDevice(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await commandService.findByDevice(
        req.params.deviceId,
        page,
        limit
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const { deviceId, commandType, payload } = req.body;
      if (!deviceId || !commandType) {
        res.status(400).json({ error: "deviceId and commandType are required" });
        return;
      }

      if (!Object.values(CommandType).includes(commandType)) {
        res.status(400).json({ error: "Invalid command type" });
        return;
      }

      const command = await commandService.create({
        deviceId,
        requestedById: req.user.userId,
        commandType,
        payload,
      });

      res.status(201).json(command);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async approve(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const command = await commandService.approve(
        req.params.id,
        req.user.userId
      );
      res.json(command);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async reject(req: AuthRequest, res: Response): Promise<void> {
    try {
      const command = await commandService.reject(req.params.id);
      res.json(command);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getPending(req: AuthRequest, res: Response): Promise<void> {
    try {
      const commands = await commandService.findPending(req.params.deviceId);
      res.json(commands);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export const commandController = new CommandController();
