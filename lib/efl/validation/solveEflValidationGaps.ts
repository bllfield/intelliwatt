import type { PlanRules, RateStructure } from "@/lib/efl/planEngine";
import type { EflAvgPriceValidation } from "@/lib/efl/eflValidator";
import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";

export type EflValidationGapSolveMode = "NONE" | "PASS_WITH_ASSUMPTIONS" | "FAIL";

export interface EflValidationGapSolveResult {
  derivedPlanRules: PlanRules | any | null;
  derivedRateStructure: RateStructure | any | null;
  solverApplied: string[];
  assumptionsUsed: EflAvgPriceValidation["assumptionsUsed"] | Record<string, any>;
  validationAfter: EflAvgPriceValidation | null;
  solveMode: EflValidationGapSolveMode;
  queueReason?: string;
}

export async function solveEflValidationGaps(args: {
  rawText: string;
  planRules: PlanRules | any | null;
  rateStructure: RateStructure | any | null;
  validation: EflAvgPriceValidation | null;
}): Promise<EflValidationGapSolveResult> {
  const { rawText, planRules, rateStructure, validation } = args;

  // Clone planRules shallowly so we can add usageTiers without mutating callers.
  const derivedPlanRules: any = planRules ? { ...(planRules as any) } : null;
  let derivedRateStructure: any = rateStructure ?? null;

  const solverApplied: string[] = [];

  // ---------------- Tier sync from RateStructure -> PlanRules ----------------
  if (derivedPlanRules && derivedRateStructure) {
    const existingTiers: any[] = Array.isArray(derivedPlanRules.usageTiers)
      ? derivedPlanRules.usageTiers
      : [];

    // Support both RateStructure.usageTiers (CDM) and the older "array of tier
    // rows" shape used by some admin tools.
    const rsUsageTiers: any[] = Array.isArray(
      (derivedRateStructure as any).usageTiers,
    )
      ? (derivedRateStructure as any).usageTiers
      : Array.isArray(derivedRateStructure)
        ? (derivedRateStructure as any[])
        : [];

    if (rsUsageTiers.length > 0) {
      const shouldSync =
        !Array.isArray(derivedPlanRules.usageTiers) ||
        existingTiers.length === 0 ||
        existingTiers.length < rsUsageTiers.length;

      if (shouldSync) {
        const mapped = rsUsageTiers
          .map((t) => {
            const minRaw =
              t?.minKWh ?? t?.minKwh ?? t?.tierMinKwh ?? t?.tierMinKWh ?? 0;
            const maxRaw =
              t?.maxKWh ?? t?.maxKwh ?? t?.tierMaxKwh ?? t?.tierMaxKWh;

            const min = Number(minRaw);
            const max =
              maxRaw == null || !Number.isFinite(Number(maxRaw))
                ? null
                : Number(maxRaw);

            let rate = t?.centsPerKWh ?? t?.rateCentsPerKwh;
            if (
              rate == null &&
              typeof t?.energyCharge === "number" &&
              Number.isFinite(t.energyCharge)
            ) {
              // Convert USD/kWh -> cents/kWh for older tier rows.
              rate = t.energyCharge * 100;
            }
            const rateNum = Number(rate);
            if (!Number.isFinite(rateNum)) return null;

            return {
              minKwh: Number.isFinite(min) ? min : 0,
              maxKwh: max,
              rateCentsPerKwh: rateNum,
            };
          })
          .filter(Boolean)
          // Ensure tiers are ordered by minKwh so downstream math behaves.
          .sort((a: any, b: any) => a.minKwh - b.minKwh);

        if (mapped.length > 0) {
          derivedPlanRules.usageTiers = mapped;
          solverApplied.push("TIER_SYNC_FROM_RATE_STRUCTURE");
        }
      }
    }
  }

  // ---------------- Tier sync from EFL raw text (deterministic) ----------------
  // If usageTiers are still missing or clearly incomplete (e.g. only first tier
  // present when the EFL lists multiple tiers), re-derive from the raw text.
  if (derivedPlanRules) {
    const existingTiers: any[] = Array.isArray(derivedPlanRules.usageTiers)
      ? derivedPlanRules.usageTiers
      : [];

    const tiersFromText = extractUsageTiersFromEflText(rawText);

    const shouldApplyFromText =
      tiersFromText.length > 0 &&
      (existingTiers.length === 0 || existingTiers.length < tiersFromText.length);

    if (shouldApplyFromText) {
      derivedPlanRules.usageTiers = tiersFromText;
      solverApplied.push("SYNC_USAGE_TIERS_FROM_EFL_TEXT");
    }
  }

  // ---------------- TDSP gap heuristic (for observability only) ----------------
  const maskedTdsp =
    detectMaskedTdsp(rawText) &&
    (!!validation &&
      (validation.assumptionsUsed?.tdspAppliedMode === "NONE" ||
        validation.assumptionsUsed?.tdspAppliedMode === undefined));
  if (maskedTdsp) {
    solverApplied.push("TDSP_UTILITY_TABLE_CANDIDATE");
  }

  // ---------------- Base charge sync from EFL text ----------------
  if (derivedPlanRules && derivedPlanRules.baseChargePerMonthCents == null) {
    const baseCents = extractBaseChargeCentsFromEflText(rawText);
    if (baseCents != null) {
      derivedPlanRules.baseChargePerMonthCents = baseCents;

      if (!derivedRateStructure) {
        // Minimal shape; callers treat this as partial RateStructure.
        derivedRateStructure = {};
      }

      if (
        derivedRateStructure &&
        typeof (derivedRateStructure as any).baseMonthlyFeeCents !== "number"
      ) {
        (derivedRateStructure as any).baseMonthlyFeeCents = baseCents;
      }

      solverApplied.push("SYNC_BASE_CHARGE_FROM_EFL_TEXT");
    }
  }

  // ---------------- Conditional service fee cutoff (<= N kWh) ----------------
  // Some EFLs describe a monthly/service fee that only applies up to a maximum usage,
  // e.g., "Monthly Service Fee $8.00 per billing cycle for usage (<=1999) kWh".
  //
  // The canonical RateStructure contract does not currently support conditional base fees.
  // For validation math (and downstream persistence), we model this as:
  //   baseMonthlyFeeCents = feeCents
  //   AND a "bill credit" of feeCents that applies when usage >= (maxKwh + 1)
  //
  // This makes the fee apply for 500/1000 but net to $0 at 2000+ (matching the EFL table),
  // without introducing supplier-specific patches.
  if (validation?.status === "FAIL" && derivedPlanRules) {
    const fee = extractMonthlyServiceFeeCutoff(rawText);
    if (fee && fee.feeCents > 0 && fee.maxUsageKwh >= 1) {
      const alreadyHasBase =
        typeof derivedPlanRules.baseChargePerMonthCents === "number" ||
        (derivedRateStructure &&
          typeof (derivedRateStructure as any).baseMonthlyFeeCents === "number");

      const thresholdKwh = fee.maxUsageKwh + 1;
      const inferredOk = baseFeeInferredFromValidation({
        validation,
        feeCents: fee.feeCents,
        maxUsageKwh: fee.maxUsageKwh,
      });

      if (!alreadyHasBase && inferredOk) {
        // Apply base fee
        derivedPlanRules.baseChargePerMonthCents = fee.feeCents;
        if (!derivedRateStructure) derivedRateStructure = {};
        if (typeof (derivedRateStructure as any).baseMonthlyFeeCents !== "number") {
          (derivedRateStructure as any).baseMonthlyFeeCents = fee.feeCents;
        }

        // Apply offsetting credit at >= threshold
        const rsCredits = (derivedRateStructure as any).billCredits;
        const rules: any[] =
          rsCredits && Array.isArray(rsCredits.rules) ? rsCredits.rules : [];
        const hasSame =
          rules.some(
            (r) =>
              Number(r?.creditAmountCents) === fee.feeCents &&
              Number(r?.minUsageKWh) === thresholdKwh,
          ) ?? false;
        if (!hasSame) {
          const nextRules = [
            ...rules,
            {
              label: `Service fee waived at >= ${thresholdKwh} kWh (derived from <=${fee.maxUsageKwh} fee)`,
              creditAmountCents: fee.feeCents,
              minUsageKWh: thresholdKwh,
            },
          ];
          (derivedRateStructure as any).billCredits = {
            hasBillCredit: true,
            rules: nextRules,
          };
        }

        // Mirror to PlanRules billCredits for consistency/debugging.
        const prCredits: any[] = Array.isArray(derivedPlanRules.billCredits)
          ? derivedPlanRules.billCredits
          : [];
        const hasPrSame =
          prCredits.some(
            (r) =>
              Number(r?.creditDollars) === fee.feeCents / 100 &&
              Number(r?.thresholdKwh) === thresholdKwh,
          ) ?? false;
        if (!hasPrSame) {
          derivedPlanRules.billCredits = [
            ...prCredits,
            {
              label: `Service fee waived at >= ${thresholdKwh} kWh (derived)`,
              creditDollars: fee.feeCents / 100,
              thresholdKwh: thresholdKwh,
              monthsOfYear: null,
              type: "THRESHOLD_MIN",
            },
          ];
        }

        solverApplied.push("SERVICE_FEE_CUTOFF_MAXKWH_TO_BASE_PLUS_CREDIT");
      }
    }
  }

  // If nothing was applied, return quickly with the original validation.
  if (solverApplied.length === 0) {
    return {
      derivedPlanRules,
      derivedRateStructure,
      solverApplied,
      assumptionsUsed: validation?.assumptionsUsed ?? {},
      validationAfter: validation,
      solveMode: "NONE",
      queueReason: validation?.queueReason,
    };
  }

  // Re-run validator with the derived shapes. The validator itself already
  // knows how to consult the Utility/TDSP tariff table when TDSP is masked
  // on the EFL, so we do not duplicate that logic here.
  const validationAfter = await validateEflAvgPriceTable({
    rawText,
    planRules: (derivedPlanRules as PlanRules) ?? (planRules as PlanRules),
    rateStructure:
      (derivedRateStructure as RateStructure) ?? (rateStructure as RateStructure),
    toleranceCentsPerKwh: validation?.toleranceCentsPerKwh,
  });

  let solveMode: EflValidationGapSolveMode = "NONE";
  if (validationAfter.status === "PASS") {
    solveMode = "PASS_WITH_ASSUMPTIONS";
  } else if (validationAfter.status === "FAIL") {
    solveMode = "FAIL";
  }

  return {
    derivedPlanRules,
    derivedRateStructure,
    solverApplied,
    assumptionsUsed: validationAfter.assumptionsUsed,
    validationAfter,
    solveMode,
    queueReason: validationAfter.queueReason,
  };
}

// Simple masked-TDSP detector used only for solverApplied/debugging.
function detectMaskedTdsp(rawText: string): boolean {
  const t = rawText.toLowerCase();
  const hasStars = t.includes("**");
  if (!hasStars) return false;

  const hasPassThrough =
    /tdu\s+delivery\s+charges/i.test(rawText) ||
    /tdu\s+charges/i.test(rawText) ||
    /tdsp\s+charges/i.test(rawText) ||
    /passed\s+through/i.test(t) ||
    /passed-through/i.test(t);

  return hasStars && hasPassThrough;
}

// Deterministic tier extractor mirroring the core Energy Charge parsing used
// by the EFL extractor. This is intentionally duplicated at a high level so
// the solver can recover from cases where only the first tier made it into
// PlanRules but the raw text clearly lists multiple tiers.
function extractUsageTiersFromEflText(rawText: string): Array<{
  minKwh: number;
  maxKwh: number | null;
  rateCentsPerKwh: number;
}> {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  type Tier = { minKwh: number; maxKwh: number | null; rateCentsPerKwh: number };
  const tiers: Tier[] = [];

  // Line-based patterns:
  //   "0 - 1200 kWh 12.5000¢"
  //   "> 1200 kWh 20.4000¢"
  const rangeRe =
    /^(\d{1,6})\s*-\s*(\d{1,6})\s*kwh\b[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢/i;
  const gtRe = />\s*(\d{1,6})\s*kwh\b[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢/i;

  // Anchor search window near "Energy Charge" lines.
  const anchorIdx = lines.findIndex((l) => /Energy\s*Charge/i.test(l));
  const search = anchorIdx >= 0 ? lines.slice(anchorIdx, anchorIdx + 80) : lines;

  const centsFrom = (raw: string): number | null => {
    const cleaned = raw.replace(/,/g, "");
    const m = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!m?.[1]) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };

  for (const l of search) {
    let m = l.match(rangeRe);
    if (m?.[1] && m?.[2] && m?.[3]) {
      const minKwh = Number(m[1]);
      const maxKwh = Number(m[2]);
      const rate = centsFrom(m[3]);
      if (
        Number.isFinite(minKwh) &&
        Number.isFinite(maxKwh) &&
        rate != null
      ) {
        tiers.push({ minKwh, maxKwh, rateCentsPerKwh: rate });
      }
      continue;
    }

    m = l.match(gtRe);
    if (m?.[1] && m?.[2]) {
      const boundary = Number(m[1]);
      const minKwh = Number.isFinite(boundary) ? boundary + 1 : boundary;
      const rate = centsFrom(m[2]);
      if (Number.isFinite(minKwh) && rate != null) {
        tiers.push({ minKwh, maxKwh: null, rateCentsPerKwh: rate });
      }
    }
  }

  // Also handle bracketed tiers as seen in some Rhythm-style EFLs:
  //   "Energy Charge: (0 to 1000 kWh) 10.9852¢ per kWh"
  //   "Energy Charge: (> 1000 kWh) 12.9852¢ per kWh"
  const bracketRe =
    /Energy\s*Charge\s*:\s*\(\s*(>?)\s*([0-9,]+)(?:\s*to\s*([0-9,]+))?\s*kwh\s*\)\s*([0-9]+(?:\.[0-9]+)?)\s*¢\s*(?:per|\/)\s*kwh/gi;

  let mBracket: RegExpExecArray | null;
  while ((mBracket = bracketRe.exec(rawText)) !== null) {
    const isGt = !!mBracket[1];
    const a = Number(mBracket[2].replace(/,/g, ""));
    const b = mBracket[3] ? Number(mBracket[3].replace(/,/g, "")) : null;
    const rate = centsFrom(mBracket[4]);
    if (!Number.isFinite(a) || (b != null && !Number.isFinite(b)) || rate == null) {
      continue;
    }
    const minKwh = isGt ? a + 1 : a;
    const maxKwh = isGt ? null : b;
    tiers.push({ minKwh, maxKwh, rateCentsPerKwh: rate });
  }

  // De-dup + sort by minKwh.
  const uniq = new Map<string, Tier>();
  for (const t of tiers) {
    const key = `${t.minKwh}|${t.maxKwh ?? "null"}|${t.rateCentsPerKwh}`;
    if (!uniq.has(key)) uniq.set(key, t);
  }

  return Array.from(uniq.values()).sort((a, b) => a.minKwh - b.minKwh);
}

// Deterministic base charge extractor (solver-only) mirroring the patterns in
// the main EFL extractor. This is intentionally local so the solver can fill
// in missing baseChargePerMonthCents/baseMonthlyFeeCents before re-validating.
function extractBaseChargeCentsFromEflText(rawText: string): number | null {
  const text = rawText || "";

  // Treat explicit N/A as "not present", not zero.
  if (/Base\s*(?:Monthly\s+)?Charge[^.\n]*\bN\/A\b|\bNA\b/i.test(text)) {
    return null;
  }

  // Explicit $0 per billing cycle/month.
  if (
    /Base\s*(?:Monthly\s+)?Charge\s*:\s*\$0\b[\s\S]{0,40}?per\s*(?:billing\s*cycle|month)/i.test(
      text,
    )
  ) {
    return 0;
  }

  // Variant: "Base Charge of $4.95 per ESI-ID will apply each billing cycle."
  {
    const ofRe =
      /Base\s+(?:Monthly\s+)?Charge\s+of\s*(?!.*\bN\/A\b)\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:per\s+ESI-?ID)?[\s\S]{0,60}?(?:will\s+apply)?\s*(?:each\s+billing\s+cycle|per\s+billing\s+cycle|per\s+month|\/\s*month|monthly)/i;
    const m = text.match(ofRe);
    if (m?.[1]) {
      const dollars = Number(m[1]);
      if (Number.isFinite(dollars)) {
        return Math.round(dollars * 100);
      }
    }
  }

  // Generic "Base Charge: $X per billing cycle/month" including "Base Monthly Charge".
  {
    const generic =
      /Base\s*(?:Monthly\s+)?Charge(?:\s*of)?\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b[\s\S]{0,80}?(?:per\s+(?:billing\s*cycle|month))/i;
    const m = text.match(generic);
    if (m?.[1]) {
      const dollars = Number(m[1]);
      if (Number.isFinite(dollars)) {
        return Math.round(dollars * 100);
      }
    }
  }

  return null;
}

function extractMonthlyServiceFeeCutoff(rawText: string): { feeCents: number; maxUsageKwh: number } | null {
  const t = rawText || "";
  // Example:
  // "Monthly Service Fee                                      $8.00 per billing cycle for usage ( <=1999) kWh"
  const re =
    /Monthly\s+Service\s+Fee[\s\S]{0,120}?\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:per\s+billing\s*cycle|per\s+month|monthly)[\s\S]{0,160}?\(\s*<=\s*([0-9]{1,6})\s*\)\s*kwh/i;
  const m = t.match(re);
  if (!m?.[1] || !m?.[2]) return null;
  const dollars = Number(m[1]);
  const maxKwh = Number(String(m[2]).replace(/,/g, ""));
  if (!Number.isFinite(dollars) || !Number.isFinite(maxKwh) || maxKwh <= 0) return null;
  return { feeCents: Math.round(dollars * 100), maxUsageKwh: Math.round(maxKwh) };
}

function baseFeeInferredFromValidation(args: {
  validation: EflAvgPriceValidation;
  feeCents: number;
  maxUsageKwh: number;
}): boolean {
  const { validation, feeCents, maxUsageKwh } = args;
  const tol = typeof validation.toleranceCentsPerKwh === "number" ? validation.toleranceCentsPerKwh : 0.25;
  const pts: any[] = Array.isArray(validation.points) ? validation.points : [];
  if (pts.length < 2) return true; // best-effort

  // Require at least one "above cutoff" point that's already basically OK (otherwise this rule isn't a fit).
  const aboveOk = pts.some((p) => {
    const u = Number(p?.usageKwh);
    const diff = Number(p?.diffCentsPerKwh);
    if (!Number.isFinite(u) || !Number.isFinite(diff)) return false;
    if (u <= maxUsageKwh) return false;
    return Math.abs(diff) <= Math.max(tol, 0.35);
  });
  if (!aboveOk) return false;

  // Compare inferred missing cents for points at/below cutoff.
  const inferred: number[] = [];
  for (const p of pts) {
    const u = Number(p?.usageKwh);
    const diff = Number(p?.diffCentsPerKwh); // modeled - expected
    if (!Number.isFinite(u) || !Number.isFinite(diff)) continue;
    if (u > maxUsageKwh) continue;
    // We only care about cases where modeled is too low.
    if (diff >= 0) continue;
    const impliedMissingCents = Math.round((-diff) * u);
    if (Number.isFinite(impliedMissingCents)) inferred.push(impliedMissingCents);
  }
  if (inferred.length === 0) return false;

  const avg = inferred.reduce((a, b) => a + b, 0) / inferred.length;
  // Accept if inferred missing fee is within ~$0.75 of the stated fee.
  return Math.abs(avg - feeCents) <= 75;
}


