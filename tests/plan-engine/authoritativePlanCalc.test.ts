import { describe, expect, it } from "vitest";

import { selectAuthoritativePlanCalc } from "@/lib/plan-engine/authoritativePlanCalc";
import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";

function makeConstellationUsageBillCreditRateStructure(creditAmountCents: number) {
  return {
    type: "FIXED",
    energyRateCents: 11.2,
    baseMonthlyFeeCents: 0,
    billCredits: {
      hasBillCredit: true,
      rules: [
        {
          label: `$${creditAmountCents / 100} >= 1000`,
          creditAmountCents,
          minUsageKWh: 1000,
        },
      ],
    },
    usageTiers: null,
  };
}

describe("authoritative plan calc selection", () => {
  it("keeps the admin-cleared Constellation 12 month offer computable for unchanged templates", () => {
    const rateStructure = makeConstellationUsageBillCreditRateStructure(3500);
    const persisted = derivePlanCalcRequirementsFromTemplate({ rateStructure });

    const selected = selectAuthoritativePlanCalc({
      rateStructure,
      stored: {
        planCalcStatus: "COMPUTABLE",
        planCalcReasonCode: "FIXED_PLUS_BILL_CREDITS_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: persisted.supportedFeatures,
      },
    });

    expect(selected.source).toBe("stored");
    expect(selected.planCalcStatus).toBe("COMPUTABLE");
    expect(selected.planCalcReasonCode).toBe("FIXED_PLUS_BILL_CREDITS_OK");
  });

  it("keeps the admin-cleared Constellation 24 month offer computable for unchanged templates", () => {
    const rateStructure = makeConstellationUsageBillCreditRateStructure(5000);
    const persisted = derivePlanCalcRequirementsFromTemplate({ rateStructure });

    const selected = selectAuthoritativePlanCalc({
      rateStructure,
      stored: {
        planCalcStatus: "COMPUTABLE",
        planCalcReasonCode: "FIXED_PLUS_BILL_CREDITS_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: persisted.supportedFeatures,
      },
    });

    expect(selected.source).toBe("stored");
    expect(selected.planCalcStatus).toBe("COMPUTABLE");
    expect(selected.planCalcReasonCode).toBe("FIXED_PLUS_BILL_CREDITS_OK");
  });

  it("re-derives when the stored fingerprint no longer matches the template", () => {
    const previousRateStructure = makeConstellationUsageBillCreditRateStructure(3500);
    const persisted = derivePlanCalcRequirementsFromTemplate({
      rateStructure: previousRateStructure,
    });
    const changedRateStructure = {
      ...previousRateStructure,
      energyRateCents: 14.9,
    };

    const selected = selectAuthoritativePlanCalc({
      rateStructure: changedRateStructure,
      stored: {
        planCalcStatus: "COMPUTABLE",
        planCalcReasonCode: "FIXED_PLUS_BILL_CREDITS_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: persisted.supportedFeatures,
      },
    });

    expect(selected.source).toBe("derived");
    expect(selected.fingerprintChanged).toBe(true);
  });
});
