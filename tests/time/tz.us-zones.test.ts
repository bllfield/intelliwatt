import { describe, expect, test } from "vitest";
import { parseInZoneToUTC } from "@/lib/time/tz";

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

describe("parseInZoneToUTC - deterministic US timezone rules", () => {
  test("parses explicit offset without Luxon", () => {
    expect(iso(parseInZoneToUTC("2026-01-15T00:00:00-06:00", "America/Chicago"))).toBe("2026-01-15T06:00:00.000Z");
    expect(iso(parseInZoneToUTC("2026-01-15T00:00:00Z", "America/Chicago"))).toBe("2026-01-15T00:00:00.000Z");
  });

  test("Central: standard vs DST", () => {
    // Jan (CST UTC-6)
    expect(iso(parseInZoneToUTC("2026-01-15T00:00:00", "America/Chicago"))).toBe("2026-01-15T06:00:00.000Z");
    // Jul (CDT UTC-5)
    expect(iso(parseInZoneToUTC("2026-07-15T00:00:00", "America/Chicago"))).toBe("2026-07-15T05:00:00.000Z");
  });

  test("Pacific: standard vs DST", () => {
    // Jan (PST UTC-8)
    expect(iso(parseInZoneToUTC("2026-01-15T00:00:00", "America/Los_Angeles"))).toBe("2026-01-15T08:00:00.000Z");
    // Jul (PDT UTC-7)
    expect(iso(parseInZoneToUTC("2026-07-15T00:00:00", "America/Los_Angeles"))).toBe("2026-07-15T07:00:00.000Z");
  });

  test("Phoenix: no DST", () => {
    // Always UTC-7
    expect(iso(parseInZoneToUTC("2026-01-15T00:00:00", "America/Phoenix"))).toBe("2026-01-15T07:00:00.000Z");
    expect(iso(parseInZoneToUTC("2026-07-15T00:00:00", "America/Phoenix"))).toBe("2026-07-15T07:00:00.000Z");
  });

  test("Spring forward: snap 02:xx to 03:00 local (DST-observing zones)", () => {
    // 2026 DST starts on 2026-03-08 (second Sunday in March).
    // Local 02:30 does not exist; we snap to 03:00 local.
    // Central DST offset is -5 at 03:00 local => 08:00Z.
    expect(iso(parseInZoneToUTC("2026-03-08T02:30:00", "America/Chicago"))).toBe("2026-03-08T08:00:00.000Z");
    // Pacific DST offset is -7 at 03:00 local => 10:00Z.
    expect(iso(parseInZoneToUTC("2026-03-08T02:30:00", "America/Los_Angeles"))).toBe("2026-03-08T10:00:00.000Z");
  });

  test("Fall back: ambiguous 01:xx chooses earlier(DST) vs later(standard)", () => {
    // 2026 DST ends on 2026-11-01 (first Sunday in Nov).
    // Central: 01:30 occurs twice:
    // - earlier: CDT (UTC-5) => 06:30Z
    // - later:   CST (UTC-6) => 07:30Z
    expect(iso(parseInZoneToUTC("2026-11-01T01:30:00", "America/Chicago", "earlier"))).toBe(
      "2026-11-01T06:30:00.000Z",
    );
    expect(iso(parseInZoneToUTC("2026-11-01T01:30:00", "America/Chicago", "later"))).toBe("2026-11-01T07:30:00.000Z");
  });
});

