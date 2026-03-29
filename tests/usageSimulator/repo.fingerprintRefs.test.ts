import { describe, expect, it, vi } from "vitest";

const buildUpsert = vi.fn().mockResolvedValue({});

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorBuild: { upsert: buildUpsert },
  },
}));

describe("upsertSimulatorBuild fingerprintRefs", () => {
  it("adds opaque usage-DB artifact ids and fingerprintProvenanceJson to create/update", async () => {
    buildUpsert.mockClear();
    const { upsertSimulatorBuild } = await import("@/modules/usageSimulator/repo");
    await upsertSimulatorBuild({
      userId: "u1",
      houseId: "h1",
      scenarioKey: "BASELINE",
      mode: "SMT_BASELINE",
      baseKind: "SMT_BASELINE",
      canonicalEndMonth: "2026-02",
      canonicalMonths: ["2025-03", "2025-04"],
      buildInputs: {},
      buildInputsHash: "bh",
      versions: {
        estimatorVersion: "v1",
        reshapeCoeffVersion: "v1",
        intradayTemplateVersion: "v1",
        smtShapeDerivationVersion: "v1",
      },
      fingerprintRefs: {
        wholeHomeFingerprintArtifactId: "wh-art-1",
        usageFingerprintArtifactId: "us-art-1",
        fingerprintProvenanceJson: {
          wholeHomeSourceHash: "a",
          usageSourceHash: "b",
          wholeHomeStatus: "ready",
          usageStatus: "ready",
        },
      },
    });
    expect(buildUpsert).toHaveBeenCalledTimes(1);
    const arg = buildUpsert.mock.calls[0]?.[0];
    expect(arg?.create).toMatchObject({
      wholeHomeFingerprintArtifactId: "wh-art-1",
      usageFingerprintArtifactId: "us-art-1",
      fingerprintProvenanceJson: expect.objectContaining({ usageSourceHash: "b" }),
    });
    expect(arg?.update).toMatchObject({
      usageFingerprintArtifactId: "us-art-1",
    });
  });
});
