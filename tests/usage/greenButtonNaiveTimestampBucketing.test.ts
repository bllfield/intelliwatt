import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

/**
 * GreenButtonInterval.timestamp is TIMESTAMP(3) without time zone: ingest stores UTC wall clock.
 * Postgres must use (timestamp AT TIME ZONE 'UTC') AT TIME ZONE <home> — not a single AT TIME ZONE home.
 */
const HOME = "America/Chicago";

function pgSingleAtChicago(naiveUtcWall: string): string {
  const dt = DateTime.fromSQL(naiveUtcWall, { zone: HOME });
  return dt.toFormat("HH:mm");
}

function pgDoubleAtUtcThenChicago(naiveUtcWall: string): string {
  const dt = DateTime.fromSQL(naiveUtcWall, { zone: "UTC" }).setZone(HOME);
  return dt.toFormat("HH:mm");
}

describe("Green Button persisted TIMESTAMP(3) slot labels", () => {
  it("maps evening Chicago usage to 19:00, not 00:00 or 05:00", () => {
    const eveningChicago = DateTime.fromISO("2025-06-01T19:00:00", { zone: HOME });
    const naiveStored = eveningChicago.toUTC().toFormat("yyyy-MM-dd HH:mm:ss");

    expect(pgSingleAtChicago(naiveStored)).toBe("00:00");
    expect(pgDoubleAtUtcThenChicago(naiveStored)).toBe("19:00");
  });

  it("maps early-morning Chicago usage to 05:00, not 10:00", () => {
    const morningChicago = DateTime.fromISO("2025-06-01T05:00:00", { zone: HOME });
    const naiveStored = morningChicago.toUTC().toFormat("yyyy-MM-dd HH:mm:ss");

    expect(pgSingleAtChicago(naiveStored)).toBe("10:00");
    expect(pgDoubleAtUtcThenChicago(naiveStored)).toBe("05:00");
  });
});
