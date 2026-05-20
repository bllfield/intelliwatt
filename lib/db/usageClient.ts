import { PrismaClient as UsagePrismaClient } from '../../.prisma/usage-client';

declare global {
  // eslint-disable-next-line no-var
  var usagePrisma: UsagePrismaClient | undefined;
}

const usageClient =
  globalThis.usagePrisma ??
  new UsagePrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

globalThis.usagePrisma = usageClient;

export function getUsagePrisma() {
  return usageClient;
}

export { usageClient as usagePrisma };

