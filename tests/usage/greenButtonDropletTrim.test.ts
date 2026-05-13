import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const droplet = require(path.join(
  process.cwd(),
  "scripts/droplet/green-button-upload-server.js",
));

function chicagoCstIntervals(dateKey: string, count: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const startMs = Date.UTC(year, month - 1, day, 6, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(startMs + i * 15 * 60 * 1000),
  }));
}

describe("Droplet Green Button post-normalization trimming", () => {
  it("uses the latest full Chicago-local day instead of a partial latest timestamp", () => {
    const intervals = [
      ...chicagoCstIntervals("2026-01-07", 96),
      ...chicagoCstIntervals("2026-01-08", 96),
      ...chicagoCstIntervals("2026-01-09", 96),
      ...chicagoCstIntervals("2026-01-10", 96),
      ...chicagoCstIntervals("2026-01-11", 12),
    ];

    const result = droplet.trimGreenButtonIntervalsToLatestLocalDays(intervals, 3);

    expect(result.startDateKey).toBe("2026-01-08");
    expect(result.endDateKey).toBe("2026-01-10");
    expect(result.trimmed).toHaveLength(288);
    expect(
      new Set(result.trimmed.map((row: any) => droplet.chicagoDateKeyForTimestamp(row.timestamp))),
    ).toEqual(new Set(["2026-01-08", "2026-01-09", "2026-01-10"]));
  });

  it("uses DST-aware expected interval counts for Chicago-local days", () => {
    expect(droplet.expectedIntervalsForChicagoDateKey("2026-03-08")).toBe(92);
    expect(droplet.expectedIntervalsForChicagoDateKey("2026-11-01")).toBe(100);
  });
});
