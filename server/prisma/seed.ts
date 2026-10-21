import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const SEED_ADMIN_EMAIL = "admin@monitoring.local";

export const MIN_SEED_PASSWORD_LENGTH = 12;

// El seed corre en el CMD del contenedor, en cada arranque. Si pisara la contraseña del usuario
// existente, cualquier cambio de credencial se revertiría solo con un restart: el hash público de
// este repo ("admin123") volvería a ser válido para siempre.
//
// Reglas: se crea el usuario la primera vez y después NUNCA se toca su passwordHash. Los datos de
// perfil sí se reconcilian, porque no son sensibles.
//
// Interfaz mínima en vez de PrismaClient: deja probar estas reglas con un client falso, que es la
// única forma de cubrir en CI la regresión del reseteo de contraseña.
export interface SeedClient {
  role: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  user: {
    findUnique(args: unknown): Promise<{ id: string; email: string } | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<{ id: string; email: string }>;
  };
}

export function resolveInitialPassword(env: Record<string, string | undefined>): string {
  const configured = env.SEED_ADMIN_PASSWORD;
  if (configured === undefined || configured === "") {
    // Aleatorio y efímero: se imprime una sola vez, no queda en la imagen ni en el repo.
    return crypto.randomBytes(12).toString("base64url");
  }
  if (configured.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD debe tener al menos ${MIN_SEED_PASSWORD_LENGTH} caracteres.`);
  }
  return configured;
}

export async function runSeed(
  prisma: SeedClient,
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = (line) => console.log(line)
): Promise<"reconciled" | "created"> {
  log("Seeding database...");

  const roles = [
    { name: "SUPER_ADMIN", description: "Super Administrator with full access" },
    { name: "ADMIN", description: "Administrator" },
    { name: "OPERATOR", description: "Support Operator" },
  ];

  let superAdminRoleId = "";
  for (const role of roles) {
    const saved = await prisma.role.upsert({ where: { name: role.name }, update: {}, create: role });
    if (role.name === "SUPER_ADMIN") superAdminRoleId = saved.id;
  }

  const existing = await prisma.user.findUnique({
    where: { email: SEED_ADMIN_EMAIL },
    select: { id: true, email: true },
  });

  if (existing) {
    // Sin passwordHash en el data: es exactamente el campo que borraba el fix de C-1.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        username: "admin",
        firstName: "System",
        lastName: "Administrator",
      },
    });
    log(`Usuario admin preexistente (${existing.email}): contraseña intacta, nada que reportar.`);
    log("Seed completed!");
    return "reconciled";
  }

  const password = resolveInitialPassword(env);

  const admin = await prisma.user.create({
    data: {
      email: SEED_ADMIN_EMAIL,
      username: "admin",
      passwordHash: await bcrypt.hash(password, 12),
      firstName: "System",
      lastName: "Administrator",
      roleId: superAdminRoleId,
    },
    select: { id: true, email: true },
  });

  log(`Usuario superadmin creado: ${admin.email}`);
  if (env.SEED_ADMIN_PASSWORD) {
    log("Contraseña: la provista por SEED_ADMIN_PASSWORD.");
  } else {
    // Se muestra una sola vez, en el primer arranque. No se guarda en la imagen ni en la base.
    log("=== CONTRASEÑA INICIAL DEL SUPERADMIN (único momento en que se imprime) ===");
    log(password);
    log("Guárdala ahora y cambiala desde el panel.");
  }

  log("Seed completed!");
  return "created";
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await runSeed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
