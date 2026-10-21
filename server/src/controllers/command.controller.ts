import { Response } from "express";
import { commandService } from "../services/command.service";
import { AuthRequest } from "../middleware/auth";
import { CommandType, CommandStatus } from "../types";
import { asyncHandler, badRequest, forbidden } from "../lib/errors";
import { parsePagination } from "../middleware/pagination";
import { ALLOWED_COMMAND_TYPES, isAllowedCommandType } from "../websocket/commandPolicy";
import { z } from "zod";

const createSchema = z.object({
  deviceId: z.string().min(1),
  commandType: z.enum(ALLOWED_COMMAND_TYPES as unknown as [CommandType, ...CommandType[]]),
  payload: z.record(z.unknown()).optional(),
});

export class CommandController {
  findAll = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status as CommandStatus | undefined;
    res.json(await commandService.findAll(page, limit, status));
  });

  findByDevice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    res.json(await commandService.findByDevice(req.params.deviceId, page, limit));
  });

  getPending = asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await commandService.findPending(req.params.deviceId));
  });

  create = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) throw forbidden("No autenticado");
    const body = createSchema.parse(req.body);
    if (!isAllowedCommandType(body.commandType)) throw badRequest("Tipo de comando inválido");

    const command = await commandService.create({
      deviceId: body.deviceId,
      requestedById: req.user.userId,
      commandType: body.commandType,
      payload: body.payload as Record<string, unknown> | undefined,
    });
    res.status(201).json(command);
  });

  approve = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) throw badRequest("No autenticado");
    res.json(await commandService.approve(req.params.id, req.user.userId));
  });

  reject = asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await commandService.reject(req.params.id));
  });
}

export const commandController = new CommandController();
