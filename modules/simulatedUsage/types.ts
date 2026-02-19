export type TravelRange = { startDate: string; endDate: string };

export type MonthlyManualUsagePayload = {
  mode: "MONTHLY";
  // V1 contract: full-date anchor for billing-cycle periods (America/Chicago semantics at UI level).
  anchorEndDate: string; // YYYY-MM-DD
  monthlyKwh: Array<{ month: string; kwh: number | "" }>;
  travelRanges: TravelRange[];
  // Legacy (supported for backward compatibility with saved payloads)
  anchorEndMonth?: string; // YYYY-MM
  billEndDay?: number;
};

export type AnnualManualUsagePayload = {
  mode: "ANNUAL";
  // V1 contract: full-date anchor for 12 billing periods ending at this date.
  anchorEndDate: string; // YYYY-MM-DD
  annualKwh: number | "";
  travelRanges: TravelRange[];
  // Legacy (supported for backward compatibility with saved payloads)
  endDate?: string; // YYYY-MM-DD
};

export type ManualUsagePayload = MonthlyManualUsagePayload | AnnualManualUsagePayload;

export type Interval15 = {
  timestamp: string; // ISO
  consumption_kwh: number;
  interval_minutes: 15;
};

export type SimulatedCurve = {
  start: string; // ISO
  end: string; // ISO
  intervals: Interval15[];
  monthlyTotals: Array<{ month: string; kwh: number }>;
  annualTotalKwh: number;
  meta: {
    excludedDays: number;
    renormalized: boolean;
  };
};

