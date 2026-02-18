export type TravelRange = { startDate: string; endDate: string };

export type MonthlyManualUsagePayload = {
  mode: "MONTHLY";
  anchorEndMonth: string; // YYYY-MM
  billEndDay: number;
  monthlyKwh: Array<{ month: string; kwh: number | "" }>;
  travelRanges: TravelRange[];
};

export type AnnualManualUsagePayload = {
  mode: "ANNUAL";
  endDate: string; // YYYY-MM-DD
  annualKwh: number | "";
  travelRanges: TravelRange[];
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

