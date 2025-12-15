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
  if (
    derivedPlanRules &&
    (!Array.isArray(derivedPlanRules.usageTiers) ||
      (Array.isArray(derivedPlanRules.usageTiers) &&
        derivedPlanRules.usageTiers.length === 0)) &&
    derivedRateStructure &&
    Array.isArray((derivedRateStructure as any).usageTiers) &&
    (derivedRateStructure as any).usageTiers.length > 0
  ) {
    const rsTiers: any[] = (derivedRateStructure as any).usageTiers;
    derivedPlanRules.usageTiers = rsTiers
      .map((t) => {
        const min = Number(t?.minKWh ?? t?.minKwh ?? 0);
        const maxRaw = t?.maxKWh ?? t?.maxKwh;
        const max =
          maxRaw == null || !Number.isFinite(Number(maxRaw))
            ? null
            : Number(maxRaw);
        const rate = Number(t?.centsPerKWh ?? t?.rateCentsPerKwh);
        if (!Number.isFinite(rate)) return null;
        return {
          minKwh: Number.isFinite(min) ? min : 0,
          maxKwh: max,
          rateCentsPerKwh: rate,
        };
      })
      .filter(Boolean);

    if (
      Array.isArray(derivedPlanRules.usageTiers) &&
      derivedPlanRules.usageTiers.length > 0
    ) {
      solverApplied.push("TIER_SYNC_FROM_RATE_STRUCTURE");
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


