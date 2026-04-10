import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("ManualUsageEntry date input editing", () => {
  it("uses text date inputs with manual normalization instead of browser date segmentation", () => {
    const source = readRepoFile("components/manual/ManualUsageEntry.tsx");

    expect(source).toContain("function normalizeManualDateInput");
    expect(source).toContain('placeholder="MM/DD/YYYY"');
    expect(source).toContain("type=\"text\"");
    expect(source).toContain("onBlur={(e) => {");
    expect(source).toContain("normalizeManualDateInput(e.target.value)");
  });

  it("keeps monthly bill rows on stable React keys while editing dates", () => {
    const source = readRepoFile("components/manual/ManualUsageEntry.tsx");

    expect(source).toContain('key={`bill-${idx}`}');
    expect(source).not.toContain('key={`${idx}:${row.endDate}:${statementMonthLabel(row.endDate)}`}');
  });
});
