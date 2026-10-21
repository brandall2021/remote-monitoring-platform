import prisma from "../config/database";
import { parsePagination, MAX_PAGE_SIZE } from "../middleware/pagination";
import { badRequest } from "../lib/errors";

function parseDateFilter(value: string, label: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${label} no es una fecha válida`);
  return d;
}

export class AuditService {
  async findAll(
    page: number = 1,
    limit: number = 50,
    filters?: {
      userId?: string;
      action?: string;
      resource?: string;
      startDate?: string;
      endDate?: string;
    }
  ) {
    const bounded = parsePagination({ page, limit });
    const skip = bounded.skip;
    const where: Record<string, unknown> = {};

    if (filters?.userId) where.userId = filters.userId;
    if (filters?.action) where.action = filters.action;
    if (filters?.resource) where.resource = filters.resource;
    if (filters?.startDate || filters?.endDate) {
      const createdAt: Record<string, Date> = {};
      if (filters.startDate) createdAt.gte = parseDateFilter(filters.startDate, "startDate");
      if (filters.endDate) createdAt.lte = parseDateFilter(filters.endDate, "endDate");
      where.createdAt = createdAt;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: Math.min(bounded.limit, MAX_PAGE_SIZE),
        include: {
          user: { select: { username: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        total,
        page: bounded.page,
        limit: bounded.limit,
        pages: Math.ceil(total / bounded.limit),
      },
    };
  }

  async log(data: {
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return prisma.auditLog.create({
      data: {
        ...data,
        details: data.details ? JSON.parse(JSON.stringify(data.details)) : undefined,
      },
    });
  }
}

export const auditService = new AuditService();
