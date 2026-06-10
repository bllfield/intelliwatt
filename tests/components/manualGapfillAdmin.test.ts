import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
  MANUAL_GAPFILL_DEFAULT_MODE,
  MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
  MANUAL_GAPFILL_PIPELINE_STOP_AFTER_DRY_RUN_MESSAGE,
  buildManualGapfillIdentityKey,
  canContinuePipelineAfterPrepareSeed,
  extractArtifactInputHashFromRunResult,
  extractMonthlyCompareRowsFromCompareResult,
  extractReadbackSummaryFromRunResult,
  extractSeedHashFromPrepareResult,
  extractSeedPreviewFromPrepareResult,
  extractSourceIntervalFingerprint,
  fetchAdminUserByEmail,
  fetchManualGapfillCompare,
  fetchManualGapfillPrepareSeed,
  fetchManualGapfillRunReadback,
  fetchManualGapfillSourceContext,
  fetchValidationDayPolicyPreview,
  isPrepareSeedPersisted,
  MANUAL_GAPFILL_DEFAULT_USER_EMAIL,
  sameHouseBlocked,
} from "@/lib/admin/manualGapfillClient";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      policyRevision: "rev-1",
      policyLayer: "global_validation_day_policy_v1",
      policyHash: "policy-hash-snapshot",
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("manualGapfillClient step wiring", () => {
  it("resolves keeper user email via admin houses lookup", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        email: MANUAL_GAPFILL_DEFAULT_USER_EMAIL,
        userId: "user-keeper-1",
        houses: [{ id: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID, esiid: "esiid-1" }],
      }),
    });
    const res = await fetchAdminUserByEmail(MANUAL_GAPFILL_DEFAULT_USER_EMAIL);
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/houses/by-email?email=${encodeURIComponent(MANUAL_GAPFILL_DEFAULT_USER_EMAIL)}`,
      expect.objectContaining({ method: "GET", credentials: "include" })
    );
    if (res.ok) {
      expect(res.data.userId).toBe("user-keeper-1");
    }
  });

  it("step 1 posts source-context with diagnostics flag", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, context: { status: "available", fingerprints: { intervalFingerprint: "fp-1" } } }),
    });
    const res = await fetchManualGapfillSourceContext({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
      includeDiagnostics: true,
    });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tools/manual-gapfill/source-context",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID),
      })
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.includeDiagnostics).toBe(true);
    if (res.ok) {
      expect(extractSourceIntervalFingerprint(res.data.context)).toBe("fp-1");
    }
  });

  it("step 2 preview posts validation-day-policy for source home", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        policyHash: "policy-hash-2",
        selectedValidationDateKeys: ["2026-01-01"],
        diagnostics: { localGapFillSelectorUsed: false },
      }),
    });
    const res = await fetchValidationDayPolicyPreview({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
    });
    expect(res.ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.houseId).toBe(MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID);
    expect(body.surface).toBe("admin_lab");
  });

  it("step 3 dry-run defaults persistToLabHome false", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          status: "ready",
          seed: { normalizedPayloadHash: "seed-hash-1" },
          diagnostics: { persistRequested: false },
        },
      }),
    });
    await fetchManualGapfillPrepareSeed({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
      labHouseId: MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
      mode: MANUAL_GAPFILL_DEFAULT_MODE,
      persistToLabHome: false,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.persistToLabHome).toBe(false);
  });

  it("step 3 persist sends persistToLabHome true", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          status: "persisted",
          labContext: { wroteManualPayload: true, writeTarget: "lab_home_only" },
          seed: { normalizedPayloadHash: "seed-hash-2" },
        },
      }),
    });
    await fetchManualGapfillPrepareSeed({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
      labHouseId: MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
      mode: MANUAL_GAPFILL_DEFAULT_MODE,
      persistToLabHome: true,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.persistToLabHome).toBe(true);
  });

  it("step 4 run-readback forwards expected hashes when provided", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        result: { run: { artifactInputHash: "artifact-1", dispatched: true } },
      }),
    });
    await fetchManualGapfillRunReadback({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
      labHouseId: MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
      mode: MANUAL_GAPFILL_DEFAULT_MODE,
      expectedSeedHash: "seed-hash-1",
      expectedSourceFingerprint: "fp-1",
      expectedValidationDayPolicyHash: "policy-hash-1",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.expectedSeedHash).toBe("seed-hash-1");
    expect(body.expectedSourceFingerprint).toBe("fp-1");
    expect(body.expectedValidationDayPolicyHash).toBe("policy-hash-1");
    expect(body.persistRequested).toBe(true);
  });

  it("step 5 compare defaults includeDailyRows false and can enable daily rows", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          compare: {
            compareScope: "source_actual_vs_lab_simulated",
            dailyRows: [{ date: "2026-01-01", actualKwh: 10, simulatedKwh: 9 }],
          },
        },
      }),
    });
    await fetchManualGapfillCompare({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
      labHouseId: MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
      mode: MANUAL_GAPFILL_DEFAULT_MODE,
      includeDailyRows: false,
      expectedArtifactInputHash: "artifact-1",
    });
    let body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.includeDailyRows).toBe(false);
    expect(body.expectedArtifactInputHash).toBe("artifact-1");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { compare: { compareScope: "source_actual_vs_lab_simulated" } } }),
    });
    await fetchManualGapfillCompare({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
      labHouseId: MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
      mode: MANUAL_GAPFILL_DEFAULT_MODE,
      includeDailyRows: true,
    });
    body = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(body.includeDailyRows).toBe(true);
  });

  it("blocks same-house source and lab ids", () => {
    expect(sameHouseBlocked("house-a", "house-a")).toBe(true);
    expect(sameHouseBlocked("house-a", "house-b")).toBe(false);
  });

  it("extracts artifact hash from run result for step 5", () => {
    expect(
      extractArtifactInputHashFromRunResult({
        run: { artifactInputHash: "artifact-xyz" },
      })
    ).toBe("artifact-xyz");
    expect(
      extractSeedHashFromPrepareResult({
        seed: { normalizedPayloadHash: "seed-xyz" },
      })
    ).toBe("seed-xyz");
  });

  it("identity key changes when source/lab/mode changes", () => {
    const base = buildManualGapfillIdentityKey({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
      labHouseId: MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
      mode: MANUAL_GAPFILL_DEFAULT_MODE,
    });
    const changed = buildManualGapfillIdentityKey({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
      labHouseId: MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
    });
    expect(base).not.toBe(changed);
  });

  it("pipeline gating stops after dry-run when no persisted seed in session", () => {
    const dryRunResult = {
      status: "ready",
      seed: { normalizedPayloadHash: "seed-hash-dry" },
      labContext: { wroteManualPayload: false, writeTarget: "none" },
    };
    expect(isPrepareSeedPersisted(dryRunResult)).toBe(false);
    expect(
      canContinuePipelineAfterPrepareSeed({
        persistedSeedInSession: false,
        prepareResult: dryRunResult,
      })
    ).toBe(false);
    expect(MANUAL_GAPFILL_PIPELINE_STOP_AFTER_DRY_RUN_MESSAGE).toContain("Persist seed to lab home");
  });

  it("pipeline can continue when seed was persisted in session", () => {
    const dryRunResult = {
      status: "ready",
      seed: { normalizedPayloadHash: "seed-hash-dry" },
      labContext: { wroteManualPayload: false },
    };
    expect(
      canContinuePipelineAfterPrepareSeed({
        persistedSeedInSession: true,
        prepareResult: dryRunResult,
      })
    ).toBe(true);
  });

  it("extracts seed preview anchor, statement ranges, and monthly totals from MG-3 response", () => {
    const preview = extractSeedPreviewFromPrepareResult({
      seed: {
        manualUsageMode: "manual_monthly",
        anchorEndDate: "2025-08-06",
        totalKwh: 34590,
        billPeriodCount: 12,
        normalizedPayloadHash: "norm-hash",
        billPeriodHash: "bill-hash",
        validationResultHash: "val-hash",
        statementRanges: [{ month: "2025-06", startDate: "2025-06-08", endDate: "2025-06-30" }],
        monthlyTotalsKwhByMonth: { "2025-06": 2800 },
      },
    });
    expect(preview?.anchorEndDate).toBe("2025-08-06");
    expect(preview?.billPeriodCount).toBe(12);
    expect(preview?.statementRanges).toHaveLength(1);
    expect(preview?.statementRanges[0]?.startDate).toBe("2025-06-08");
    expect(preview?.monthlyTotalsKwhByMonth?.["2025-06"]).toBe(2800);
  });

  it("extracts readback bill match summary from MG-4 response", () => {
    const summary = extractReadbackSummaryFromRunResult({
      readback: {
        billMatchStatus: "pass",
        eligiblePeriodCount: 12,
        reconciledPeriodCount: 12,
        intervalShape: "estimated",
        baseload15MinKwh: 0.42,
        totalKwh: 34590,
        coverageStart: "2025-06-08",
        coverageEnd: "2026-06-07",
      },
    });
    expect(summary?.billMatchStatus).toBe("pass");
    expect(summary?.eligiblePeriodCount).toBe(12);
    expect(summary?.totalKwh).toBe(34590);
  });

  it("extracts monthly compare rows with source actual and lab simulated kWh fields", () => {
    const rows = extractMonthlyCompareRowsFromCompareResult({
      compare: {
        compareScope: "source_actual_vs_lab_simulated",
        monthly: {
          rows: [
            {
              periodId: "2025-06:2025-06-30",
              startDate: "2025-06-08",
              endDate: "2025-06-30",
              actualKwh: 2800,
              simulatedKwh: 2795,
              deltaKwh: -5,
              percentDelta: -0.18,
              status: "matched",
              actualSource: "SMT",
              simulatedSource: "SIMULATED_MANUAL_CONSTRAINED",
            },
          ],
        },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actualKwh).toBe(2800);
    expect(rows[0]?.simulatedKwh).toBe(2795);
    expect(rows[0]?.actualSource).toBe("SMT");
    expect(rows[0]?.simulatedSource).toBe("SIMULATED_MANUAL_CONSTRAINED");
  });

  it("surfaces API error payloads without throwing", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "compare_failed", message: "Lab readback missing" }),
    });
    const res = await fetchManualGapfillCompare({
      userId: "user-1",
      sourceHouseId: MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
      labHouseId: MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
      mode: MANUAL_GAPFILL_DEFAULT_MODE,
      includeDailyRows: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("Lab readback missing");
      expect(res.status).toBe(400);
    }
  });
});
