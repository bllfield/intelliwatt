export type AdminUserUsageSource =
  | "SMT"
  | "GB"
  | "MANUAL_MONTHLY"
  | "MANUAL_ANNUAL"
  | "NEW_BUILD"
  | "UNKNOWN";

export type AdminUserUsageSourceFilter = AdminUserUsageSource | "any";

export const ADMIN_USER_USAGE_SOURCE_LABELS: Record<AdminUserUsageSource, string> = {
  SMT: "SMT",
  GB: "GB",
  MANUAL_MONTHLY: "Manual monthly",
  MANUAL_ANNUAL: "Manual annual",
  NEW_BUILD: "New Build",
  UNKNOWN: "—",
};

/** Stable sort order for admin table sorting. */
export const ADMIN_USER_USAGE_SOURCE_SORT_ORDER: Record<AdminUserUsageSource, number> = {
  SMT: 10,
  GB: 20,
  MANUAL_MONTHLY: 30,
  MANUAL_ANNUAL: 40,
  NEW_BUILD: 50,
  UNKNOWN: 99,
};

export function parseAdminUserUsageSourceFilter(v: string | null | undefined): AdminUserUsageSourceFilter {
  const raw = String(v ?? "").trim().toUpperCase();
  if (!raw || raw === "ANY" || raw === "ALL") return "any";
  if (raw === "SMT") return "SMT";
  if (raw === "GB" || raw === "GREEN_BUTTON" || raw === "GREEN BUTTON") return "GB";
  if (raw === "MANUAL_MONTHLY" || raw === "MANUAL MONTHLY") return "MANUAL_MONTHLY";
  if (raw === "MANUAL_ANNUAL" || raw === "MANUAL ANNUAL") return "MANUAL_ANNUAL";
  if (raw === "NEW_BUILD" || raw === "NEW BUILD") return "NEW_BUILD";
  if (raw === "UNKNOWN" || raw === "NONE") return "UNKNOWN";
  return "any";
}

function normalizeManualUsageMode(v: unknown): "MONTHLY" | "ANNUAL" | null {
  const mode = String(v ?? "").trim().toUpperCase();
  if (mode === "MONTHLY" || mode === "ANNUAL") return mode;
  return null;
}

export function resolveAdminUserUsageSource(args: {
  simulatorMode?: string | null;
  manualUsageMode?: string | null;
  committedUsageSource?: "SMT" | "GREEN_BUTTON" | null;
  /** Legacy fallback when committedUsageSource is unset on the house row. */
  inferredCommittedUsageSource?: "SMT" | "GREEN_BUTTON" | null;
}): AdminUserUsageSource {
  const simulatorMode = String(args.simulatorMode ?? "").trim();
  const manualMode = normalizeManualUsageMode(args.manualUsageMode);

  if (simulatorMode === "NEW_BUILD_ESTIMATE") return "NEW_BUILD";

  if (simulatorMode === "MANUAL_TOTALS") {
    if (manualMode === "ANNUAL") return "MANUAL_ANNUAL";
    if (manualMode === "MONTHLY") return "MANUAL_MONTHLY";
    return "MANUAL_MONTHLY";
  }

  const committed =
    args.committedUsageSource === "SMT" || args.committedUsageSource === "GREEN_BUTTON"
      ? args.committedUsageSource
      : args.inferredCommittedUsageSource ?? null;

  if (committed === "GREEN_BUTTON") return "GB";
  if (committed === "SMT") return "SMT";

  if (!simulatorMode && manualMode === "ANNUAL") return "MANUAL_ANNUAL";
  if (!simulatorMode && manualMode === "MONTHLY") return "MANUAL_MONTHLY";

  if (simulatorMode === "SMT_BASELINE") return "SMT";

  return "UNKNOWN";
}

export function labelAdminUserUsageSource(source: AdminUserUsageSource): string {
  return ADMIN_USER_USAGE_SOURCE_LABELS[source];
}
