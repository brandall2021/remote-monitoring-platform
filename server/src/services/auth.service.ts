import prisma from "../config/database";
import { comparePassword } from "../security/password";
import { hashToken } from "../security/tokens";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../security/jwt";
import { Role, JwtPayload } from "../types";
import { unauthorized } from "../lib/errors";

export class AuthService {
  async login(email: string, password: string, ip: string, userAgent: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      throw unauthorized("Credenciales inválidas");
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw unauthorized("Credenciales inválidas");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role.name as Role,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        token: hashToken(refreshToken),
        userId: user.id,
        expiresAt: refreshExpiresAt,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "LOGIN",
        resource: "auth",
        ipAddress: ip,
        userAgent,
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role.name,
      },
      accessToken,
      refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = verifyRefreshToken(refreshToken);

      // Se busca por digesto, no por el token en claro. Las filas anteriores a este cambio están
      // en claro y este lookup ya no las encuentra, así que esas sesiones caen al primer refresh:
      // conviene vaciar la tabla en el deploy (`TRUNCATE refresh_tokens;`) porque de todas formas
      // son tokens de sesión expuestos.
      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: hashToken(refreshToken) },
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        throw unauthorized("Token de sesión no válido");
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { role: true },
      });

      if (!user || !user.isActive) {
        throw unauthorized("Sesión no válida");
      }

      const newPayload: JwtPayload = {
        userId: user.id,
        email: user.email,
        role: user.role.name as Role,
      };

      const newAccessToken = generateAccessToken(newPayload);
      const newRefreshToken = generateRefreshToken(newPayload);

      await prisma.refreshToken.delete({
        where: { id: storedToken.id },
      });

      const refreshExpiresAt = new Date();
      refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7);

      await prisma.refreshToken.create({
        data: {
          token: hashToken(newRefreshToken),
          userId: user.id,
          expiresAt: refreshExpiresAt,
        },
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw unauthorized("Token de sesión no válido");
    }
  }

  async logout(refreshToken: string) {
    await prisma.refreshToken.deleteMany({
      where: { token: hashToken(refreshToken) },
    });
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    return user;
  }
}

export const authService = new AuthService();
