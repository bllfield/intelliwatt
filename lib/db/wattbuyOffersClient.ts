import { PrismaClient as WattbuyOffersPrismaClient } from '../../.prisma/wattbuy-offers-client';

declare global {
  // eslint-disable-next-line no-var
  var wattbuyOffersPrisma: WattbuyOffersPrismaClient | undefined;
}

const wattbuyOffersClient =
  globalThis.wattbuyOffersPrisma ??
  new WattbuyOffersPrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.wattbuyOffersPrisma = wattbuyOffersClient;
}

export function getWattbuyOffersPrisma() {
  return wattbuyOffersClient;
}

export { wattbuyOffersClient as wattbuyOffersPrisma };

