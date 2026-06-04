import "server-only";
import { readOnePathUserSiteParityLock } from "@/lib/usage/onePathPastUserSiteParityLock";

/**
 * SMT Past recalc/backfill must use the meter ESIID even when the One Path lab home row is stale.
 */
export async function resolvePastSimEsiidForHouse(args: {
  userId: string;
  houseId: string;
  houseEsiid?: string | null;
  buildInputs?: Record<string, unknown> | null;
}): Promise<string | null> {
  const local = String(args.houseEsiid ?? "").trim();
  if (local) return local;

  const lock = readOnePathUserSiteParityLock(args.buildInputs ?? null);
  if (lock?.sourceHouseId && lock.sourceUserId) {
    const { getHouseAddressForUserHouse } = await import("@/modules/onePathSim/usageSimulator/repo");
    const source = await getHouseAddressForUserHouse({
      userId: lock.sourceUserId,
      houseId: lock.sourceHouseId,
    });
    const fromLock = String(source?.esiid ?? "").trim();
    if (fromLock) return fromLock;
  }

  const { getOnePathLabTestHomeLink } = await import("@/modules/usageSimulator/labTestHomeLink");
  const link = await getOnePathLabTestHomeLink(args.userId).catch(() => null);
  if (link?.testHomeHouseId === args.houseId && link.sourceHouseId && link.sourceUserId) {
    const { getHouseAddressForUserHouse } = await import("@/modules/onePathSim/usageSimulator/repo");
    const source = await getHouseAddressForUserHouse({
      userId: String(link.sourceUserId),
      houseId: String(link.sourceHouseId),
    });
    const fromLink = String(source?.esiid ?? "").trim();
    if (fromLink) return fromLink;
  }

  return null;
}
