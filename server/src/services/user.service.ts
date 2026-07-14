import prisma from "../config/database";
import { hashPassword } from "../security/password";
import { Role } from "../types";

export class UserService {
  async findAll(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        include: { role: true },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count(),
    ]);

    return {
      users,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { role: true },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new Error("User not found");
    return user;
  }

  async create(data: {
    email: string;
    username: string;
    password: string;
    firstName: string;
    lastName: string;
    role: Role;
  }) {
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: data.email }, { username: data.username }],
      },
    });
    if (existingUser) {
      throw new Error("Email or username already exists");
    }

    const role = await prisma.role.findFirst({
      where: { name: data.role },
    });
    if (!role) throw new Error("Invalid role");

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
      include: { role: true },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return user;
  }

  async update(
    id: string,
    data: {
      email?: string;
      firstName?: string;
      lastName?: string;
      isActive?: boolean;
      role?: Role;
    }
  ) {
    const updateData: Record<string, any> = { ...data };

    if (data.role) {
      const role = await prisma.role.findFirst({
        where: { name: data.role },
      });
      if (!role) throw new Error("Invalid role");
      updateData.roleId = role.id;
      delete updateData.role;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { role: true },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return user;
  }

  async delete(id: string) {
    await prisma.user.delete({ where: { id } });
  }

  async changePassword(id: string, newPassword: string) {
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }
}

export const userService = new UserService();
