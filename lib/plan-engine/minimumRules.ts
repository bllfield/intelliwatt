export type MinimumRule =
  | { type: "MIN_USAGE_FEE"; thresholdKwhExclusive: number; feeDollars: number; label?: string }
  | { type: "MINIMUM_BILL"; minimumBillDollars: number; label?: string };

export type DeterministicMinimumRules = { rules: MinimumRule[]; notes: string[] };

type ExtractFailReason =
  | "NO_MIN_RULES"
  | "UNSUPPORTED_MIN_RULE_SHAPE"
  | "UNSUPPORTED_MIN_RULE_DIMENSION"
  | "UNSUPPORTED_MIN_RULE_DEPENDENCY"
  | "NON_DETERMINISTIC_MIN_RULE";

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

function dollarsFromAny(v: unknown): number | null {
  const n = safeNum(v);
  if (n == null) return null;
  // If it looks like cents, reject (we only accept dollars here).
  if (n > 0 && n < 0.01) return null;
  return n;
}

export function extractDeterministicMinimumRules(args: {
  rateStructure: any;
}):
  | { ok: true; minimum: DeterministicMinimumRules }
  | { ok: false; reason: ExtractFailReason; notes: string[] } {
  const notes: string[] = [];
  const rs = args.rateStructure;
  if (!rs || !isObject(rs)) return { ok: false, reason: "NO_MIN_RULES", notes: ["rateStructure_missing"] };

  const rules: MinimumRule[] = [];

  // 1) MIN_USAGE_FEE: currently represented by the EFL deterministic fallback as a negative "bill credit" rule.
  // We treat that as a fee when usage < thresholdKwhExclusive.
  const bc = (rs as any)?.billCredits;
  if (bc && isObject(bc) && Array.isArray((bc as any).rules)) {
    const raw = (bc as any).rules as any[];
    const minFeeCandidates = raw.filter((r) => {
      const label = String(r?.label ?? "");
      const cents = safeNum(r?.creditAmountCents);
      const minUsage = intOrNull(r?.minUsageKWh);
      return (
        typeof label === "string" &&
        /minimum\s*usage\s*fee/i.test(label) &&
        typeof cents === "number" &&
        Number.isFinite(cents) &&
        cents < 0 &&
        minUsage != null &&
        minUsage > 0
      );
    });

    if (minFeeCandidates.length > 1) {
      return { ok: false, reason: "UNSUPPORTED_MIN_RULE_SHAPE", notes: ["multiple_min_usage_fee_rules"] };
    }
    if (minFeeCandidates.length === 1) {
      const r = minFeeCandidates[0]!;
      const threshold = intOrNull(r?.minUsageKWh);
      const feeCentsAbs = Math.abs(intOrNull(r?.creditAmountCents) ?? 0);
      if (threshold == null || threshold <= 0 || feeCentsAbs <= 0) {
        return { ok: false, reason: "UNSUPPORTED_MIN_RULE_SHAPE", notes: ["invalid_min_usage_fee_rule"] };
      }
      rules.push({
        type: "MIN_USAGE_FEE",
        thresholdKwhExclusive: threshold,
        feeDollars: feeCentsAbs / 100,
        label: String(r?.label ?? "").trim() || undefined,
      });
      notes.push("min_usage_fee:from_negative_bill_credit_rule");
    }
  }

  // 2) MINIMUM_BILL: look for explicit structured dollars fields if present.
  // (We do NOT parse free text here.)
  const minBillDollars =
    dollarsFromAny((rs as any)?.minimumBillDollars) ??
    dollarsFromAny((rs as any)?.minimumBill) ??
    dollarsFromAny((rs as any)?.minimumChargeDollars) ??
    dollarsFromAny((rs as any)?.minBillDollars) ??
    null;

  if (minBillDollars != null) {
    if (minBillDollars < 0 || minBillDollars > 1000) {
      return { ok: false, reason: "UNSUPPORTED_MIN_RULE_SHAPE", notes: ["minimumBill_out_of_range"] };
    }
    rules.push({ type: "MINIMUM_BILL", minimumBillDollars: minBillDollars, label: "Minimum bill" });
    notes.push("minimum_bill:from_structured_field");
  }

  // Phase 1: at most one MIN_USAGE_FEE and one MINIMUM_BILL.
  const minUsageCount = rules.filter((r) => r.type === "MIN_USAGE_FEE").length;
  const minBillCount = rules.filter((r) => r.type === "MINIMUM_BILL").length;
  if (minUsageCount > 1 || minBillCount > 1) {
    return { ok: false, reason: "UNSUPPORTED_MIN_RULE_SHAPE", notes: ["multiple_minimum_rules"] };
  }

  if (rules.length === 0) return { ok: false, reason: "NO_MIN_RULES", notes: ["no_min_rules_found"] };
  return { ok: true, minimum: { rules, notes } };
}

export function applyMinimumRulesToMonth(args: {
  monthlyKwh: number;
  minimum: DeterministicMinimumRules;
  subtotalCents: number;
}): {
  minUsageFeeCents: number;
  totalCentsAfter: number;
  applied: Array<{ rule: MinimumRule; applied: boolean; deltaCents: number }>;
  minimumBillTopUpCents: number;
} {
  const monthlyKwh = Math.max(0, safeNum(args.monthlyKwh) ?? 0);
  const rules = Array.isArray(args.minimum?.rules) ? args.minimum.rules : [];

  let total = Math.max(0, Math.round(safeNum(args.subtotalCents) ?? 0));
  let minUsageFeeCents = 0;
  let minimumBillTopUpCents = 0;
  const applied: Array<{ rule: MinimumRule; applied: boolean; deltaCents: number }> = [];

  // 1) MIN_USAGE_FEE (add fee when usage < threshold)
  for (const r of rules) {
    if (r.type !== "MIN_USAGE_FEE") continue;
    const threshold = Math.max(0, safeNum(r.thresholdKwhExclusive) ?? 0);
    const feeCents = Math.max(0, Math.round((safeNum(r.feeDollars) ?? 0) * 100));
    const ok = threshold > 0 && feeCents >= 0 && monthlyKwh < threshold;
    const delta = ok ? feeCents : 0;
    total += delta;
    minUsageFeeCents += delta;
    applied.push({ rule: r, applied: ok, deltaCents: delta });
  }

  // 2) MINIMUM_BILL clamp
  const minBill = rules.find((r): r is Extract<MinimumRule, { type: "MINIMUM_BILL" }> => r.type === "MINIMUM_BILL");
  if (minBill) {
    const minCents = Math.max(0, Math.round((safeNum(minBill.minimumBillDollars) ?? 0) * 100));
    const ok = minCents > 0 && total < minCents;
    const delta = ok ? minCents - total : 0;
    if (ok) total = minCents;
    minimumBillTopUpCents += delta;
    applied.push({ rule: minBill, applied: ok, deltaCents: delta });
  }

  return { minUsageFeeCents, totalCentsAfter: total, applied, minimumBillTopUpCents };
}

