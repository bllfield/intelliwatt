/** Upgrade impact contract (V1: additive kWh deltas only). Defined in modules/upgradesLedger/impact; re-exported for overlay/curve consumption. */
export type { UpgradeImpact, V1DeltaInput } from "@/modules/upgradesLedger/impact";

import type { V1DeltaInput } from "@/modules/upgradesLedger/impact";

/** One ledger-derived entry for overlay: dates + V1 delta. Timeline order is determined by caller (scenario events). */
export type LedgerOverlayEntry = {
  effectiveMonth: string; // YYYY-MM
  effectiveEndDate?: string | null; // YYYY-MM or YYYY-MM-DD; null/undefined = permanent
  delta: V1DeltaInput;
};

export type UsageScenario = {
  id: string;
  userId: string;
  houseId: string;
  name: string;
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type UsageScenarioEventKind = "MONTHLY_ADJUSTMENT";

export type UsageScenarioEvent = {
  id: string;
  scenarioId: string;
  effectiveMonth: string; // YYYY-MM
  kind: UsageScenarioEventKind | string;
  payloadJson: any;
  createdAt?: string;
  updatedAt?: string;
};

export type MonthlyOverlayResult = {
  monthlyMultipliersByMonth: Record<string, number>; // YYYY-MM -> multiplier (default 1)
  monthlyAddersKwhByMonth: Record<string, number>; // YYYY-MM -> kWh adder (default 0)
  inactiveEventIds: string[];
  warnings: Array<{ eventId: string; reason: string }>;
};

export function isYearMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s.trim());
}

