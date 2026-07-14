import prisma from "../config/database";
import { CommandType, CommandStatus } from "../types";

export class CommandService {
  async create(data: {
    deviceId: string;
    requestedById: string;
    commandType: CommandType;
    payload?: Record<string, unknown>;
  }) {
    const device = await prisma.device.findUnique({
      where: { id: data.deviceId },
    });
    if (!device) throw new Error("Device not found");

    const command = await prisma.deviceCommand.create({
      data: {
        deviceId: data.deviceId,
        requestedById: data.requestedById,
        commandType: data.commandType,
        payload: data.payload || {},
        status: CommandStatus.PENDING,
      },
      include: {
        device: { select: { hostname: true } },
        requestedBy: { select: { username: true } },
      },
    });

    await prisma.deviceEvent.create({
      data: {
        deviceId: data.deviceId,
        eventType: "COMMAND_REQUESTED",
        message: `Command ${data.commandType} requested`,
        userId: data.requestedById,
      },
    });

    return command;
  }

  async approve(commandId: string, approvedById: string) {
    const command = await prisma.deviceCommand.update({
      where: { id: commandId },
      data: {
        status: CommandStatus.APPROVED,
        approvedAt: new Date(),
        approvedById,
      },
      include: { device: true },
    });
    return command;
  }

  async execute(commandId: string, result: Record<string, unknown>) {
    const command = await prisma.deviceCommand.update({
      where: { id: commandId },
      data: {
        status: CommandStatus.EXECUTING,
        executedAt: new Date(),
      },
    });

    try {
      await prisma.deviceCommand.update({
        where: { id: commandId },
        data: {
          status: CommandStatus.COMPLETED,
          result,
        },
      });
    } catch (error) {
      await prisma.deviceCommand.update({
        where: { id: commandId },
        data: {
          status: CommandStatus.FAILED,
          error: String(error),
        },
      });
    }

    return command;
  }

  async reject(commandId: string) {
    const command = await prisma.deviceCommand.update({
      where: { id: commandId },
      data: { status: CommandStatus.REJECTED },
    });
    return command;
  }

  async findByDevice(deviceId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [commands, total] = await Promise.all([
      prisma.deviceCommand.findMany({
        where: { deviceId },
        skip,
        take: limit,
        include: {
          requestedBy: { select: { username: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.deviceCommand.count({ where: { deviceId } }),
    ]);

    return {
      commands,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async findPending(deviceId: string) {
    const commands = await prisma.deviceCommand.findMany({
      where: {
        deviceId,
        status: { in: [CommandStatus.APPROVED] },
      },
      orderBy: { createdAt: "asc" },
    });
    return commands;
  }

  async findAll(page: number = 1, limit: number = 20, status?: CommandStatus) {
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};

    const [commands, total] = await Promise.all([
      prisma.deviceCommand.findMany({
        where,
        skip,
        take: limit,
        include: {
          device: { select: { hostname: true, id: true } },
          requestedBy: { select: { username: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.deviceCommand.count({ where }),
    ]);

    return {
      commands,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }
}

export const commandService = new CommandService();
