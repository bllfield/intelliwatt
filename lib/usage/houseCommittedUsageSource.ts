import { prisma } from "@/lib/db";
import { pickBestSmtAuthorization } from "@/lib/smt/authorizationSelection";
import { getLatestUsableRawGreenButtonIdForHouse } from "@/modules/realUsageAdapter/greenButton";
import { isSmtHealScopeReady } from "@/lib/usage/smtTailCoverage";
import { loadSmtWindowDayStatus, resolveSmtPersistedCoverageSpan } from "@/lib/usage/smtWindowStatus";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";

function normStatus(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

/** SMT pull/heal only when the stored authorization is still eligible. */
export function isActiveSmtAuthorizationRow(
  auth: {
    smtStatus?: string | null;
    authorizationEndDate?: Date | null;
  } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!auth) return false;
  const end = auth.authorizationEndDate;
  if (end && now.getTime() > end.getTime()) return false;
  const status = normStatus(auth.smtStatus);
  return status === "ACTIVE" || status === "ALREADY_ACTIVE" || status === "ACT";
}

export async function houseHasUsableGreenButton(houseId: string): Promise<boolean> {
  const id = String(houseId ?? "").trim();
  if (!id) return false;
  const rawId = await getLatestUsableRawGreenButtonIdForHouse(id).catch(() => null);
  return Boolean(rawId);
}

async function resolveEsiidForHouse(houseId: string, esiid?: string | null): Promise<string | null> {
  const direct = String(esiid ?? "").trim();
  if (direct) return direct;
  const house = await prisma.houseAddress
    .findFirst({
      where: { id: houseId, archivedAt: null },
      select: { esiid: true },
    })
    .catch(() => null);
  const fromHouse = String(house?.esiid ?? "").trim();
  return fromHouse || null;
}

/** True when SMT has completed the canonical heal scope (not merely a few tail intervals). */
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
 * User-site homes use one committed actual source at a time.
 * Active SMT authorization wins once heal scope is ready; otherwise a usable Green Button upload wins.
 */
export async function resolveHouseCommittedUsageSource(args: {
  houseId: string;
  userId?: string | null;
  esiid?: string | null;
}): Promise<ActualUsageSource | null> {
  const houseId = String(args.houseId ?? "").trim();
  if (!houseId) return null;

  const [gbReady, esiid] = await Promise.all([
    houseHasUsableGreenButton(houseId),
    resolveEsiidForHouse(houseId, args.esiid),
  ]);

  const authWhere: Record<string, unknown> = {
    archivedAt: null,
    OR: [{ houseAddressId: houseId }, { houseId }],
  };
  if (args.userId) authWhere.userId = args.userId;

  const authorizationCandidates = await prisma.smtAuthorization
    .findMany({
      where: authWhere as any,
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        smtStatus: true,
        authorizationEndDate: true,
      },
    })
    .catch(() => []);
  const authorization = pickBestSmtAuthorization(authorizationCandidates as any[]);
  if (isActiveSmtAuthorizationRow(authorization as any)) {
    if (gbReady && (!esiid || !(await isHouseSmtHealScopeReady(esiid)))) {
      return "GREEN_BUTTON";
    }
    return "SMT";
  }
  if (gbReady) return "GREEN_BUTTON";
  if (esiid && (await isHouseSmtHealScopeReady(esiid))) return "SMT";
  return null;
}

export async function isHouseCommittedToGreenButton(args: {
  houseId: string;
  userId?: string | null;
  esiid?: string | null;
}): Promise<boolean> {
  return (await resolveHouseCommittedUsageSource(args)) === "GREEN_BUTTON";
}
