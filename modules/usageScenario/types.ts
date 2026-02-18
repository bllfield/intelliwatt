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

