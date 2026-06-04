import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("actualDatasetForHouse Green Button ingest contract", () => {
  it("does not re-run slot repair on read (ingest-trusted DB only)", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/usage/actualDatasetForHouse.ts"),
      "utf8"
    );
    expect(source).not.toContain("repairGreenButtonIntervalSeries");
    expect(source).toContain("loadPersistedGreenButtonIntervalsForWindow");
  });
});
