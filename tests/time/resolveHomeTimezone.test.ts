import { describe, expect, it } from "vitest";
import { resolveHomeTimezone, timezoneFromUsState } from "@/lib/time/resolveHomeTimezone";

describe("resolveHomeTimezone", () => {
  it("maps Texas to America/Chicago", () => {
    expect(resolveHomeTimezone({ addressState: "TX" })).toBe("America/Chicago");
  });

  it("maps eastern states to America/New_York", () => {
    expect(resolveHomeTimezone({ addressState: "NY" })).toBe("America/New_York");
    expect(timezoneFromUsState("NJ")).toBe("America/New_York");
  });

  it("prefers explicit timezone when valid", () => {
    expect(resolveHomeTimezone({ timezone: "America/Denver", addressState: "TX" })).toBe("America/Denver");
  });
});
