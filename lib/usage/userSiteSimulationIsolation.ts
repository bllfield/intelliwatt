import {
  GAPFILL_LAB_TEST_HOME_LABEL,
  MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
} from "@/modules/onePathSim/usageSimulator/labTestHome";

export function isUserSiteSimulationCaller(callerLabel: string | null | undefined): boolean {
  return /^user_/i.test(String(callerLabel ?? "").trim());
}

export function isPersistedAdminLabTestHomeLabel(label: string | null | undefined): boolean {
  const normalized = String(label ?? "").trim();
  return normalized === GAPFILL_LAB_TEST_HOME_LABEL || normalized === MANUAL_MONTHLY_LAB_TEST_HOME_LABEL;
}

/** User-site truth: request house only; never admin lab cross-house or stale snapshot source. */
export async function resolveUserSiteActualSourceForHouse(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
}): Promise<"SMT" | "GREEN_BUTTON"> {
  if (String(args.esiid ?? "").trim()) return "SMT";
  const { getActualUsageDatasetForHouse } = await import("@/lib/usage/actualDatasetForHouse");
  const result = await getActualUsageDatasetForHouse(args.houseId, null, {
    skipFullYearIntervalFetch: true,
    preferredActualSource: null,
  }).catch(() => null);
  const src = String(result?.dataset?.summary?.source ?? "").trim().toUpperCase();
  if (src === "SMT" || src === "GREEN_BUTTON") return src;
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
