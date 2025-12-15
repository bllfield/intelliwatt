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
  const derivedRateStructure: any = rateStructure ?? null;

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
      const minKwh = Number(m[1]);
      const rate = centsFrom(m[2]);
      if (Number.isFinite(minKwh) && rate != null) {
        tiers.push({ minKwh, maxKwh: null, rateCentsPerKwh: rate });
      }
    }
  }

  // De-dup + sort by minKwh.
  const uniq = new Map<string, Tier>();
  for (const t of tiers) {
    const key = `${t.minKwh}|${t.maxKwh ?? "null"}|${t.rateCentsPerKwh}`;
    if (!uniq.has(key)) uniq.set(key, t);
  }

  return Array.from(uniq.values()).sort((a, b) => a.minKwh - b.minKwh);
}


