import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

/** Remove persisted SMT usage + authorization for a home (user-site Green Button takeover). */
export async function clearSmtUsageForHouse(args: {
  houseId: string;
  esiid?: string | null;
}): Promise<{ clearedIntervals: boolean; clearedAuth: boolean }> {
  const houseId = String(args.houseId ?? "").trim();
  if (!houseId) return { clearedIntervals: false, clearedAuth: false };

  const house = await prisma.houseAddress
    .findFirst({
      where: { id: houseId },
      select: { esiid: true },
    })
    .catch(() => null);
  const esiid = String(args.esiid ?? house?.esiid ?? "").trim();

  if (esiid) {
    await prisma.smtInterval.deleteMany({ where: { esiid } }).catch(() => null);
    await prisma.smtIntervalDayLedger.deleteMany({ where: { esiid } }).catch(() => null);
    await prisma.smtBillingRead.deleteMany({ where: { esiid } }).catch(() => null);
    await prisma.smtMeterInfo.deleteMany({ where: { houseId } }).catch(() => null);
    if (USAGE_DB_ENABLED) {
      await (usagePrisma as any).usageIntervalModule
        ?.deleteMany?.({ where: { esiid } })
        .catch(() => null);
    }
  }

  const authDelete = await prisma.smtAuthorization
    .deleteMany({
      where: { OR: [{ houseAddressId: houseId }, { houseId }] },
    })
    .catch(() => ({ count: 0 }));

  return { clearedIntervals: Boolean(esiid), clearedAuth: (authDelete?.count ?? 0) > 0 };
}
