import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path quarantine boundaries", () => {
  it("keeps live user routes and usage surfaces free of One Path imports", () => {
    const usageRouteSource = readRepoFile("app/api/user/usage/route.ts");
    const usageRefreshRouteSource = readRepoFile("app/api/user/usage/refresh/route.ts");
    const usagePageSource = readRepoFile("app/dashboard/usage/page.tsx");
    const usageComponentsSource = readRepoFile("components/usage/UsageDashboard.tsx");
    const gapfillRouteSource = readRepoFile("app/api/admin/tools/gapfill-lab/route.ts");
    const gapfillClientSource = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");
    const manualLabSource = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(usageRouteSource).not.toContain("one-path-sim");
    expect(usageRouteSource).not.toContain("modules/onePathSim");
    expect(usageRefreshRouteSource).not.toContain("one-path-sim");
    expect(usageRefreshRouteSource).not.toContain("modules/onePathSim");
    expect(usagePageSource).not.toContain("one-path-sim");
    expect(usagePageSource).not.toContain("modules/onePathSim");
    expect(usageComponentsSource).not.toContain("one-path-sim");
    expect(usageComponentsSource).not.toContain("modules/onePathSim");
    expect(gapfillRouteSource).not.toContain("one-path-sim");
    expect(gapfillRouteSource).not.toContain("modules/onePathSim");
    expect(gapfillClientSource).not.toContain("one-path-sim");
    expect(gapfillClientSource).not.toContain("modules/onePathSim");
    expect(manualLabSource).not.toContain("one-path-sim");
    expect(manualLabSource).not.toContain("modules/onePathSim");
  });

  it("keeps the One Path page off live usage result renderers", () => {
    const adminSource = readRepoFile("components/admin/OnePathSimAdmin.tsx");

    expect(adminSource).not.toContain("UsageDashboard");
    expect(adminSource).not.toContain('from "@/components/usage/');
    expect(adminSource).not.toContain("SimulatedUsage");
  });

  it("requires the One Path route to use isolated module owners only", () => {
    const routeSource = readRepoFile("app/api/admin/tools/one-path-sim/route.ts");

    expect(routeSource).toContain('from "@/modules/onePathSim/');
    expect(routeSource).not.toContain('from "@/modules/manualUsage/');
    expect(routeSource).not.toContain('from "@/modules/weatherSensitivity/shared"');
    expect(routeSource).not.toContain('from "@/modules/usageSimulator/');
    expect(routeSource).not.toContain('from "@/app/api/admin/tools/gapfill-lab/');
  });

  it("removes One Path specific branches from live shared simulation owners", () => {
    const serviceSource = readRepoFile("modules/usageSimulator/service.ts");
    const weatherSharedSource = readRepoFile("modules/weatherSensitivity/shared.ts");

    expect(serviceSource).not.toContain("one_path_sim_admin");
    expect(serviceSource).not.toContain("isOnePathSimAdminRun");
    expect(weatherSharedSource).not.toContain("one_path_sim_admin");
    expect(weatherSharedSource).not.toContain("onePathSim");
  });

  it("moves One Path specific module owners out of usageSimulator", () => {
    expect(existsSync(resolve(ROOT, "modules/usageSimulator/onePathSim.ts"))).toBe(false);
    expect(existsSync(resolve(ROOT, "modules/usageSimulator/onePathTruthSummary.ts"))).toBe(false);
    expect(existsSync(resolve(ROOT, "modules/usageSimulator/onePathOwnershipAudit.ts"))).toBe(false);
    expect(existsSync(resolve(ROOT, "modules/usageSimulator/simulationVariablePresentation.ts"))).toBe(false);
    expect(existsSync(resolve(ROOT, "modules/onePathSim/onePathSim.ts"))).toBe(true);
    expect(existsSync(resolve(ROOT, "modules/onePathSim/onePathTruthSummary.ts"))).toBe(true);
    expect(existsSync(resolve(ROOT, "modules/onePathSim/onePathOwnershipAudit.ts"))).toBe(true);
    expect(existsSync(resolve(ROOT, "modules/onePathSim/simulationVariablePresentation.ts"))).toBe(true);
    expect(existsSync(resolve(ROOT, "modules/onePathSim/runtime.ts"))).toBe(true);
  });
});
