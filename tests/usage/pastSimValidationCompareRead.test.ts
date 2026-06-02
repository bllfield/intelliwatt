import { describe, expect, it } from "vitest";
import {
  enrichPastDatasetValidationCompareMetaForRead,
  pastValidationCompareMayUseActualDataset,
  resolvePastSimPreferredActualSource,
} from "@/lib/usage/pastSimValidationCompareRead";

describe("pastSimValidationCompareRead", () => {
  it("resolves GREEN_BUTTON from artifact meta when request omits preferredActualSource", () => {
    expect(
      resolvePastSimPreferredActualSource({
        preferredActualSource: null,
        dataset: { meta: { actualSource: "GREEN_BUTTON" } },
      })
    ).toBe("GREEN_BUTTON");
  });

  it("does not fill GB validation actuals from an SMT sage dataset", () => {
    const enriched = enrichPastDatasetValidationCompareMetaForRead({
      dataset: {
        meta: {
          actualSource: "GREEN_BUTTON",
          validationOnlyDateKeysLocal: ["2026-04-16"],
          validationActualDailyKwhByDateLocal: { "2026-04-16": 21.18 },
        },
      },
      actualDataset: {
        summary: { source: "SMT" },
        daily: [{ date: "2026-04-16", kwh: 99 }],
      },
    });
    expect((enriched.meta as { validationActualDailyKwhByDateLocal?: Record<string, number> }).validationActualDailyKwhByDateLocal).toEqual({
      "2026-04-16": 21.18,
    });
  });

  it("pastValidationCompareMayUseActualDataset blocks SMT sage under GB Past", () => {
    expect(
      pastValidationCompareMayUseActualDataset({
        simulatedDataset: { meta: { actualSource: "GREEN_BUTTON" } },
        actualDataset: { summary: { source: "SMT" }, daily: [] },
      })
    ).toBe(false);
    expect(
      pastValidationCompareMayUseActualDataset({
        simulatedDataset: { meta: { actualSource: "GREEN_BUTTON" } },
        actualDataset: { meta: { actualSource: "GREEN_BUTTON" }, daily: [] },
      })
    ).toBe(true);
  });
});
