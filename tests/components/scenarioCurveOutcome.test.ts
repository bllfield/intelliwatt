import { describe, expect, it } from "vitest";
import {
  recalcUserMessageFromResponse,
  scenarioCurveOutcomeFromFetch,
} from "@/components/usage/scenarioCurveOutcome";

describe("scenarioCurveOutcomeFromFetch", () => {
  it("returns success for ok JSON", () => {
    expect(
      scenarioCurveOutcomeFromFetch({
        httpOk: true,
        httpStatus: 200,
        json: { ok: true },
        aborted: false,
        curveLabel: "Past",
      }).kind
    ).toBe("success");
  });

  it("maps 404 NO_BUILD to no_build", () => {
    const o = scenarioCurveOutcomeFromFetch({
      httpOk: false,
      httpStatus: 404,
      json: { ok: false, code: "NO_BUILD", message: "Recalculate first." },
      aborted: false,
      curveLabel: "Past",
    });
    expect(o.kind).toBe("no_build");
    if (o.kind === "no_build") expect(o.code).toBe("NO_BUILD");
  });

  it("maps gateway timeout", () => {
    const o = scenarioCurveOutcomeFromFetch({
      httpOk: false,
      httpStatus: 504,
      json: { ok: false, message: "timeout" },
      aborted: false,
      curveLabel: "Future",
    });
    expect(o.kind).toBe("timeout");
  });

  it("maps abort to timeout-style outcome", () => {
    const o = scenarioCurveOutcomeFromFetch({
      httpOk: false,
      httpStatus: 0,
      json: null,
      aborted: true,
      curveLabel: "Past",
    });
    expect(o.kind).toBe("timeout");
  });
});

describe("recalcUserMessageFromResponse", () => {
  it("detects recalc timeout from body", () => {
    const r = recalcUserMessageFromResponse({
      httpOk: false,
      httpStatus: 504,
      json: { ok: false, error: "recalc_timeout", failureCode: "RECALC_TIMEOUT" },
    });
    expect(r.tone).toBe("timeout");
  });

  it("returns success for ok inline recalc", () => {
    const r = recalcUserMessageFromResponse({
      httpOk: true,
      httpStatus: 200,
      json: { ok: true, houseId: "h1" },
    });
    expect(r.tone).toBe("success");
  });
});
