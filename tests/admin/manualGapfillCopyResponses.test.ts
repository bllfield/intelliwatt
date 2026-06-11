import { describe, expect, it } from "vitest";
import { buildManualGapfillAllResponsesPayload } from "@/lib/admin/manualGapfillCopyResponses";

describe("buildManualGapfillAllResponsesPayload", () => {
  it("serializes each MG step response with stale flags", () => {
    const payload = buildManualGapfillAllResponsesPayload({
      identityKey: "user:source:lab:MONTHLY_FROM_SOURCE_INTERVALS",
      userEmail: "test@example.com",
      userId: "user-1",
      sourceHouseId: "source-1",
      labHouseId: "lab-1",
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      esiid: "E123",
      includeDiagnostics: true,
      anchorEndDate: "",
      includeDailyRows: true,
      persistSeedToggle: false,
      persistedSeedInSession: false,
      status: "ready",
      error: null,
      identityNotice: null,
      policySnapshot: { policyHash: "policy-1" },
      step1: {
        identityKey: "user:source:lab:MONTHLY_FROM_SOURCE_INTERVALS",
        data: { status: "ready", sourceHouseId: "source-1" },
      },
      step2Preview: null,
      step3: null,
      step4: {
        identityKey: "stale-key",
        data: { status: "ready", readback: { totalKwh: 100 } },
      },
      step5: null,
      isStepStale: (step) => step?.identityKey === "stale-key",
    });

    expect(payload.workflow).toBe("manual_gapfill_lab_mg1_mg5");
    expect((payload.steps as any).step1_sourceContext.response).toEqual({
      status: "ready",
      sourceHouseId: "source-1",
    });
    expect((payload.steps as any).step4_runReadback.stale).toBe(true);
    expect((payload.steps as any).step2_validationPolicyPreview).toBeNull();
  });

  it("includes full compare diagnostics export sections at the top level", () => {
    const payload = buildManualGapfillAllResponsesPayload({
      identityKey: "user:source:lab:MONTHLY_FROM_SOURCE_INTERVALS",
      userEmail: "test@example.com",
      userId: "user-1",
      sourceHouseId: "source-1",
      labHouseId: "lab-1",
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      esiid: "E123",
      includeDiagnostics: true,
      anchorEndDate: "",
      includeDailyRows: true,
      persistSeedToggle: false,
      persistedSeedInSession: false,
      status: "ready",
      error: null,
      identityNotice: null,
      policySnapshot: { policyHash: "policy-1" },
      step1: null,
      step2Preview: null,
      step3: null,
      step4: null,
      step5: {
        identityKey: "user:source:lab:MONTHLY_FROM_SOURCE_INTERVALS",
        data: {
          status: "ready",
          diagnosticsV1: { version: "v1", dashboardSummary: { dailyWape: 0.1 } },
          weatherDiagnostics: { weatherDiagnosticsAvailable: true },
          validationIntervalCurveDiagnostics: { selectedValidationDayCount: 2 },
          worstDayDiagnostics: { topAbsoluteDailyMisses: [{ date: "2025-07-01" }] },
          diagnostics: { diagnosticsV1Built: true },
        },
      },
      isStepStale: () => false,
    });

    expect((payload.copyMeta as any).includesCompareDiagnosticsV1).toBe(true);
    expect((payload.compareExport as any).diagnosticsV1.dashboardSummary.dailyWape).toBe(0.1);
    expect((payload.compareExport as any).fullResponse.status).toBe("ready");
    expect((payload.steps as any).step5_compare.response.diagnosticsV1).toBeTruthy();
  });
});
