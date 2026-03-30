import { describe, expect, it } from "vitest";
import { buildGapfillExportPayload } from "@/app/admin/tools/gapfill-lab/exportPayload";

describe("buildGapfillExportPayload", () => {
  it("stamps exportedAt at invocation time", () => {
    const base = { workspace: "gapfill-lab-canonical-client", formState: { email: "a@b.com" } };
    const first = buildGapfillExportPayload(base, new Date("2026-03-29T21:00:00.000Z"));
    const second = buildGapfillExportPayload(base, new Date("2026-03-29T21:00:05.000Z"));
    expect(first.exportedAt).toBe("2026-03-29T21:00:00.000Z");
    expect(second.exportedAt).toBe("2026-03-29T21:00:05.000Z");
    expect(second.exportedAt).not.toBe(first.exportedAt);
  });
});
