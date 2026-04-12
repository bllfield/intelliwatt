import { describe, expect, it } from "vitest";
import {
  buildActualDiagnosticsHeaderReadout,
  buildPersistedHouseReadout,
} from "@/app/admin/tools/gapfill-lab/readoutTruth";

describe("GapFill readout truth cleanup", () => {
  it("keeps persisted identity values on the same shared diagnostics path while clarifying unavailable fields", () => {
    const readout = buildPersistedHouseReadout({
      dataset: {
        meta: {
          lockboxInput: {
            mode: "MANUAL_MONTHLY",
          },
        },
      },
      sharedDiagnostics: {
        identityContext: {
          sourceHouseId: "source-house-1",
          profileHouseId: "profile-house-2",
          inputHash: "input-hash-3",
          fullChainHash: "full-chain-4",
        },
        sourceTruthContext: {
          intervalSourceIdentity: "interval-fingerprint-5",
          weatherDatasetIdentity: "weather-identity-6",
          intervalUsageFingerprintIdentity: "usage-shape-7",
        },
        lockboxExecutionSummary: {},
        projectionReadSummary: {},
      },
    });

    expect(readout.sourceHouseId).toBe("source-house-1");
    expect(readout.profileHouseId).toBe("profile-house-2");
    expect(readout.intervalFingerprint).toBe("interval-fingerprint-5");
    expect(readout.weatherIdentity).toBe("weather-identity-6");
    expect(readout.usageShapeProfileIdentity).toBe("usage-shape-7");
    expect(readout.inputHash).toBe("input-hash-3");
    expect(readout.fullChainHash).toBe("full-chain-4");
    expect(readout.sourceDerivedMonthlyTotalsKwhByMonth).toBe("not shown in this mode");
    expect(readout.sourceDerivedAnnualTotalKwh).toBe("not shown in this mode");
  });

  it("projects actual-house header identities from the existing shared diagnostics owner", () => {
    const readout = buildActualDiagnosticsHeaderReadout({
      pastSimSnapshot: {
        sharedDiagnostics: {
          identityContext: {
            sourceHouseId: "source-house-9",
            profileHouseId: "profile-house-10",
          },
          sourceTruthContext: {
            weatherDatasetIdentity: "weather-identity-11",
            intervalSourceIdentity: "interval-fingerprint-12",
          },
        },
        recalc: {
          executionMode: "inline",
          correlationId: "corr-13",
        },
        build: {
          mode: "artifact",
          buildInputsHash: "build-inputs-14",
        },
      },
      actualHouseBaselineDataset: {
        meta: {},
      },
    });

    expect(readout).toEqual({
      recalcExecutionMode: "inline",
      recalcCorrelationId: "corr-13",
      buildMode: "artifact",
      buildInputsHash: "build-inputs-14",
      sourceHouseId: "source-house-9",
      profileHouseId: "profile-house-10",
      weatherIdentity: "weather-identity-11",
      intervalFingerprint: "interval-fingerprint-12",
    });
  });

  it("uses explicit attachment labels instead of misleading blanks when actual-house identity fields are absent", () => {
    const readout = buildActualDiagnosticsHeaderReadout({
      pastSimSnapshot: {
        sharedDiagnostics: {
          identityContext: {},
          sourceTruthContext: {},
        },
      },
      actualHouseBaselineDataset: {
        meta: {},
      },
    });

    expect(readout.sourceHouseId).toBe("not attached on this actual-house read");
    expect(readout.profileHouseId).toBe("not attached on this actual-house read");
    expect(readout.weatherIdentity).toBe("not attached on this actual-house read");
    expect(readout.intervalFingerprint).toBe("not attached on this actual-house read");
  });
});
