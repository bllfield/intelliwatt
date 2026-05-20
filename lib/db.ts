import { PrismaClient } from '@prisma/client';

declare global {
  // Prevent multiple instances of PrismaClient in dev
  // (hot reload can cause multiple clients without this)
  var prisma: PrismaClient | undefined;
}

export const db =
  globalThis.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

// Export prisma for backward compatibility
export const prisma = db;

// Reuse one client per serverless instance (dev hot reload + production).
globalThis.prisma = db; 