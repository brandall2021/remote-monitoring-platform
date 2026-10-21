import prisma from "../config/database";
import { hashPassword, comparePassword } from "../security/password";
import { canAssignRole, canManageUser } from "../security/permissions";
import { conflict, forbidden, notFoundError, badRequest } from "../lib/errors";
import { parsePagination } from "../middleware/pagination";

export interface Actor {
  userId: string;
  role: string;
}

const PUBLIC_SELECT = {
  id: true,
  email: true,
  username: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export class UserService {
  private async roleNameOf(userId: string): Promise<string> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: { select: { name: true } } },
    });
    if (!row) throw notFoundError("User not found");
    return row.role.name;
  }

  async findAll(page: number = 1, limit: number = 20) {
    const bounded = parsePagination({ page, limit });
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip: bounded.skip,
        take: bounded.limit,
        select: {
          ...PUBLIC_SELECT,
          role: { select: { id: true, name: true, description: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count(),
    ]);

    return {
      users,
      pagination: {
        total,
        page: bounded.page,
        limit: bounded.limit,
        pages: Math.ceil(total / bounded.limit),
      },
    };
  }

  async findById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        ...PUBLIC_SELECT,
        role: { select: { id: true, name: true, description: true } },
      },
    });
    if (!user) throw notFoundError("User not found");
    return user;
  }

  async create(actor: Actor, data: {
    email: string;
    username: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
  }) {
    // USERS_WRITE autoriza a dar de alta usuarios, no a crear un rol por encima del propio.
    if (!canAssignRole(actor.role, data.role)) {
      throw forbidden(`Un ${actor.role} no puede crear usuarios con rol ${data.role}`);
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: data.email }, { username: data.username }],
      },
    });
    if (existingUser) {
      throw conflict("Email o username ya existe");
    }

    const role = await prisma.role.findFirst({
      where: { name: data.role },
    });
    if (!role) throw badRequest("Rol inválido");

    const passwordHash = await hashPassword(data.password);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        roleId: role.id,
      },
      select: { ...PUBLIC_SELECT, role: { select: { id: true, name: true } } },
    });

    return user;
  }

  async update(
    actor: Actor,
    id: string,
    data: {
      email?: string;
      firstName?: string;
      lastName?: string;
      isActive?: boolean;
      role?: string;
    }
  ) {
    const targetRole = await this.roleNameOf(id);

    // Ni promocionarse, ni desactivar/borrar a un par o a un superior.
    if (!canManageUser(actor.role, targetRole)) {
      throw forbidden(`Un ${actor.role} no puede modificar un usuario ${targetRole}`);
    }
    if (data.role && !canAssignRole(actor.role, data.role)) {
      throw forbidden(`Un ${actor.role} no puede asignar el rol ${data.role}`);
    }
    if (id === actor.userId && data.role && data.role !== actor.role) {
      throw forbidden("No puedes cambiar tu propio rol");
    }
    if (id === actor.userId && data.isActive === false) {
      throw forbidden("No puedes desactivar tu propio usuario");
    }

    const updateData: Record<string, unknown> = { ...data };

    if (data.role) {
      const role = await prisma.role.findFirst({ where: { name: data.role } });
      if (!role) throw badRequest("Rol inválido");
      updateData.roleId = role.id;
      delete updateData.role;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { ...PUBLIC_SELECT, role: { select: { id: true, name: true } } },
    });

    return user;
  }

  async delete(actor: Actor, id: string) {
    if (id === actor.userId) throw forbidden("No puedes eliminar tu propio usuario");
    const targetRole = await this.roleNameOf(id);
    if (!canManageUser(actor.role, targetRole)) {
      throw forbidden(`Un ${actor.role} no puede eliminar un usuario ${targetRole}`);
    }
    await prisma.user.delete({ where: { id } });
  }

  async changePassword(actor: Actor, id: string, newPassword: string) {
    const targetRole = await this.roleNameOf(id);
    // POST /users/:id/password no pedía nada más que USERS_WRITE: con esto un ADMIN le cambió la
    // contraseña al SUPER_ADMIN y tomó el sistema.
    if (!canManageUser(actor.role, targetRole)) {
      throw forbidden(`Un ${actor.role} no puede cambiar la contraseña de un usuario ${targetRole}`);
    }
    if (newPassword.length < 8) throw badRequest("La contraseña debe tener al menos 8 caracteres");

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
    // Cambiar la contraseña invalida las sesiones existentes: si no, el refresh token robado sigue
    // sirviendo aunque la credencial ya no sea válida.
    await prisma.refreshToken.deleteMany({ where: { userId: id } });
  }

  async selfChangePassword(actor: Actor, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user) throw notFoundError("User not found");
    if (!(await comparePassword(currentPassword, user.passwordHash))) {
      throw forbidden("Contraseña actual incorrecta");
    }
    if (newPassword.length < 8) throw badRequest("La contraseña debe tener al menos 8 caracteres");
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    return { message: "Contraseña cambiada" };
  }
}

export const userService = new UserService();
