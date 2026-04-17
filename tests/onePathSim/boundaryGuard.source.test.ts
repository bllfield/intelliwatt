import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function listFilesRecursive(relativeDir: string): string[] {
  const absoluteDir = resolve(ROOT, relativeDir);
  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry.name}`.replace(/\\/g, "/");
    if (entry.isDirectory()) return listFilesRecursive(relativePath);
    return relativePath;
  });
}

describe("one path boundary guard source", () => {
  it("keeps one path modules off forbidden live/shared calc and orchestration imports", () => {
    const onePathFiles = listFilesRecursive("modules/onePathSim").filter(
      (relativePath) =>
        (relativePath.endsWith(".ts") || relativePath.endsWith(".tsx")) &&
        !relativePath.endsWith(".d.ts")
    );

    const forbiddenImportPatterns = [
      '@/modules/usageSimulator/service',
      '@/modules/simulatedUsage/simulatePastUsageDataset',
      '@/modules/manualUsage/pastSimReadResult',
      '@/modules/weatherSensitivity/shared";',
      "@/modules/weatherSensitivity/shared';",
    ];

    for (const relativePath of onePathFiles) {
      const source = readRepoFile(relativePath);
      expect(source, `${relativePath} should stay off forbidden live/shared owners`).not.toContain(
        'from "@/modules/usageSimulator/service"'
      );
      expect(source, `${relativePath} should stay off forbidden live/shared owners`).not.toContain(
        'from "@/modules/simulatedUsage/simulatePastUsageDataset"'
      );
      expect(source, `${relativePath} should stay off forbidden live/shared owners`).not.toContain(
        'from "@/modules/manualUsage/pastSimReadResult"'
      );
      const nonTypeWeatherImport =
        source.includes('from "@/modules/weatherSensitivity/shared"') &&
        !source.includes('import type { WeatherSensitivityScore } from "@/modules/weatherSensitivity/shared"');
      expect(nonTypeWeatherImport, `${relativePath} should not value-import shared weather sensitivity owners`).toBe(false);
      for (const pattern of forbiddenImportPatterns) {
        if (pattern.includes("weatherSensitivity/shared")) continue;
        expect(source.includes(pattern), `${relativePath} unexpectedly imports ${pattern}`).toBe(false);
      }
    }
  });

  it("still allows shared input reads and shared display-only reuse", () => {
    const routeSource = readRepoFile("app/api/admin/tools/one-path-sim/route.ts");
    const runViewSource = readRepoFile("modules/onePathSim/runReadOnlyView.ts");
    const totalsAuditSource = readRepoFile("modules/onePathSim/usageDisplayTotalsAudit.ts");

    expect(routeSource).toContain('from "@/modules/homeProfile/repo"');
    expect(routeSource).toContain('from "@/modules/applianceProfile/repo"');
    expect(routeSource).toContain("resolveOnePathUpstreamUsageTruthForSimulation");
    expect(runViewSource).toContain('from "@/modules/usageSimulator/dailyRowFieldsFromDisplay"');
    expect(runViewSource).toContain('import type { ValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection"');
    expect(runViewSource).toContain('import type { WeatherSensitivityScore } from "@/modules/weatherSensitivity/shared"');
    expect(totalsAuditSource).toContain('from "@/modules/usageSimulator/monthlyCompareRows"');
  });

  it("does not leave stale shared-producer ownership wording in one path admin surfaces", () => {
    const adminSource = readRepoFile("components/admin/OnePathSimAdmin.tsx");
    const ownershipAuditSource = readRepoFile("modules/onePathSim/onePathOwnershipAudit.ts");
    const truthSummarySource = readRepoFile("modules/onePathSim/onePathTruthSummary.ts");

    expect(adminSource).not.toContain("shared producer pipeline");
    expect(adminSource).not.toContain("Run shared producer");
    expect(adminSource).not.toContain("shared calculation owners");
    expect(ownershipAuditSource).not.toContain("shared simulation chain");
    expect(ownershipAuditSource).not.toContain("shared simulation owners");
    expect(ownershipAuditSource).not.toContain("dispatches shared recalc");
    expect(ownershipAuditSource).not.toContain("shared recalc");
    expect(ownershipAuditSource).not.toContain("shared producer family");
    expect(truthSummarySource).not.toContain("shared producer/readback chain");
    expect(truthSummarySource).not.toContain("one shared producer chain");
    expect(truthSummarySource).not.toContain("shared producer and later readers");
    expect(truthSummarySource).not.toContain("used by the shared producer");

    expect(adminSource).toContain("One Path-owned interval calculations");
    expect(ownershipAuditSource).toContain("One Path-owned interval calculations live inside modules/onePathSim/**");
    expect(truthSummarySource).toContain("Shared/live inputs are read-only");
    expect(truthSummarySource).toContain("Shared display reuse is presentation-only");
  });
});
