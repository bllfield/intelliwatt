import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("past artifact identity enforcement", () => {
  const pastServicePaths = [
    "modules/onePathSim/usageSimulator/service.ts",
    "modules/usageSimulator/service.ts",
  ] as const;

  it("routes persist and artifact read through resolvePastArtifactIdentity", () => {
    for (const relativePath of pastServicePaths) {
      const source = readRepoFile(relativePath);
      expect(source).toContain('from "@/lib/usage/pastArtifactIdentity"');
      expect(source).toContain("resolvePastArtifactIdentity");
      expect(source).toContain("artifactIdentityBuildInputs");
      expect(source).toContain('sourceOfWindow: "past_artifact_identity"');
    }
  });

  it("keeps a single owner module for Past cache hash resolution", () => {
    const ownerSource = readRepoFile("lib/usage/pastArtifactIdentity.ts");
    expect(ownerSource).toContain("resolvePastArtifactIdentity");
    expect(ownerSource).toContain("computePastInputHash");
  });
});
