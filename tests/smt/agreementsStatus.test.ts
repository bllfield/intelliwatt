import { describe, expect, it } from "vitest";

import {
  isActiveSmtAgreementSummary,
  mapSmtAgreementStatus,
} from "@/lib/smt/agreements";

describe("mapSmtAgreementStatus", () => {
  it("does not treat Non Active - Terminated by CSP as ACTIVE", () => {
    expect(mapSmtAgreementStatus("Non Active - Terminated by CSP")).toBe("EXPIRED");
    expect(mapSmtAgreementStatus("Active - Authorization Confirmed")).toBe("ACTIVE");
    expect(mapSmtAgreementStatus("ACT")).toBe("ACTIVE");
  });
});

describe("isActiveSmtAgreementSummary", () => {
  it("prefers the active agreement over a terminated duplicate for the same ESIID", () => {
    const terminated = {
      agreementNumber: 3214970,
      status: "Non Active - Terminated by CSP",
      statusReason: null,
      esiid: "10400511114390001",
      raw: null,
    };
    const active = {
      agreementNumber: 3162880,
      status: "Active - Authorization Confirmed",
      statusReason: null,
      esiid: "10400511114390001",
      raw: null,
    };

    expect(isActiveSmtAgreementSummary(terminated)).toBe(false);
    expect(isActiveSmtAgreementSummary(active)).toBe(true);
  });
});
