import { Response } from "express";
import { auditService } from "../services/audit.service";
import { AuthRequest } from "../middleware/auth";

export class AuditController {
  async findAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const filters = {
        userId: req.query.userId as string,
        action: req.query.action as string,
        resource: req.query.resource as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };
      const result = await auditService.findAll(page, limit, filters);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export const auditController = new AuditController();
