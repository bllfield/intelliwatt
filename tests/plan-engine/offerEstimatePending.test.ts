import { describe, expect, it } from "vitest";

import {
  classifyOfferEstimateUiState,
  countActivelyPendingOffers,
  isOfferEstimateActivelyPending,
} from "@/lib/plan-engine/offerEstimatePending";

describe("offerEstimatePending", () => {
  it("does not treat missing-EFL template gaps as actively pending", () => {
    const offer = {
      efl: {},
      intelliwatt: {
        statusLabel: "QUEUED",
        trueCostEstimate: { status: "MISSING_TEMPLATE" },
      },
    };
    expect(isOfferEstimateActivelyPending(offer)).toBe(false);
    expect(classifyOfferEstimateUiState(offer)).toBe("UNAVAILABLE");
  });

  it("keeps EFL-backed template gaps in the active pending bucket", () => {
    const offer = {
      efl: { eflUrl: "https://example.com/efl.pdf" },
      intelliwatt: {
        statusLabel: "QUEUED",
        templateAvailable: false,
        trueCostEstimate: { status: "MISSING_TEMPLATE" },
      },
    };
    expect(isOfferEstimateActivelyPending(offer)).toBe(true);
    expect(classifyOfferEstimateUiState(offer)).toBe("CALCULATING");
  });

  it("treats cache misses on mapped plans as actively pending", () => {
    const offer = {
      efl: { eflUrl: "https://example.com/efl.pdf" },
      intelliwatt: {
        statusLabel: "QUEUED",
        templateAvailable: true,
        ratePlanId: "rp-1",
        trueCostEstimate: { status: "NOT_IMPLEMENTED", reason: "CACHE_MISS" },
      },
    };
    expect(isOfferEstimateActivelyPending(offer)).toBe(true);
    expect(classifyOfferEstimateUiState(offer)).toBe("CALCULATING");
  });

  it("does not treat NOT_COMPUTABLE plans as actively pending", () => {
    const offer = {
      efl: { eflUrl: "https://example.com/efl.pdf" },
      intelliwatt: {
        statusLabel: "QUEUED",
        trueCostEstimate: { status: "NOT_COMPUTABLE", reason: "UNSUPPORTED_TOU" },
      },
    };
    expect(isOfferEstimateActivelyPending(offer)).toBe(false);
    expect(classifyOfferEstimateUiState(offer)).toBe("UNAVAILABLE");
  });

  it("does not count terminal QUEUED rows in actively pending totals", () => {
    const offers = [
      {
        efl: { eflUrl: "https://example.com/efl.pdf" },
        intelliwatt: {
          statusLabel: "QUEUED",
          trueCostEstimate: { status: "NOT_COMPUTABLE", reason: "UNSUPPORTED_TOU" },
        },
      },
      {
        efl: { eflUrl: "https://example.com/efl.pdf" },
        intelliwatt: {
          statusLabel: "QUEUED",
          templateAvailable: true,
          trueCostEstimate: { status: "NOT_IMPLEMENTED", reason: "CACHE_MISS" },
        },
      },
    ];
    expect(countActivelyPendingOffers(offers)).toBe(1);
  });
});
