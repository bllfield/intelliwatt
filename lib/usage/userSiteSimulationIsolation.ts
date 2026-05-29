import {
  GAPFILL_LAB_TEST_HOME_LABEL,
  MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
  ONE_PATH_LAB_TEST_HOME_LABEL,
} from "@/modules/usageSimulator/labTestHome";

export function isUserSiteSimulationCaller(callerLabel: string | null | undefined): boolean {
  return /^user_/i.test(String(callerLabel ?? "").trim());
}

/** Admin-only lab houses (Gapfill / Manual Monthly / One Path) must not appear on user-site UI. */
export function isAdminLabTestHomeForUserSite(args: {
  label?: string | null;
  addressLine1?: string | null;
}): boolean {
  const normalized = String(args.label ?? "").trim();
  if (
    normalized === GAPFILL_LAB_TEST_HOME_LABEL ||
    normalized === MANUAL_MONTHLY_LAB_TEST_HOME_LABEL ||
    normalized === ONE_PATH_LAB_TEST_HOME_LABEL
  ) {
    return true;
  }
  const addressLine1 = String(args.addressLine1 ?? "").trim().toLowerCase();
  return (
    addressLine1 === "gap-fill canonical lab test home" ||
    addressLine1 === "manual monthly lab test home" ||
    addressLine1 === "one path lab test home"
  );
}

export function isPersistedAdminLabTestHomeLabel(label: string | null | undefined): boolean {
  return isAdminLabTestHomeForUserSite({ label });
}

export function filterUserVisibleHouses<T extends { label?: string | null; addressLine1?: string | null; archivedAt?: Date | null }>(
  houses: T[],
): T[] {
  return houses.filter(
    (house) => house.archivedAt == null && !isAdminLabTestHomeForUserSite({ label: house.label, addressLine1: house.addressLine1 }),
  );
}

export function visibleUserHouseIdSet(
  houses: Array<{ id: string; label?: string | null; addressLine1?: string | null; archivedAt?: Date | null }>,
): Set<string> {
  return new Set(filterUserVisibleHouses(houses).map((house) => house.id));
}

export function isEligibleJackpotEntryStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toUpperCase();
  return normalized === "ACTIVE" || normalized === "EXPIRING_SOON";
}

/** Drop admin lab-home rows; keep user-global rows (null houseId). */
export function filterUserVisibleEntries<T extends { houseId?: string | null }>(
  entries: T[],
  visibleHouseIds: Set<string>,
): T[] {
  return entries.filter((entry) => {
    if (entry.houseId && !visibleHouseIds.has(entry.houseId)) return false;
    return true;
  });
}

export function sumEligibleUserVisibleEntryAmount(
  entries: Array<{ amount: number; status: string; houseId?: string | null }>,
  visibleHouseIds: Set<string>,
): number {
  return filterUserVisibleEntries(entries, visibleHouseIds)
    .filter((entry) => isEligibleJackpotEntryStatus(entry.status))
    .reduce((sum, entry) => sum + entry.amount, 0);
}

export function hasEligibleSmartMeterEntryOnVisibleHomes(
  entries: Array<{ type: string; status: string; houseId?: string | null }>,
  visibleHouseIds: Set<string>,
): boolean {
  return filterUserVisibleEntries(entries, visibleHouseIds).some(
    (entry) =>
      entry.type === "smart_meter_connect" && isEligibleJackpotEntryStatus(entry.status),
  );
}

/** Prefer primary visible home, then any visible home with unexpired SMT auth. */
function entryCreatedAtMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

/** When duplicate non-stackable entries exist, keep the user-visible home row over admin lab homes. */
export function pickCanonicalNonStackableEntryId<T extends { id: string; houseId?: string | null; createdAt?: Date | string | null }>(
  rows: T[],
  labHouseIds: Set<string>,
): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const sorted = [...rows].sort((left, right) => {
    const leftLab = left.houseId && labHouseIds.has(left.houseId) ? 1 : 0;
    const rightLab = right.houseId && labHouseIds.has(right.houseId) ? 1 : 0;
    if (leftLab !== rightLab) return leftLab - rightLab;
    const leftUnassigned = left.houseId ? 0 : 1;
    const rightUnassigned = right.houseId ? 0 : 1;
    if (leftUnassigned !== rightUnassigned) return leftUnassigned - rightUnassigned;
    return entryCreatedAtMs(right.createdAt) - entryCreatedAtMs(left.createdAt);
  });
  return sorted[0]?.id ?? null;
}

/** Per-home jackpot counts; account-level rows (null houseId) roll into the primary visible home. */
export function buildVisibleHouseEntryCounts(args: {
  entries: Array<{ amount: number; status: string; houseId?: string | null }>;
  visibleHouses: Array<{ id: string; isPrimary?: boolean | null }>;
  visibleHouseIds: Set<string>;
}): { total: number; byHouseId: Map<string, number> } {
  const primaryHouseId =
    args.visibleHouses.find((house) => house.isPrimary)?.id ?? args.visibleHouses[0]?.id ?? null;

  const byHouseId = new Map<string, number>();
  for (const house of args.visibleHouses) {
    byHouseId.set(house.id, 0);
  }

  let unattributed = 0;
  for (const entry of args.entries) {
    if (!isEligibleJackpotEntryStatus(entry.status)) continue;
    const houseId = entry.houseId ?? null;
    if (houseId && !args.visibleHouseIds.has(houseId)) continue;
    if (houseId && byHouseId.has(houseId)) {
      byHouseId.set(houseId, (byHouseId.get(houseId) ?? 0) + entry.amount);
      continue;
    }
    unattributed += entry.amount;
  }

  if (unattributed > 0 && primaryHouseId) {
    byHouseId.set(primaryHouseId, (byHouseId.get(primaryHouseId) ?? 0) + unattributed);
  }

  const total = sumEligibleUserVisibleEntryAmount(args.entries, args.visibleHouseIds);
  return { total, byHouseId };
}

export function pickVisibleHouseIdForSmtEntrySync(args: {
  visibleHouses: Array<{ id: string; isPrimary?: boolean | null }>;
  smtAuthorizedVisibleHouseIds: string[];
}): string | null {
  const authorized = new Set(args.smtAuthorizedVisibleHouseIds.map((id) => String(id).trim()).filter(Boolean));
  if (authorized.size === 0) return null;
  const primary = args.visibleHouses.find((house) => house.isPrimary && authorized.has(house.id));
  if (primary) return primary.id;
  return args.visibleHouses.find((house) => authorized.has(house.id))?.id ?? null;
}

/** User-site truth: request house only; never admin lab cross-house or stale snapshot source. */
export async function resolveUserSiteActualSourceForHouse(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
}): Promise<"SMT" | "GREEN_BUTTON"> {
  const { resolveHouseCommittedUsageSource } = await import("@/lib/usage/houseCommittedUsageSource");
  const committed = await resolveHouseCommittedUsageSource({
    userId: args.userId,
    houseId: args.houseId,
    esiid: args.esiid,
  });
  if (committed === "SMT" || committed === "GREEN_BUTTON") return committed;
  return "GREEN_BUTTON";
}

export function isolateBuildInputsForUserSite(args: {
  buildInputs: Record<string, unknown>;
  requestHouseId: string;
  actualSource: "SMT" | "GREEN_BUTTON";
}): { buildInputs: Record<string, unknown>; changed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let changed = false;
  const next: Record<string, unknown> = { ...args.buildInputs };

  const prevContext = String((next as { actualContextHouseId?: unknown }).actualContextHouseId ?? "").trim();
  if (prevContext && prevContext !== args.requestHouseId) {
    reasons.push("actualContextHouseId_reset");
    changed = true;
  }
  (next as { actualContextHouseId: string }).actualContextHouseId = args.requestHouseId;

  const snapshotsRaw = (next as { snapshots?: unknown }).snapshots;
  const snapshots =
    snapshotsRaw && typeof snapshotsRaw === "object" && !Array.isArray(snapshotsRaw)
      ? { ...(snapshotsRaw as Record<string, unknown>) }
      : {};
  const prevSource = String(snapshots.actualSource ?? "").trim().toUpperCase();
  if (prevSource !== args.actualSource) {
    reasons.push("snapshots_actualSource_reset");
    changed = true;
  }
  snapshots.actualSource = args.actualSource;
  (next as { snapshots: Record<string, unknown> }).snapshots = snapshots;

  const lockboxRaw = (next as { lockboxRunContext?: unknown }).lockboxRunContext;
  if (lockboxRaw && typeof lockboxRaw === "object" && !Array.isArray(lockboxRaw)) {
    const lockbox = { ...(lockboxRaw as Record<string, unknown>) };
    const prevPreferred = String(lockbox.preferredActualSource ?? "").trim().toUpperCase();
    if (prevPreferred !== args.actualSource) {
      reasons.push("lockbox_preferredActualSource_reset");
      changed = true;
    }
    lockbox.preferredActualSource = args.actualSource;
    (next as { lockboxRunContext: Record<string, unknown> }).lockboxRunContext = lockbox;
  }

  return { buildInputs: next, changed, reasons };
}
