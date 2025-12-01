import { PrismaClient as AppliancesPrismaClient } from '@/.prisma/appliances-client';

declare global {
  // eslint-disable-next-line no-var
  var appliancesPrisma: AppliancesPrismaClient | undefined;
}

const appliancesClient =
  globalThis.appliancesPrisma ??
  new AppliancesPrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.appliancesPrisma = appliancesClient;
}

export function getAppliancesPrisma() {
  return appliancesClient;
}

export { appliancesClient as appliancesPrisma };

