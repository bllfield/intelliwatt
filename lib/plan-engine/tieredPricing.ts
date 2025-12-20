export type Tier = {
  startKwhInclusive: number;
  endKwhExclusive: number | null;
  repEnergyCentsPerKwh: number;
};

export type DeterministicTierSchedule = {
  tiers: Tier[];
  notes: string[];
};

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function safeNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  const n = safeNum(v);
  if (n == null) return null;
  const i = Math.floor(n);
  return Number.isFinite(i) ? i : null;
}

function hasNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function normalizeTierFromPlanRulesShape(t: any): null | { min: number; max: number | null; cents: number } {
  // PlanRules: { minKwh, maxKwh, rateCentsPerKwh }
  const min = intOrNull(t?.minKwh ?? t?.minKWh ?? t?.minUsageKwh ?? t?.minimumUsageKwh);
  const maxRaw = t?.maxKwh ?? t?.maxKWh ?? t?.maxUsageKwh ?? t?.maximumUsageKwh;
  const max = maxRaw == null ? null : intOrNull(maxRaw);
  const cents = safeNum(t?.rateCentsPerKwh ?? t?.centsPerKwh ?? t?.centsPerKWh);
  if (min == null || min < 0) return null;
  if (max != null && max <= min) return null;
  if (cents == null || cents < 0 || cents > 200) return null;
  return { min, max, cents };
}

function normalizeTierFromRateStructureShape(t: any): null | { min: number; max: number | null; cents: number } {
  // RateStructureUsageTier: { minKWh, maxKWh, centsPerKWh }
  const min = intOrNull(t?.minKWh ?? t?.minKwh);
  const maxRaw = t?.maxKWh ?? t?.maxKwh;
  const max = maxRaw == null ? null : intOrNull(maxRaw);
  const cents = safeNum(t?.centsPerKWh ?? t?.centsPerKwh ?? t?.rateCentsPerKwh);
  if (min == null || min < 0) return null;
  if (max != null && max <= min) return null;
  if (cents == null || cents < 0 || cents > 200) return null;
  return { min, max, cents };
}

function validateContiguousTiers(tiers: Array<{ min: number; max: number | null; cents: number }>): string | null {
  if (tiers.length === 0) return "NO_TIERS";
  if (tiers[0]!.min !== 0) return "FIRST_TIER_NOT_ZERO";

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]!;
    const next = tiers[i + 1];

    if (t.max == null) {
      // Infinity must be last.
      if (i !== tiers.length - 1) return "INFINITE_TIER_NOT_LAST";
      continue;
    }
    if (t.max < 0) return "NEGATIVE_MAX";
    if (next) {
      if (next.min !== t.max) return "GAP_OR_OVERLAP";
    }
  }
  return null;
}

export function extractDeterministicTierSchedule(
  rateStructure: any,
):
  | { ok: true; schedule: DeterministicTierSchedule }
  | {
      ok: false;
      reason:
        | "NO_TIER_DATA"
        | "UNSUPPORTED_TIER_SHAPE"
        | "NON_DETERMINISTIC_PRICING"
        | "UNSUPPORTED_TIER_VARIATION"
        | "UNSUPPORTED_COMBINED_STRUCTURES"
        | "UNSUPPORTED_CREDITS_IN_TIERED";
      notes: string[];
    } {
  const notes: string[] = [];
  if (!rateStructure || !isObject(rateStructure)) return { ok: false, reason: "NO_TIER_DATA", notes: ["rateStructure_missing"] };

  const rs: any = rateStructure;

  // Combined structures (TOU + tiers) not supported here.
  const hasTou =
    hasNonEmptyArray(rs?.timeOfUsePeriods) ||
    hasNonEmptyArray(rs?.planRules?.timeOfUsePeriods) ||
    (String(rs?.type ?? "").toUpperCase() === "TIME_OF_USE" && hasNonEmptyArray(rs?.tiers)) ||
    hasNonEmptyArray(rs?.timeOfUseTiers);
  if (hasTou) {
    // Only treat as combined if tiers exist too; otherwise this is just TOU and not our business.
    if (hasNonEmptyArray(rs?.usageTiers) || hasNonEmptyArray(rs?.planRules?.usageTiers)) {
      return { ok: false, reason: "UNSUPPORTED_COMBINED_STRUCTURES", notes: ["tou_and_usage_tiers_present"] };
    }
  }

  // NOTE: Tiered + deterministic bill credits is supported (handled at the calculator/computability layer).
  // This extractor is intentionally tier-only and does not attempt to validate credit shapes.

  // Non-deterministic pricing (indexed/variable riders) not supported here.
  const typeUpper = String(rs?.type ?? "").toUpperCase();
  if (typeUpper === "VARIABLE" || typeof rs?.indexType === "string" || safeNum(rs?.currentBillEnergyRateCents) != null) {
    if (hasNonEmptyArray(rs?.usageTiers) || hasNonEmptyArray(rs?.planRules?.usageTiers)) {
      return { ok: false, reason: "NON_DETERMINISTIC_PRICING", notes: ["variable_or_indexed_fields_present"] };
    }
  }

  const srcA: any[] = Array.isArray(rs?.usageTiers) ? rs.usageTiers : [];
  const srcB: any[] = Array.isArray(rs?.planRules?.usageTiers) ? rs.planRules.usageTiers : [];
  const src = srcA.length > 0 ? srcA : srcB;
  if (!Array.isArray(src) || src.length === 0) {
    return { ok: false, reason: "NO_TIER_DATA", notes: ["no_usageTiers"] };
  }

  // Reject obvious "variation by month/daytype" fields if present on tiers.
  for (const t of src) {
    if (!t || typeof t !== "object") continue;
    if (Array.isArray((t as any)?.monthsOfYear) || Array.isArray((t as any)?.months) || Array.isArray((t as any)?.daysOfWeek)) {
      return { ok: false, reason: "UNSUPPORTED_TIER_VARIATION", notes: ["tier_has_monthsOrDays"] };
    }
  }

  const normalized = src
    .map((t) => normalizeTierFromRateStructureShape(t) ?? normalizeTierFromPlanRulesShape(t))
    .filter((x): x is { min: number; max: number | null; cents: number } => Boolean(x))
    .sort((a, b) => a.min - b.min);

  if (normalized.length !== src.length) {
    return { ok: false, reason: "UNSUPPORTED_TIER_SHAPE", notes: ["could_not_normalize_all_tiers"] };
  }

  // Deduplicate exact duplicates (stable).
  const deduped: Array<{ min: number; max: number | null; cents: number }> = [];
  for (const t of normalized) {
    const last = deduped[deduped.length - 1];
    if (last && last.min === t.min && last.max === t.max && last.cents === t.cents) continue;
    deduped.push(t);
  }

  const contigErr = validateContiguousTiers(deduped);
  if (contigErr) {
    return { ok: false, reason: "UNSUPPORTED_TIER_SHAPE", notes: [`contiguity:${contigErr}`] };
  }

  const tiers: Tier[] = deduped.map((t) => ({
    startKwhInclusive: t.min,
    endKwhExclusive: t.max ?? null,
    repEnergyCentsPerKwh: t.cents,
  }));

  notes.push("deterministic_usage_tiers");
  return { ok: true, schedule: { tiers, notes } };
}

export function computeRepEnergyCostForMonthlyKwhTiered(args: {
  monthlyKwh: number;
  schedule: DeterministicTierSchedule;
}): {
  repEnergyCentsTotal: number;
  tierBreakdown: Array<{ start: number; end: number | null; kwh: number; centsPerKwh: number; centsTotal: number }>;
} {
  const kwh = Math.max(0, safeNum(args.monthlyKwh) ?? 0);
  const tiers = Array.isArray(args.schedule?.tiers) ? args.schedule.tiers : [];

  let remaining = kwh;
  let totalCents = 0;
  const breakdown: Array<{ start: number; end: number | null; kwh: number; centsPerKwh: number; centsTotal: number }> = [];

  for (const t of tiers) {
    if (remaining <= 0) break;
    const start = Math.max(0, safeNum(t.startKwhInclusive) ?? 0);
    const end = t.endKwhExclusive == null ? null : Math.max(start, safeNum(t.endKwhExclusive) ?? start);
    const rate = safeNum(t.repEnergyCentsPerKwh) ?? 0;

    const tierSize = end == null ? remaining : Math.max(0, Math.min(remaining, end - start));
    const centsTotal = tierSize * rate;
    totalCents += centsTotal;
    breakdown.push({ start, end, kwh: tierSize, centsPerKwh: rate, centsTotal });
    remaining -= tierSize;
  }

  return { repEnergyCentsTotal: totalCents, tierBreakdown: breakdown };
}

