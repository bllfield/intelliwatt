export type AdjustmentType =
  | "CUSTOM"
  | "VACANCY_LOW_USAGE"
  | "EV_LOAD"
  | "POOL_PUMP"
  | "SOLAR_NET_OFFSET"
  | "LED_UPGRADE";

export type CatalogItem = {
  id: AdjustmentType;
  label: string;
  help: string;
  inputKind: "PERCENT" | "KWH";
};

export const USAGE_SCENARIO_ADJUSTMENT_CATALOG: CatalogItem[] = [
  {
    id: "CUSTOM",
    label: "Custom (advanced)",
    help: "Enter multiplier and/or adder kWh directly.",
    inputKind: "KWH",
  },
  {
    id: "VACANCY_LOW_USAGE",
    label: "Vacancy / low usage",
    help: "Reduce consumption by a percent for the selected month.",
    inputKind: "PERCENT",
  },
  {
    id: "EV_LOAD",
    label: "EV charging load",
    help: "Add a fixed kWh amount for the selected month.",
    inputKind: "KWH",
  },
  {
    id: "POOL_PUMP",
    label: "Pool pump / outdoor load",
    help: "Add a fixed kWh amount for the selected month.",
    inputKind: "KWH",
  },
  {
    id: "SOLAR_NET_OFFSET",
    label: "Solar net offset",
    help: "Subtract a fixed kWh amount (net reduction) for the selected month.",
    inputKind: "KWH",
  },
  {
    id: "LED_UPGRADE",
    label: "LED upgrade",
    help: "Reduce consumption by a percent for the selected month.",
    inputKind: "PERCENT",
  },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function toMonthlyAdjustmentPayload(args: {
  type: AdjustmentType;
  value: number;
}): { multiplier?: number; adderKwh?: number } {
  const type = args.type;
  const v = Number(args.value);
  if (!Number.isFinite(v)) return {};

  if (type === "VACANCY_LOW_USAGE" || type === "LED_UPGRADE") {
    // Percent reduction: 0..100 -> multiplier 1..0
    const pct = clamp(v, 0, 100);
    return { multiplier: 1 - pct / 100 };
  }

  if (type === "SOLAR_NET_OFFSET") {
    const kwh = Math.abs(v);
    return { adderKwh: -kwh };
  }

  if (type === "EV_LOAD" || type === "POOL_PUMP") {
    return { adderKwh: v };
  }

  return {};
}

