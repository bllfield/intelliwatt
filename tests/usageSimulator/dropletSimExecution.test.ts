import { beforeEach, describe, expect, it, vi } from "vitest";

describe("droplet sim execution flags", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SIM_DROPLET_EXECUTION_INLINE;
    delete process.env.PAST_SIM_RECALC_INLINE;
    delete process.env.GAPFILL_COMPARE_INLINE;
    delete process.env.DROPLET_WEBHOOK_URL;
    delete process.env.INTELLIWATT_WEBHOOK_URL;
    delete process.env.DROPLET_WEBHOOK_SECRET;
    delete process.env.INTELLIWATT_WEBHOOK_SECRET;
  });

  it("shouldEnqueueDropletSimJobsBase is false when SIM_DROPLET_EXECUTION_INLINE=true", async () => {
    process.env.SIM_DROPLET_EXECUTION_INLINE = "true";
    process.env.DROPLET_WEBHOOK_URL = "https://example.com/trigger/smt-now";
    process.env.DROPLET_WEBHOOK_SECRET = "s";
    const { shouldEnqueueDropletSimJobsBase, shouldEnqueuePastSimRecalcRemote } = await import(
      "@/modules/usageSimulator/dropletSimWebhook"
    );
    expect(shouldEnqueueDropletSimJobsBase()).toBe(false);
    expect(shouldEnqueuePastSimRecalcRemote()).toBe(false);
  });

  it("shouldEnqueuePastSimRecalcRemote is false when PAST_SIM_RECALC_INLINE=true", async () => {
    process.env.PAST_SIM_RECALC_INLINE = "true";
    process.env.DROPLET_WEBHOOK_URL = "https://example.com/trigger/smt-now";
    process.env.DROPLET_WEBHOOK_SECRET = "s";
    const { shouldEnqueuePastSimRecalcRemote } = await import("@/modules/usageSimulator/dropletSimWebhook");
    expect(shouldEnqueuePastSimRecalcRemote()).toBe(false);
  });

  it("shouldEnqueuePastSimRecalcRemote is true when webhook URL+secret set", async () => {
    process.env.DROPLET_WEBHOOK_URL = "https://example.com/trigger/smt-now";
    process.env.DROPLET_WEBHOOK_SECRET = "s";
    const { shouldEnqueuePastSimRecalcRemote } = await import("@/modules/usageSimulator/dropletSimWebhook");
    expect(shouldEnqueuePastSimRecalcRemote()).toBe(true);
  });

  it("getGapfillCompareEnqueueDiagnostics reflects URL/secret precedence and flags", async () => {
    process.env.DROPLET_WEBHOOK_URL = "http://10.0.0.1:8787/trigger/smt-now";
    process.env.INTELLIWATT_WEBHOOK_URL = "https://ignored.example/trigger/smt-now";
    process.env.DROPLET_WEBHOOK_SECRET = "a";
    process.env.INTELLIWATT_WEBHOOK_SECRET = "b";
    const { getGapfillCompareEnqueueDiagnostics } = await import("@/modules/usageSimulator/dropletSimWebhook");
    const d = getGapfillCompareEnqueueDiagnostics();
    expect(d.wouldEnqueueGapfillCompare).toBe(true);
    expect(d.webhookUrlSource).toBe("DROPLET_WEBHOOK_URL");
    expect(d.webhookSecretSource).toBe("DROPLET_WEBHOOK_SECRET");
    expect(d.webhookUrlScheme).toBe("http");
    expect(d.gapfillCompareInline).toBe(false);
  });

  it("getGapfillCompareEnqueueDiagnostics is false when GAPFILL_COMPARE_INLINE", async () => {
    process.env.GAPFILL_COMPARE_INLINE = "true";
    process.env.DROPLET_WEBHOOK_URL = "https://example.com/trigger/smt-now";
    process.env.DROPLET_WEBHOOK_SECRET = "s";
    const { getGapfillCompareEnqueueDiagnostics } = await import("@/modules/usageSimulator/dropletSimWebhook");
    expect(getGapfillCompareEnqueueDiagnostics().wouldEnqueueGapfillCompare).toBe(false);
  });

  it("SIM_DROPLET_JOB_KIND_GAPFILL_COMPARE matches droplet webhook reason gapfill_compare", async () => {
    const { SIM_DROPLET_JOB_KIND_GAPFILL_COMPARE } = await import("@/modules/usageSimulator/dropletSimWebhook");
    expect(SIM_DROPLET_JOB_KIND_GAPFILL_COMPARE).toBe("gapfill_compare");
  });

  it("whitespace-only DROPLET secret does not fall through to INTELLIWATT: diagnostics matches shouldEnqueue", async () => {
    process.env.DROPLET_WEBHOOK_URL = "https://example.com/trigger/smt-now";
    process.env.DROPLET_WEBHOOK_SECRET = "   ";
    process.env.INTELLIWATT_WEBHOOK_SECRET = "fallback-secret";
    const { getGapfillCompareEnqueueDiagnostics, shouldEnqueueGapfillCompareRemote } = await import(
      "@/modules/usageSimulator/dropletSimWebhook"
    );
    expect(shouldEnqueueGapfillCompareRemote()).toBe(false);
    const d = getGapfillCompareEnqueueDiagnostics();
    expect(d.wouldEnqueueGapfillCompare).toBe(false);
    expect(d.hasWebhookSecret).toBe(false);
    expect(d.dropletSimJobsBaseEligible).toBe(false);
    expect(d.webhookSecretSource).toBe("DROPLET_WEBHOOK_SECRET");
  });

  it("triggerDropletSimWebhook returns ok when HTTP 200 and JSON ok true", async () => {
    process.env.DROPLET_WEBHOOK_URL = "https://example.com/trigger/smt-now";
    process.env.DROPLET_WEBHOOK_SECRET = "s";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, queued: true }), { status: 200 }))
    );
    const { triggerDropletSimWebhook } = await import("@/modules/usageSimulator/dropletSimWebhook");
    const r = await triggerDropletSimWebhook({ reason: "gapfill_compare", compareRunId: "x" });
    expect(r.ok).toBe(true);
    expect("skipped" in r && r.skipped).toBe(false);
    vi.unstubAllGlobals();
  });

  it("triggerDropletSimWebhook returns not ok when HTTP 200 but JSON ok false", async () => {
    process.env.DROPLET_WEBHOOK_URL = "https://example.com/trigger/smt-now";
    process.env.DROPLET_WEBHOOK_SECRET = "s";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "spawn_failed" }), { status: 200 }))
    );
    const { triggerDropletSimWebhook } = await import("@/modules/usageSimulator/dropletSimWebhook");
    const r = await triggerDropletSimWebhook({ reason: "gapfill_compare", compareRunId: "x" });
    expect(r.ok).toBe(false);
    vi.unstubAllGlobals();
  });
});
