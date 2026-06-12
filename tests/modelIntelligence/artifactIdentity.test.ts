import { describe, expect, it } from "vitest";
import { extractModelIntelligenceOnePathRunReadback } from "@/modules/modelIntelligence/onePathDispatchPlan";

describe("model intelligence artifact identity", () => {
  it("derives immutable artifact keys when the artifact omits immutableArtifactKey", () => {
    const readback = extractModelIntelligenceOnePathRunReadback({
      ok: true,
      runType: "PAST_SIM",
      artifact: {
        scenarioId: "scenario-monthly",
        artifactId: "cache-row-monthly",
        artifactInputHash: "hash-monthly",
      },
    });

    expect(readback.immutableArtifactKey).toBe("scenario-monthly:hash-monthly");
  });

  it("extracts immutable artifact identity and provenance from debug One Path responses", () => {
    const monthlyReadback = extractModelIntelligenceOnePathRunReadback(
      {
        ok: true,
        runType: "PAST_SIM",
        adminManualPayloadProvenance: {
          payloadFreshlyDerived: true,
          savedLabPayloadIgnored: true,
          sourceHouseId: "source-1",
          labHouseId: "lab-1",
          actualContextHouseId: "source-1",
          derivedMonthlyTotalKwh: 12000,
          manualPayloadHashMonthly: "monthly-hash",
        },
        artifact: {
          scenarioId: "scenario-monthly",
          artifactId: "cache-row-monthly",
          immutableArtifactKey: "scenario-monthly:hash-monthly",
          artifactInputHash: "hash-monthly",
          buildInputsHash: "build-monthly",
          engineVersion: "past_v1",
        },
        runDisplayView: {
          summary: { coverageStart: "2025-04-15", coverageEnd: "2026-04-14", totalKwh: 12000 },
        },
      },
      { mode: "MANUAL_MONTHLY", houseId: "lab-1", sourceHouseId: "source-1", actualContextHouseId: "source-1" }
    );
    const annualReadback = extractModelIntelligenceOnePathRunReadback(
      {
        ok: true,
        runType: "PAST_SIM",
        adminManualPayloadProvenance: {
          payloadFreshlyDerived: true,
          savedLabPayloadIgnored: true,
          sourceHouseId: "source-1",
          labHouseId: "lab-1",
          actualContextHouseId: "source-1",
          derivedAnnualTotalKwh: 14456,
          manualPayloadHashAnnual: "annual-hash",
        },
        artifact: {
          scenarioId: "scenario-annual",
          artifactId: "cache-row-annual",
          immutableArtifactKey: "scenario-annual:hash-annual",
          artifactInputHash: "hash-annual",
          buildInputsHash: "build-annual",
          engineVersion: "past_v1",
        },
        runDisplayView: {
          summary: { coverageStart: "2025-04-15", coverageEnd: "2026-04-14", totalKwh: 14456 },
        },
      },
      { mode: "MANUAL_ANNUAL", houseId: "lab-1", sourceHouseId: "source-1", actualContextHouseId: "source-1" }
    );

    expect(monthlyReadback.scenarioId).toBe("scenario-monthly");
    expect(annualReadback.scenarioId).toBe("scenario-annual");
    expect(monthlyReadback.scenarioId).not.toBe(annualReadback.scenarioId);
    expect(monthlyReadback.artifactId).toBe("cache-row-monthly");
    expect(annualReadback.artifactId).toBe("cache-row-annual");
    expect(monthlyReadback.artifactId).not.toBe(annualReadback.artifactId);
    expect(monthlyReadback.immutableArtifactKey).toBe("scenario-monthly:hash-monthly");
    expect(annualReadback.immutableArtifactKey).toBe("scenario-annual:hash-annual");
    expect(monthlyReadback.immutableArtifactKey).not.toBe(annualReadback.immutableArtifactKey);
    expect(monthlyReadback.payloadFreshlyDerived).toBe(true);
    expect(monthlyReadback.savedLabPayloadIgnored).toBe(true);
    expect(monthlyReadback.actualContextHouseId).toBe("source-1");
    expect(monthlyReadback.manualPayloadHash).toBe("monthly-hash");
    expect(annualReadback.manualPayloadHash).toBe("annual-hash");
  });
});
