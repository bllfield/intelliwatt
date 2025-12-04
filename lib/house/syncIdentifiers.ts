import { prisma } from '@/lib/db';
import { cleanEsiid } from '@/lib/smt/esiid';

export async function syncHouseIdentifiersFromAuthorization({
  houseAddressId,
  esiid,
}: {
  houseAddressId: string | null | undefined;
  esiid?: string | null;
  meterNumber?: string | null;
}) {
  if (!houseAddressId) return;

  const updates: Record<string, unknown> = {};
  const cleanedEsiid = cleanEsiid(esiid);
  if (cleanedEsiid) {
    updates.esiid = cleanedEsiid;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  try {
    await prisma.houseAddress.update({
      where: { id: houseAddressId },
      data: updates,
    });
  } catch (error) {
    console.error('[house.syncIdentifiers] failed to update house', {
      houseAddressId,
      error,
    });
  }
}

