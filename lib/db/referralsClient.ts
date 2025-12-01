import { PrismaClient as ReferralsPrismaClient } from '@/.prisma/referrals-client';

declare global {
  // eslint-disable-next-line no-var
  var referralsPrisma: ReferralsPrismaClient | undefined;
}

const referralsClient =
  globalThis.referralsPrisma ??
  new ReferralsPrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.referralsPrisma = referralsClient;
}

export function getReferralsPrisma() {
  return referralsClient;
}

export { referralsClient as referralsPrisma };

