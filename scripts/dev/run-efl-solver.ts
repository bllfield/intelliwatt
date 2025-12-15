import fs from "node:fs/promises";
import path from "node:path";

import type { PlanRules, RateStructure } from "@/lib/efl/planEngine";
import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

async function main() {
  const fixturePath = path.join(
    process.cwd(),
    "fixtures",
    "efl",
    "txu-masked-tdsp-example.txt",
  );

  const rawText = await fs.readFile(fixturePath, "utf8");

  // Minimal synthetic PlanRules/RateStructure for local sanity checks.
  const planRules: PlanRules = {
    planType: "flat",
    defaultRateCentsPerKwh: 14,
    baseChargePerMonthCents: 0,
    timeOfUsePeriods: [],
    solarBuyback: null,
    billCredits: [],
  };

  const rateStructure: RateStructure = {
    type: "FIXED",
    baseMonthlyFeeCents: 0,
    tdspDeliveryIncludedInEnergyCharge: null,
    usageTiers: null,
    energyRateCents: 14,
  };

  const baseValidation = await validateEflAvgPriceTable({
    rawText,
    planRules,
    rateStructure,
  });

  const solved = await solveEflValidationGaps({
    rawText,
    planRules,
    rateStructure,
    validation: baseValidation,
  });

  // Print a compact before/after summary.
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        before: {
          status: baseValidation.status,
          tdspAppliedMode: baseValidation.assumptionsUsed?.tdspAppliedMode,
        },
        after: {
          status: solved.validationAfter?.status ?? null,
          tdspAppliedMode:
            solved.validationAfter?.assumptionsUsed?.tdspAppliedMode ?? null,
          solverApplied: solved.solverApplied,
          solveMode: solved.solveMode,
          queueReason: solved.queueReason ?? null,
        },
      },
      null,
      2,
    ),
  );
}

void main();


