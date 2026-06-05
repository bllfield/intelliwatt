import { describe, expect, it } from "vitest";

import { finalizeGreenButtonBuckets } from "@/lib/usage/greenButtonNormalize";

describe("green button normalize finalize", () => {
  it("does not drop high-kWh repaired buckets", () => {
    const buckets = new Map<number, { kwh: number; collisionCount: number }>();
    buckets.set(Date.UTC(2026, 0, 1, 12, 0, 0, 0), { kwh: 25.5, collisionCount: 1 });

    const rows = finalizeGreenButtonBuckets(buckets, { maxKwhPerInterval: 10 });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.consumptionKwh).toBe(25.5);
  });
});
