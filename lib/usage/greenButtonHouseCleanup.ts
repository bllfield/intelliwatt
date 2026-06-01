import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { houseHasActiveGreenButtonUploadLock } from "@/lib/usage/houseCommittedUsageSource";
import { isSmtHealScopeReady } from "@/lib/usage/smtTailCoverage";
import { loadSmtWindowDayStatus, resolveSmtPersistedCoverageSpan } from "@/lib/usage/smtWindowStatus";
import { getOnePathLabTestHomeLink } from "@/modules/usageSimulator/labTestHome";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

/** Removes interval/raw/bucket Green Button usage rows (keeps upload metadata for Utility Exports UI). */
export async function clearGreenButtonIntervalUsageForHouse(houseId: string): Promise<void> {
  const id = String(houseId ?? "").trim();
  if (!id) return;

  if (USAGE_DB_ENABLED) {
    await (usagePrisma as any).greenButtonInterval?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).rawGreenButton?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).homeMonthlyUsageBucket?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).homeDailyUsageBucket?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
  }
}

/** Removes all persisted Green Button usage for a house (intervals, raw, uploads). Admin/purge only. */
export async function clearGreenButtonUsageForHouse(houseId: string): Promise<void> {
  const id = String(houseId ?? "").trim();
  if (!id) return;

  await clearGreenButtonIntervalUsageForHouse(id);
  await prisma.greenButtonUpload.deleteMany({ where: { houseId: id } }).catch(() => null);
  await prisma.manualUsageUpload
    .deleteMany({ where: { houseId: id, source: "green_button" } })
    .catch(() => null);
}

async function isOnePathLabTestHomeHouse(houseId: string): Promise<boolean> {
  const id = String(houseId ?? "").trim();
  if (!id) return false;
  const house = await prisma.houseAddress
    .findUnique({
      where: { id },
      select: { userId: true },
    })
    .catch(() => null);
  const ownerUserId = String(house?.userId ?? "").trim();
  if (!ownerUserId) return false;
  const link = await getOnePathLabTestHomeLink(ownerUserId).catch(() => null);
  return typeof link?.testHomeHouseId === "string" && link.testHomeHouseId.trim() === id;
}

async function isHouseSmtHealScopeReady(esiid: string): Promise<boolean> {
  const normalized = String(esiid ?? "").trim();
  if (!normalized) return false;
  try {
    const [dayStatus, persistedSpan] = await Promise.all([
      loadSmtWindowDayStatus({ esiid: normalized }),
      resolveSmtPersistedCoverageSpan(normalized),
    ]);
    return isSmtHealScopeReady(dayStatus, persistedSpan);
  } catch {
    return false;
  }
}

/**
 * When canonical SMT heal scope is ready, drop Green Button interval rows so reads prefer SMT.
 * Never deletes `GreenButtonUpload` rows — Utility Exports must keep showing the user's file.
 * Skips homes with an active (non-expired) Green Button upload lock.
 */
export async function clearGreenButtonSupersededBySmtForHouse(args: {
  houseId: string;
  esiid?: string | null;
}): Promise<boolean> {
  const houseId = String(args.houseId ?? "").trim();
  const esiid = String(args.esiid ?? "").trim();
  if (!houseId || !esiid) return false;
  if (await isOnePathLabTestHomeHouse(houseId)) return false;
  if (await houseHasActiveGreenButtonUploadLock(houseId)) return false;
  if (!(await isHouseSmtHealScopeReady(esiid))) return false;
  await clearGreenButtonIntervalUsageForHouse(houseId);
  return true;
}
