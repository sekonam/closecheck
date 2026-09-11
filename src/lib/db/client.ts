import { PrismaClient } from "@prisma/client";

// Standard Next.js dev-mode singleton pattern — avoids exhausting Postgres connections across
// hot-reloads. Never import PrismaClient directly anywhere else; go through this module (or, for
// tenant-owned tables, through `withOrgScope` in ./scoped.ts).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
