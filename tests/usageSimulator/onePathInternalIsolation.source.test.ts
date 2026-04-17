import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function listRepoFiles(relativeDir: string): string[] {
  const rootDir = resolve(ROOT, relativeDir);
  const out: string[] = [];

  function walk(currentDir: string) {
    for (const entry of readdirSync(currentDir)) {
      const absolutePath = resolve(currentDir, entry);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      out.push(absolutePath.slice(ROOT.length + 1).split("\\").join("/"));
    }
  }

  walk(rootDir);
  return out;
}

function listOnePathSourceFiles(): string[] {
  return listRepoFiles("modules/onePathSim").filter((relativePath) => /\.(ts|tsx)$/.test(relativePath));
}

describe("one path internal lockbox isolation", () => {
  it("blocks live shared usageSimulator owners from the active one-path boundary files", () => {
    const runtimeSource = readRepoFile("modules/onePathSim/runtime.ts");
    const manualArtifactDecorationsSource = readRepoFile("modules/onePathSim/manualArtifactDecorations.ts");
    const upstreamUsageTruthSource = readRepoFile("modules/onePathSim/upstreamUsageTruth.ts");

    expect(runtimeSource).not.toContain('from "@/modules/usageSimulator/');
    expect(manualArtifactDecorationsSource).not.toContain('from "@/modules/usageSimulator/');
    expect(upstreamUsageTruthSource).not.toContain('from "@/modules/usageSimulator/');
  });

  it("blocks live manualUsage owners from all one-path source files", () => {
    for (const relativePath of listOnePathSourceFiles()) {
      const source = readRepoFile(relativePath);
      expect(source, relativePath).not.toContain('from "@/modules/manualUsage/');
    }
  });

  it("blocks live simulatedUsage type imports from all one-path source files", () => {
    for (const relativePath of listOnePathSourceFiles()) {
      const source = readRepoFile(relativePath);
      expect(source, relativePath).not.toContain('from "@/modules/simulatedUsage/types"');
    }
  });

  it("keeps only one authoritative upstream usage truth owner inside one path", () => {
    expect(existsSync(resolve(ROOT, "modules/onePathSim/usageSimulator/upstreamUsageTruth.ts"))).toBe(false);
  });

  it("keeps the active variable snapshot guard on the real one-path upstream truth owner", () => {
    const source = readRepoFile("tests/usageSimulator/onePathSim.variableSnapshot.source.test.ts");

    expect(source).toContain('readRepoFile("modules/onePathSim/upstreamUsageTruth.ts")');
    expect(source).not.toContain('readRepoFile("modules/usageSimulator/upstreamUsageTruth.ts")');
  });

  it("keeps live app usage surfaces untouched by one path", () => {
    const usageRouteSource = readRepoFile("app/api/user/usage/route.ts");
    const usageRefreshRouteSource = readRepoFile("app/api/user/usage/refresh/route.ts");
    const usagePageSource = readRepoFile("app/dashboard/usage/page.tsx");

    expect(usageRouteSource).not.toContain('from "@/modules/onePathSim/');
    expect(usageRefreshRouteSource).not.toContain('from "@/modules/onePathSim/');
    expect(usagePageSource).not.toContain('from "@/modules/onePathSim/');
    expect(usagePageSource).not.toContain("one-path-sim");
  });
});
