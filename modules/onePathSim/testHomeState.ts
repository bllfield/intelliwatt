import { prisma } from "@/lib/db";
import { ensureGlobalOnePathLabTestHomeHouse, getOnePathLabTestHomeLink } from "@/modules/usageSimulator/labTestHome";

export type OnePathTestHomeState = {
  ownerUserId: string;
  testHomeHouseId: string;
  testHomeHouse: {
    id: string;
    label: string;
    esiid: string | null;
  } | null;
  linkedSourceHouseId: string | null;
  linkedSourceUserId: string | null;
  status: string;
  statusMessage: string | null;
  lastReplacedAt: string | null;
  isPinned: boolean;
  needsReplace: boolean;
};

/** Shared One Path admin lab pin state — same fallback semantics as replace/run routes. */
export async function resolveOnePathTestHomeState(args: {
  ownerUserId: string;
  selectedSourceHouseId: string;
  selectedSourceUserId?: string | null;
  fallbackSourceHouseId?: string | null;
  preferredTestHomeHouseId?: string | null;
}): Promise<OnePathTestHomeState> {
  const ensured = await ensureGlobalOnePathLabTestHomeHouse(args.ownerUserId);
  const link = await getOnePathLabTestHomeLink(args.ownerUserId);
  const preferredTestHomeHouseId =
    typeof args.preferredTestHomeHouseId === "string" && args.preferredTestHomeHouseId.trim()
      ? args.preferredTestHomeHouseId.trim()
      : null;
  const testHomeHouseId = String(
    (preferredTestHomeHouseId && preferredTestHomeHouseId === ensured.id ? preferredTestHomeHouseId : null) ??
      link?.testHomeHouseId ??
      ensured.id
  );
  const testHomeHouse = await (prisma as any).houseAddress
    .findFirst({
      where: { id: testHomeHouseId, userId: args.ownerUserId, archivedAt: null },
      select: { id: true, label: true, esiid: true },
    })
    .catch(() => null);
  const linkedSourceHouseId =
    (link?.sourceHouseId ? String(link.sourceHouseId) : null) ??
    (typeof args.fallbackSourceHouseId === "string" && args.fallbackSourceHouseId.trim()
      ? args.fallbackSourceHouseId.trim()
      : null);
  const status = String(link?.status ?? (testHomeHouse && linkedSourceHouseId ? "ready" : testHomeHouse ? "unlinked" : "replacing"));
  const isPinned = Boolean(
    testHomeHouse?.id && status === "ready" && linkedSourceHouseId && linkedSourceHouseId === args.selectedSourceHouseId
  );
  return {
    ownerUserId: args.ownerUserId,
    testHomeHouseId,
    testHomeHouse: testHomeHouse
      ? {
          id: String(testHomeHouse.id),
          label: String(testHomeHouse.label ?? ""),
          esiid: testHomeHouse.esiid ? String(testHomeHouse.esiid) : null,
        }
      : null,
    linkedSourceHouseId,
    linkedSourceUserId:
      link?.sourceUserId
        ? String(link.sourceUserId)
        : linkedSourceHouseId === args.selectedSourceHouseId &&
            typeof args.selectedSourceUserId === "string" &&
            args.selectedSourceUserId.trim()
          ? args.selectedSourceUserId.trim()
          : null,
    status,
    statusMessage:
      link?.statusMessage ? String(link.statusMessage) : linkedSourceHouseId ? "Using request-scoped One Path test-home binding." : null,
    lastReplacedAt: link?.lastReplacedAt ? new Date(link.lastReplacedAt).toISOString() : null,
    isPinned,
    needsReplace: !isPinned,
  };
}
