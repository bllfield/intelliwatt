import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    prisma: {
      eflParseReviewQueue: {
        upsert: vi.fn(async () => ({})),
      },
    },
  };
});

vi.mock("@/lib/efl/fetchEflPdf", () => {
  return {
    fetchEflPdfFromUrl: vi.fn(async () => ({ ok: false, error: "not_used" })),
  };
});

vi.mock("@/lib/efl/runEflPipelineNoStore", () => {
  return {
    runEflPipelineNoStore: vi.fn(async () => ({
      deterministic: {
        eflPdfSha256: "sha_pdf",
        repPuctCertificate: "REP123",
        eflVersionCode: "VER1",
        rawText: "Provider: Foo Power\nPlan: Bar Saver\n",
        warnings: [],
        extractorMethod: "pdftotext",
      },
      planRules: { termMonths: 12 },
      rateStructure: { type: "FIXED" },
      validation: { requiresManualReview: false },
      derivedForValidation: null,
      finalValidation: { status: "PASS", points: [] },
      passStrength: "STRONG",
      parseConfidence: 0.9,
      parseWarnings: [],
    })),
  };
});

vi.mock("@/lib/efl/runEflPipelineFromRawTextNoStore", () => {
  return {
    runEflPipelineFromRawTextNoStore: vi.fn(async () => {
      throw new Error("not_used");
    }),
  };
});

const persistAndLinkFromPipelineMock = vi.fn();
vi.mock("@/lib/efl/persistAndLinkFromPipeline", () => {
  return {
    persistAndLinkFromPipeline: (...args: any[]) => persistAndLinkFromPipelineMock(...args),
  };
});

describe("runEflPipeline (contract)", () => {
  beforeEach(() => {
    persistAndLinkFromPipelineMock.mockReset();
  });

  it("queues (fail-closed) when persistence succeeds but offerId link fails", async () => {
    persistAndLinkFromPipelineMock.mockResolvedValue({
      templatePersisted: true,
      persistedRatePlanId: "rp_1",
      planCalc: {
        planCalcStatus: "COMPUTABLE",
        planCalcReasonCode: "FIXED_RATE_OK",
        requiredBucketKeys: [],
      },
      bucketsEnsured: { ensured: 0, skipped: 0 },
      offerIdLinked: false,
      offerIdBackfill: null,
      notes: [],
    });

    const { runEflPipeline } = await import("@/lib/efl/runEflPipeline");

    const res = await runEflPipeline({
      source: "manual_url",
      actor: "admin",
      dryRun: false,
      offerId: "offer_1",
      eflUrl: "https://example.com/efl.pdf",
      pdfBytes: Buffer.from("pdf"),
    });

    expect(res.ok).toBe(false);
    expect(res.stage).toBe("LINK_OFFER");
    expect(res.queued).toBe(true);
    expect(res.planCalcReasonCode).toBe("PIPELINE_STAGE_FAILED_LINK_OFFER");
  });

  it("queues (ok=true) when not eligible for auto-templating (PASS but WEAK)", async () => {
    // Make pipeline return PASS but WEAK.
    const mod = await import("@/lib/efl/runEflPipelineNoStore");
    (mod.runEflPipelineNoStore as any).mockResolvedValueOnce({
      deterministic: {
        eflPdfSha256: "sha_pdf",
        repPuctCertificate: "REP123",
        eflVersionCode: "VER1",
        rawText: "txt",
        warnings: [],
        extractorMethod: "pdftotext",
      },
      planRules: { termMonths: 12 },
      rateStructure: { type: "FIXED" },
      validation: { requiresManualReview: false },
      derivedForValidation: null,
      finalValidation: { status: "PASS", queueReason: "PASS_WEAK", points: [] },
      passStrength: "WEAK",
      parseConfidence: 0.7,
      parseWarnings: [],
    });

    const { runEflPipeline } = await import("@/lib/efl/runEflPipeline");
    const res = await runEflPipeline({
      source: "manual_url",
      actor: "admin",
      dryRun: false,
      offerId: null,
      eflUrl: "https://example.com/efl.pdf",
      pdfBytes: Buffer.from("pdf"),
    });

    expect(res.ok).toBe(true);
    expect(res.stage).toBe("QUEUE_UPDATE");
    expect(res.queued).toBe(true);
  });
});

