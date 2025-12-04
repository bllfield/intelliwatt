#!/usr/bin/env tsx
import { prisma } from '@/lib/db';
import { syncHouseIdentifiersFromAuthorization } from '@/lib/house/syncIdentifiers';

async function main() {
  const authorizations = await prisma.smtAuthorization.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      houseAddressId: true,
      esiid: true,
      meterNumber: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const seen = new Set<string>();
  let updated = 0;

  for (const auth of authorizations) {
    if (!auth.houseAddressId) continue;
    if (seen.has(auth.houseAddressId)) continue;
    seen.add(auth.houseAddressId);

    await syncHouseIdentifiersFromAuthorization({
      houseAddressId: auth.houseAddressId,
      esiid: auth.esiid,
      meterNumber: auth.meterNumber,
    });

    updated += 1;
  }

  console.log(
    `[backfill-house-esiids] processed ${authorizations.length} authorizations, synced ${updated} houses`,
  );
}

main()
  .catch((error) => {
    console.error('[backfill-house-esiids] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

