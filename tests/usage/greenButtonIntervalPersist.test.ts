import { describe, expect, it, vi } from "vitest";
import {
  GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE,
  GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
  createManyGreenButtonIntervalsInBatches,
  type GreenButtonIntervalInsertProgress,
} from "@/lib/usage/greenButtonIntervalPersist";

describe("createManyGreenButtonIntervalsInBatches", () => {
  it("chunks rows and runs parallel createMany waves", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const usageClient = { greenButtonInterval: { createMany } };
    const rows = Array.from({ length: GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE + 1 }, (_, i) => ({
      id: i,
    }));

    const stats = await createManyGreenButtonIntervalsInBatches(usageClient, rows);

    expect(stats.rows).toBe(rows.length);
    expect(stats.batches).toBe(2);
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[0][0].data).toHaveLength(GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE);
    expect(createMany.mock.calls[1][0].data).toHaveLength(1);
    expect(GREEN_BUTTON_INTERVAL_CREATE_PARALLEL).toBeGreaterThanOrEqual(2);
  });

  it("emits wave and batch progress callbacks", async () => {
    const createMany = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { count: 0 };
    });
    const usageClient = { greenButtonInterval: { createMany } };
    const rows = Array.from({ length: GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE + 1 }, (_, i) => ({ id: i }));
    const phases: GreenButtonIntervalInsertProgress["phase"][] = [];

    await createManyGreenButtonIntervalsInBatches(usageClient, rows, {
      onProgress: (progress) => phases.push(progress.phase),
    });

    expect(phases).toContain("insert_start");
    expect(phases).toContain("wave_start");
    expect(phases).toContain("batch_start");
    expect(phases).toContain("batch_complete");
    expect(phases).toContain("wave_complete");
    expect(phases).toContain("insert_complete");
    expect(phases.filter((p) => p === "batch_complete").length).toBe(2);
  });
});
