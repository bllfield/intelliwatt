import { PrismaClient as UpgradesPrismaClient } from '../../.prisma/upgrades-client';

declare global {
  // eslint-disable-next-line no-var
  var upgradesPrisma: UpgradesPrismaClient | undefined;
}

const upgradesClient =
  globalThis.upgradesPrisma ??
  new UpgradesPrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.upgradesPrisma = upgradesClient;
}

export function getUpgradesPrisma() {
  return upgradesClient;
}

export { upgradesClient as upgradesPrisma };

