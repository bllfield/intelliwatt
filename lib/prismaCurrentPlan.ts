import { PrismaClient as CurrentPlanPrismaClient, Prisma } from '@prisma/current-plan-client';

declare global {
  // eslint-disable-next-line no-var
  var currentPlanPrisma: CurrentPlanPrismaClient | undefined;
}

const createClient = () =>
  new CurrentPlanPrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

export const currentPlanDb =
  globalThis.currentPlanPrisma ??
  createClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.currentPlanPrisma = currentPlanDb;
}

export { Prisma as CurrentPlanPrisma };

export function getCurrentPlanPrisma() {
  return currentPlanDb;
}

