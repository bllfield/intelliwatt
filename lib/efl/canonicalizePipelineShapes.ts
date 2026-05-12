import { planRulesToRateStructure } from "@/lib/efl/planEngine";

export function canonicalizeRateStructureForPipeline(args: {
  finalStatus: string | null;
  planRules: any | null;
  rateStructure: any | null;
}): any | null {
  const { finalStatus, planRules, rateStructure } = args;
  if (finalStatus === "FAIL") return rateStructure ?? null;
  if (!planRules || typeof planRules !== "object") return rateStructure ?? null;

  try {
    const canonical = planRulesToRateStructure(planRules as any);
    if (!canonical || typeof canonical !== "object") return rateStructure ?? null;
    return {
      ...(rateStructure && typeof rateStructure === "object" ? rateStructure : {}),
      ...canonical,
    };
  } catch {
    return rateStructure ?? null;
  }
}
