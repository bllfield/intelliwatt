import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("shared weather sensitivity UI surfaces", () => {
  it("defines customer-facing score messaging from the shared contract", () => {
    const source = readRepoFile("components/usage/WeatherSensitivityCard.tsx");
    expect(source).toContain("Weather Efficiency Score");
    expect(source).toContain("weather sensitive");
    expect(source).toContain("insulation and window details");
  });

  it("defines admin diagnostics fields from the same shared contract", () => {
    const source = readRepoFile("components/admin/WeatherSensitivityAdminDiagnostics.tsx");
    expect(source).toContain("coolingSlopeKwhPerCDD");
    expect(source).toContain("derived input attached");
    expect(source).toContain("simulation active");
    expect(source).toContain("unavailableMessage");
  });

  it("includes an Admin Tools card for the dedicated lab", () => {
    const adminPage = readRepoFile("app/admin/page.tsx");
    expect(adminPage).toContain("/admin/tools/weather-sensitivity-lab");
    expect(adminPage).toContain("Weather Sensitivity Lab");
  });

  it("defines the dedicated lab view from the same shared output contract", () => {
    const source = readRepoFile("components/admin/WeatherSensitivityLabView.tsx");
    expect(source).toContain("current score position");
    expect(source).toContain("WeatherSensitivityAdminDiagnostics");
    expect(source).toContain("derivedInputAttached");
  });
});
