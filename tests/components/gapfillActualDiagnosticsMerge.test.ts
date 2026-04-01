import { describe, expect, it } from "vitest";
import { mergeActualHouseDiagnosticsSnapshot } from "@/app/admin/tools/gapfill-lab/actualHouseDiagnosticsMerge";

describe("mergeActualHouseDiagnosticsSnapshot", () => {
  it("preserves the loaded actual-house snapshot while grafting in engine diagnostics", () => {
    const previousSnapshot = {
      recalc: {
        executionMode: "inline",
        correlationId: "corr-1",
      },
      reads: {
        baselineProjection: {
          ok: true,
          dataset: { summary: { totalKwh: 123 } },
        },
      },
      sharedDiagnostics: {
        identityContext: {
          callerType: "gapfill_actual",
        },
      },
      engineContext: null,
    };
    const diagnosticsSnapshot = {
      recalc: {
        executionMode: "not_run",
        correlationId: "corr-2",
      },
      reads: {
        baselineProjection: null,
      },
      engineContext: {
        identity: {
          intervalDataFingerprint: "ifp-1",
        },
      },
    };

    const merged = mergeActualHouseDiagnosticsSnapshot(previousSnapshot, diagnosticsSnapshot);

    expect(merged).toEqual({
      recalc: {
        executionMode: "inline",
        correlationId: "corr-1",
      },
      reads: {
        baselineProjection: {
          ok: true,
          dataset: { summary: { totalKwh: 123 } },
        },
      },
      sharedDiagnostics: {
        identityContext: {
          callerType: "gapfill_actual",
        },
      },
      engineContext: {
        identity: {
          intervalDataFingerprint: "ifp-1",
        },
      },
    });
  });

  it("falls back to the diagnostics snapshot when no previous snapshot exists", () => {
    const diagnosticsSnapshot = {
      engineContext: {
        identity: {
          intervalDataFingerprint: "ifp-1",
        },
      },
    };

    expect(mergeActualHouseDiagnosticsSnapshot(null, diagnosticsSnapshot)).toEqual(diagnosticsSnapshot);
  });
});
