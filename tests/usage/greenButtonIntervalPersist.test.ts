import { describe, expect, it, vi } from "vitest";
import {
  GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE,
  GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
  createManyGreenButtonIntervalsInBatches,
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
});
