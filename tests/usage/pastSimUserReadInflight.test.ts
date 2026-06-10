import { describe, expect, it } from "vitest";

import {
  pastSimUserReadInflightKey,
  resetPastSimUserReadInflightForTests,
  runPastSimUserReadInflight,
} from "@/lib/usage/pastSimUserReadInflight";

describe("pastSimUserReadInflight", () => {
  it("builds stable keys", () => {
    expect(
      pastSimUserReadInflightKey({
        userId: "u1",
        houseId: "h1",
        scenarioId: "s1",
      }),
    ).toBe("u1:h1:s1");
  });

  it("coalesces concurrent reads for the same home/scenario", async () => {
    resetPastSimUserReadInflightForTests();
    const key = pastSimUserReadInflightKey({ userId: "u1", houseId: "h1", scenarioId: "s1" });
    let runs = 0;
    const slow = runPastSimUserReadInflight(key, async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return "ok";
    });
    const joined = runPastSimUserReadInflight(key, async () => {
      runs += 1;
      return "duplicate";
    });
    await expect(Promise.all([slow, joined])).resolves.toEqual(["ok", "ok"]);
    expect(runs).toBe(1);
  });
});
