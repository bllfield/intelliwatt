export type BillCreditRule =
  | { type: "FLAT_MONTHLY_CREDIT"; creditDollars: number; label?: string }
  | {
      type: "USAGE_RANGE_CREDIT";
      creditDollars: number;
      minKwhInclusive: number;
      maxKwhExclusive: number | null; // null => no upper bound
      label?: string;
    };

export type DeterministicBillCredits = {
  rules: BillCreditRule[];
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

function centsToDollars(cents: number): number {
  return cents / 100;
}

type ExtractFailReason =
  | "NO_CREDITS"
  | "UNSUPPORTED_CREDIT_SHAPE"
  | "UNSUPPORTED_CREDIT_DIMENSION"
  | "UNSUPPORTED_CREDIT_DEPENDENCY"
  | "UNSUPPORTED_CREDIT_COMPONENT_SCOPE"
  | "UNSUPPORTED_CREDIT_COMBINATION"
  | "NON_DETERMINISTIC_CREDIT";

export function extractDeterministicBillCredits(
  rateStructure: any,
):
  | { ok: true; credits: DeterministicBillCredits }
  | { ok: false; reason: ExtractFailReason; notes: string[] } {
  const notes: string[] = [];
  if (!rateStructure || !isObject(rateStructure)) return { ok: false, reason: "NO_CREDITS", notes: ["rateStructure_missing"] };

  const rs: any = rateStructure;
  const bc = rs?.billCredits;
  if (!bc || !isObject(bc)) {
    return { ok: false, reason: "NO_CREDITS", notes: ["billCredits_missing"] };
  }

  const hasBillCredit = bc.hasBillCredit === true;
  const rawRules: any[] = Array.isArray(bc.rules) ? bc.rules : [];

  if (!hasBillCredit && rawRules.length === 0) {
    return { ok: false, reason: "NO_CREDITS", notes: ["hasBillCredit=false"] };
  }
  if (hasBillCredit && rawRules.length === 0) {
    return { ok: false, reason: "UNSUPPORTED_CREDIT_SHAPE", notes: ["hasBillCredit=true_but_no_rules"] };
  }

  const normalized: Array<{
    label: string | null;
    creditAmountCents: number;
    minUsageKWh: number;
    maxUsageKWh: number | null;
    monthsOfYear: number[] | null;
  }> = [];

  for (const r of rawRules) {
    if (!r || typeof r !== "object") {
      return { ok: false, reason: "UNSUPPORTED_CREDIT_SHAPE", notes: ["rule_not_object"] };
    }
    const label = typeof (r as any).label === "string" ? String((r as any).label).trim() : "";
    const creditAmountCents = intOrNull((r as any).creditAmountCents);
    const minUsageKWh = intOrNull((r as any).minUsageKWh);
    const maxUsageKWhRaw = (r as any).maxUsageKWh;
    const maxUsageKWh = maxUsageKWhRaw == null ? null : intOrNull(maxUsageKWhRaw);

    const monthsOfYear = Array.isArray((r as any).monthsOfYear)
      ? (r as any).monthsOfYear.map((m: any) => intOrNull(m)).filter((m: number | null): m is number => m != null)
      : null;

    if (monthsOfYear && monthsOfYear.length > 0) {
      // Phase 1: only "monthly total kWh" with no seasonal dimension.
      return { ok: false, reason: "UNSUPPORTED_CREDIT_DIMENSION", notes: ["monthsOfYear_present"] };
    }

    if (creditAmountCents == null || creditAmountCents <= 0) {
      return { ok: false, reason: "UNSUPPORTED_CREDIT_SHAPE", notes: ["invalid_creditAmountCents"] };
    }
    if (minUsageKWh == null || minUsageKWh < 0) {
      return { ok: false, reason: "UNSUPPORTED_CREDIT_SHAPE", notes: ["invalid_minUsageKWh"] };
    }
    if (maxUsageKWh != null && maxUsageKWh < minUsageKWh) {
      return { ok: false, reason: "UNSUPPORTED_CREDIT_SHAPE", notes: ["max_lt_min"] };
    }

    normalized.push({
      label: label || null,
      creditAmountCents,
      minUsageKWh,
      maxUsageKWh: maxUsageKWh ?? null,
      monthsOfYear: null,
    });
  }

  const rules: BillCreditRule[] = normalized.map((r) => {
    const creditDollars = centsToDollars(r.creditAmountCents);
    const label = r.label ?? undefined;

    const maxExclusive = r.maxUsageKWh == null ? null : r.maxUsageKWh;
    if (r.minUsageKWh === 0 && maxExclusive == null) {
      return { type: "FLAT_MONTHLY_CREDIT", creditDollars, ...(label ? { label } : {}) };
    }
    return {
      type: "USAGE_RANGE_CREDIT",
      creditDollars,
      minKwhInclusive: r.minUsageKWh,
      maxKwhExclusive: maxExclusive,
      ...(label ? { label } : {}),
    };
  });

  // Fail-closed on overlapping USAGE_RANGE_CREDIT rules (ambiguous whether additive or choose-one).
  const ranges = rules
    .filter((x): x is Extract<BillCreditRule, { type: "USAGE_RANGE_CREDIT" }> => x.type === "USAGE_RANGE_CREDIT")
    .map((r) => ({
      min: r.minKwhInclusive,
      max: r.maxKwhExclusive ?? Number.POSITIVE_INFINITY,
      label: r.label ?? "",
      creditDollars: r.creditDollars,
    }))
    .sort((a, b) => a.min - b.min);

  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]!;
      const b = ranges[j]!;
      const overlaps = a.min < b.max && b.min < a.max;
      if (overlaps) {
        // Allow exact duplicates (same range + same credit) as non-harmful.
        const same =
          a.min === b.min &&
          a.max === b.max &&
          Math.abs(a.creditDollars - b.creditDollars) < 1e-9;
        if (!same) return { ok: false, reason: "UNSUPPORTED_CREDIT_COMBINATION", notes: ["overlapping_usage_ranges"] };
      }
    }
  }

  notes.push("deterministic_bill_credits");
  notes.push("range_semantics: minInclusive <= kWh < maxExclusive (or no max)");
  return { ok: true, credits: { rules, notes } };
}

export function applyBillCreditsToMonth(args: {
  monthlyKwh: number;
  credits: DeterministicBillCredits;
}): {
  creditCentsTotal: number; // negative cents (discount)
  applied: Array<{ rule: BillCreditRule; applied: boolean; creditCents: number }>;
} {
  const kwh = Math.max(0, safeNum(args.monthlyKwh) ?? 0);
  const rules = Array.isArray(args.credits?.rules) ? args.credits.rules : [];

  let totalCents = 0;
  const applied: Array<{ rule: BillCreditRule; applied: boolean; creditCents: number }> = [];

  for (const r of rules) {
    if (r.type === "FLAT_MONTHLY_CREDIT") {
      const cents = Math.round((safeNum(r.creditDollars) ?? 0) * 100);
      const credit = -Math.abs(cents);
      totalCents += credit;
      applied.push({ rule: r, applied: true, creditCents: credit });
      continue;
    }

    const min = Math.max(0, safeNum(r.minKwhInclusive) ?? 0);
    const maxEx = r.maxKwhExclusive == null ? null : Math.max(0, safeNum(r.maxKwhExclusive) ?? 0);
    const qualifies = kwh >= min && (maxEx == null ? true : kwh < maxEx);
    const cents = Math.round((safeNum(r.creditDollars) ?? 0) * 100);
    const credit = qualifies ? -Math.abs(cents) : 0;
    totalCents += credit;
    applied.push({ rule: r, applied: qualifies, creditCents: credit });
  }

  return { creditCentsTotal: totalCents, applied };
}

