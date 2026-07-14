import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  const superAdminRole = await prisma.role.upsert({
    where: { name: "SUPER_ADMIN" },
    update: {},
    create: { name: "SUPER_ADMIN", description: "Super Administrator with full access" },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {},
    create: { name: "ADMIN", description: "Administrator" },
  });

  const operatorRole = await prisma.role.upsert({
    where: { name: "OPERATOR" },
    update: {},
    create: { name: "OPERATOR", description: "Support Operator" },
  });

  console.log("Roles created:", { superAdminRole: superAdminRole.id, adminRole: adminRole.id, operatorRole: operatorRole.id });

  const existingAdmin = await prisma.user.findUnique({
    where: { email: "admin@monitoring.local" },
  });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("admin123", 12);
    const admin = await prisma.user.create({
      data: {
        email: "admin@monitoring.local",
        username: "admin",
        passwordHash,
        firstName: "System",
        lastName: "Administrator",
        roleId: superAdminRole.id,
      },
    });
    console.log("Default admin user created:", admin.email);
  } else {
    console.log("Admin user already exists, skipping...");
  }

  console.log("Seed completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
