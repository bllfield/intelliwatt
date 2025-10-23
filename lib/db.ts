import { PrismaClient } from '@prisma/client';

declare global {
  // Prevent multiple instances of PrismaClient in dev
  // (hot reload can cause multiple clients without this)
  var prisma: PrismaClient | undefined;
}

export const db = globalThis.prisma || new PrismaClient();

// Export prisma for backward compatibility
export const prisma = db;

if (process.env.NODE_ENV !== 'production') globalThis.prisma = db; 