import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
  MANUAL_GAPFILL_DEFAULT_MODE,
  MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
  buildManualGapfillIdentityKey,
  extractArtifactInputHashFromRunResult,
  extractSeedHashFromPrepareResult,
  extractSourceIntervalFingerprint,
  fetchManualGapfillCompare,
  fetchManualGapfillPrepareSeed,
  fetchManualGapfillRunReadback,
  fetchManualGapfillSourceContext,
  fetchValidationDayPolicyPreview,
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
