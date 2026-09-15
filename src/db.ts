import { PrismaClient } from '@prisma/client';

/**
 * One client per process. Next dev-server reloads would otherwise open a new
 * pool on every hot reload until Neon refuses connections, so the instance is
 * parked on globalThis outside production — the standard Prisma/Next pattern,
 * and the same reason Inspire does it.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env['PRISMA_LOG'] ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma;
