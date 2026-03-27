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

});
