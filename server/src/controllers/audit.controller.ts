import { Response } from "express";
import { auditService } from "../services/audit.service";
import { AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../lib/errors";
import { parsePagination } from "../middleware/pagination";

export class AuditController {
  findAll = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = parsePagination({
      page: req.query.page as string,
      limit: (req.query.limit as string) || "50",
    });
    const filters = {
      userId: req.query.userId as string,
      action: req.query.action as string,
      resource: req.query.resource as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    };
    res.json(await auditService.findAll(page, limit, filters));
  });
}

export const auditController = new AuditController();
