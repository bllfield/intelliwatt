import { describe, expect, test } from "vitest";
import { chicagoSlot96FromTs } from "@/lib/time/chicago";

describe("chicagoSlot96FromTs", () => {
  test("maps a normal CDT midnight interval to slot 0", () => {
    expect(chicagoSlot96FromTs(new Date("2026-05-17T05:00:00.000Z"))).toBe(0);
    expect(chicagoSlot96FromTs(new Date("2026-05-17T05:14:59.999Z"))).toBe(0);
  });

  test("maps late evening CDT to slot 95", () => {
    expect(chicagoSlot96FromTs(new Date("2026-05-18T04:45:00.000Z"))).toBe(95);
    expect(chicagoSlot96FromTs(new Date("2026-05-18T04:59:59.999Z"))).toBe(95);
  });

  test("spring-forward day: slot 0 at first Chicago-local midnight", () => {
    // 2026-03-08 00:00 CST = 06:00 UTC (before clocks jump at 02:00)
    expect(chicagoSlot96FromTs(new Date("2026-03-08T06:00:00.000Z"))).toBe(0);
  });

  test("spring-forward day: slot 95 at last local 23:45–23:59", () => {
    // 2026-03-08 23:45 CDT = 2026-03-09T04:45:00.000Z
    expect(chicagoSlot96FromTs(new Date("2026-03-09T04:45:00.000Z"))).toBe(95);
  });

  test("fall-back day: slot 0 at first Chicago-local midnight", () => {
    // 2026-11-01 00:00 CDT = 05:00 UTC
    expect(chicagoSlot96FromTs(new Date("2026-11-01T05:00:00.000Z"))).toBe(0);
  });

  test("fall-back day: slot 95 at last local 23:45–23:59", () => {
    // 2026-11-01 23:45 CST = 2026-11-02T05:45:00.000Z
    expect(chicagoSlot96FromTs(new Date("2026-11-02T05:45:00.000Z"))).toBe(95);
  });
});
