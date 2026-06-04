/**
 * DRIFT — not the product goal. See docs/ONE_PATH_DUAL_RUN_GOAL.md and .cursor/rules/one-path-dual-run-lock.mdc.
 *
 * Target: user + test home each RUN the shared Past pipeline (separate cache rows); match when inputs match.
 * This module currently COPYs user Past cache/build to the test home — temporary; remove copy-first paths.
 *
 * Never writes to the source (user) home. Test home persistence only.
 */

import "server-only";
import { prisma } from "@/lib/db";

import {
  isolateBuildInputsForUserSite,
  resolveUserSiteActualSourceForHouse,
} from "@/lib/usage/userSiteSimulationIsolation";

import {
  stableParityBuildInputsSnapshot,
  readOnePathUserSiteParityLock,
  isParityBuildInputsDirty,
  clearOnePathUserSiteParityFromBuildInputs,
  verifyPastDatasetParity,
  type OnePathUserSiteParityLock,
  type PastParityVerification,
} from "@/lib/usage/onePathPastUserSiteParityLock";

export {
  readOnePathUserSiteParityLock,
  isParityBuildInputsDirty,
  clearOnePathUserSiteParityFromBuildInputs,
  verifyPastDatasetParity,
  type OnePathUserSiteParityLock,
  type PastParityVerification,
};

export const WORKSPACE_PAST_SCENARIO_NAME = "Past (Corrected)";

export type OnePathPastParitySyncResult =
  | {
      ok: true;

      parity: OnePathUserSiteParityLock;

      copiedFromSourceCache: boolean;

      sourceInputHash: string;
    }
  | { ok: false; code: string; message: string };

function stampParityMetaOnDatasetJson(
  datasetJson: Record<string, unknown>,

  parity: OnePathUserSiteParityLock,
): Record<string, unknown> {
  const meta =
    datasetJson.meta &&
    typeof datasetJson.meta === "object" &&
    !Array.isArray(datasetJson.meta)
      ? { ...(datasetJson.meta as Record<string, unknown>) }
      : {};

  meta.onePathUserSiteParity = parity;

  return { ...datasetJson, meta };
}

import { upsertSimulatorBuild, getHouseAddressForUserHouse } from "@/modules/onePathSim/usageSimulator/repo";
import type { CachedPastDataset } from "@/modules/onePathSim/usageSimulator/pastCache";

async function pastCacheApi() {
  return import("@/modules/onePathSim/usageSimulator/pastCache");
}

export async function findPastScenarioId(args: {
  userId: string;

  houseId: string;
}): Promise<string | null> {
  const row = await (prisma as any).usageSimulatorScenario

    .findFirst({
      where: {
        userId: args.userId,

        houseId: args.houseId,

        name: WORKSPACE_PAST_SCENARIO_NAME,

        archivedAt: null,
      },

      select: { id: true },

      orderBy: { updatedAt: "desc" },
    })

    .catch(() => null);

  return row?.id ? String(row.id) : null;
}

async function loadPastSimulatorBuild(args: {
  userId: string;

  houseId: string;

  scenarioId: string;
}): Promise<Record<string, unknown> | null> {
  const rec = await (prisma as any).usageSimulatorBuild

    .findUnique({
      where: {
        userId_houseId_scenarioKey: {
          userId: args.userId,

          houseId: args.houseId,

          scenarioKey: args.scenarioId,
        },
      },

      select: {
        buildInputs: true,
        buildInputsHash: true,
        mode: true,
        baseKind: true,
        canonicalEndMonth: true,
        canonicalMonthsJson: true,
      },
    })

    .catch(() => null);

  if (!rec?.buildInputs || typeof rec.buildInputs !== "object") return null;

  return rec.buildInputs as Record<string, unknown>;
}

async function resolveUserSiteBuildInputs(args: {
  userId: string;

  houseId: string;

  esiid: string | null;

  buildInputs: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const actualSource = await resolveUserSiteActualSourceForHouse({
    userId: args.userId,

    houseId: args.houseId,

    esiid: args.esiid,
  });

  return isolateBuildInputsForUserSite({
    buildInputs: args.buildInputs,

    requestHouseId: args.houseId,

    actualSource,
  }).buildInputs;
}

async function copyPastArtifactCacheRow(args: {
  from: CachedPastDataset;

  sourceInputHash: string;

  windowStartUtc: string;

  windowEndUtc: string;

  targetHouseId: string;

  targetScenarioId: string;

  parity: OnePathUserSiteParityLock;
}): Promise<void> {
  const datasetJson = stampParityMetaOnDatasetJson(
    JSON.parse(JSON.stringify(args.from.datasetJson)) as Record<
      string,
      unknown
    >,

    args.parity,
  );

  const { saveCachedPastDataset, PAST_ENGINE_VERSION } = await pastCacheApi();
  await saveCachedPastDataset({
    houseId: args.targetHouseId,

    scenarioId: args.targetScenarioId,

    inputHash: args.sourceInputHash,

    engineVersion: PAST_ENGINE_VERSION,

    windowStartUtc: args.windowStartUtc,

    windowEndUtc: args.windowEndUtc,

    datasetJson,

    intervalsCodec: args.from.intervalsCodec,

    intervalsCompressed: args.from.intervalsCompressed,
  });
}

async function copyPastSimulatorBuildFromSource(args: {
  ownerUserId: string;

  sourceUserId: string;

  sourceHouseId: string;

  sourceScenarioId: string;

  testHomeHouseId: string;

  testScenarioId: string;

  parity: OnePathUserSiteParityLock;
}): Promise<void> {
  const sourceRec = await (prisma as any).usageSimulatorBuild

    .findUnique({
      where: {
        userId_houseId_scenarioKey: {
          userId: args.sourceUserId,

          houseId: args.sourceHouseId,

          scenarioKey: args.sourceScenarioId,
        },
      },
    })

    .catch(() => null);

  if (!sourceRec?.buildInputs) return;

  const sourceBuildInputs = sourceRec.buildInputs as Record<string, unknown>;

  const testHouse = await getHouseAddressForUserHouse({
    userId: args.ownerUserId,

    houseId: args.testHomeHouseId,
  });

  const mirrored = await resolveUserSiteBuildInputs({
    userId: args.ownerUserId,

    houseId: args.testHomeHouseId,

    esiid: testHouse?.esiid ?? null,

    buildInputs: JSON.parse(JSON.stringify(sourceBuildInputs)) as Record<
      string,
      unknown
    >,
  });

  mirrored.onePathUserSiteParity = args.parity;

  await upsertSimulatorBuild({
    userId: args.ownerUserId,

    houseId: args.testHomeHouseId,

    scenarioKey: args.testScenarioId,

    mode: String(sourceRec.mode ?? mirrored.mode ?? "SMT_BASELINE"),

    baseKind: String(sourceRec.baseKind ?? "ACTUAL"),

    canonicalEndMonth: String(sourceRec.canonicalEndMonth ?? ""),

    canonicalMonths: Array.isArray(sourceRec.canonicalMonthsJson)
      ? (sourceRec.canonicalMonthsJson as string[])
      : [],

    buildInputs: mirrored,

    buildInputsHash: String(sourceRec.buildInputsHash ?? ""),

    versions: {
      estimatorVersion: String(sourceRec.estimatorVersion ?? ""),

      reshapeCoeffVersion: String(sourceRec.reshapeCoeffVersion ?? ""),

      intradayTemplateVersion: String(sourceRec.intradayTemplateVersion ?? ""),

      smtShapeDerivationVersion: String(
        sourceRec.smtShapeDerivationVersion ?? "",
      ),
    },
  });
}

async function loadSourcePastArtifact(args: {
  sourceHouseId: string;

  sourceScenarioId: string;

  inputHash: string;
}): Promise<CachedPastDataset | null> {
  const { getCachedPastDataset } = await pastCacheApi();
  return getCachedPastDataset({
    houseId: args.sourceHouseId,

    scenarioId: args.sourceScenarioId,

    inputHash: args.inputHash,
  });
}

export async function loadPastDatasetForParityLock(args: {
  houseId: string;

  parity: OnePathUserSiteParityLock;
}): Promise<Record<string, unknown> | null> {
  const { getCachedPastDataset } = await pastCacheApi();
  const cached = await getCachedPastDataset({
    houseId: args.houseId,

    scenarioId: args.parity.testScenarioId,

    inputHash: args.parity.parityInputHash,
  });

  const { decodeIntervalsV1, INTERVAL_CODEC_V1 } =
    await import("@/modules/onePathSim/usageSimulator/intervalCodec");

  if (!cached || cached.intervalsCodec !== INTERVAL_CODEC_V1) return null;

  const decoded = decodeIntervalsV1(cached.intervalsCompressed);

  return {
    ...cached.datasetJson,

    series: {
      ...(typeof cached.datasetJson.series === "object" &&
      cached.datasetJson.series !== null
        ? cached.datasetJson.series
        : {}),

      intervals15: decoded,
    },
  };
}

/**
 * Mirror user-site Past build inputs onto the test home (no artifact copy).
 * Used on test-home replace; Past artifacts come from a test-home recalc run.
 */
export async function mirrorOnePathPastBuildInputsFromSource(args: {
  ownerUserId: string;
  sourceUserId: string;
  sourceHouseId: string;
  testHomeHouseId: string;
}): Promise<OnePathPastParitySyncResult> {
  const sourceScenarioId = await findPastScenarioId({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
  });
  const testScenarioId = await findPastScenarioId({
    userId: args.ownerUserId,
    houseId: args.testHomeHouseId,
  });
  if (!sourceScenarioId) {
    return {
      ok: false,
      code: "SOURCE_PAST_SCENARIO_MISSING",
      message: "Source house has no Past (Corrected) scenario.",
    };
  }
  if (!testScenarioId) {
    return {
      ok: false,
      code: "TEST_PAST_SCENARIO_MISSING",
      message: "One Path test home has no Past (Corrected) scenario after link.",
    };
  }
  let sourceBuildInputs = await loadPastSimulatorBuild({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
    scenarioId: sourceScenarioId,
  });
  if (!sourceBuildInputs) {
    return {
      ok: false,
      code: "SOURCE_PAST_BUILD_MISSING",
      message: "Source house has no Past simulator build. Recalc Past on the user site first.",
    };
  }
  const sourceHouse = await getHouseAddressForUserHouse({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
  });
  if (!sourceHouse) {
    return {
      ok: false,
      code: "SOURCE_HOUSE_NOT_FOUND",
      message: "Source house not found.",
    };
  }
  sourceBuildInputs = await resolveUserSiteBuildInputs({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
    esiid: sourceHouse.esiid ?? null,
    buildInputs: sourceBuildInputs,
  });
  const { resolvePastArtifactIdentity } = await import("@/lib/usage/pastArtifactIdentity");
  const identity = await resolvePastArtifactIdentity({
    userId: args.sourceUserId,
    requestHouseId: args.sourceHouseId,
    requestHouseEsiid: sourceHouse.esiid ?? null,
    buildInputs: sourceBuildInputs,
  });
  if (!identity) {
    return {
      ok: false,
      code: "PARITY_IDENTITY_FAILED",
      message: "Could not resolve Past artifact identity for source house.",
    };
  }
  const snapshotHash = stableParityBuildInputsSnapshot(sourceBuildInputs);
  const parity: OnePathUserSiteParityLock = {
    sourceUserId: args.sourceUserId,
    sourceHouseId: args.sourceHouseId,
    sourceScenarioId,
    testScenarioId,
    parityInputHash: identity.inputHash,
    parityBuildInputsSnapshotHash: snapshotHash,
    syncedAt: new Date().toISOString(),
  };
  await copyPastSimulatorBuildFromSource({
    ownerUserId: args.ownerUserId,
    sourceUserId: args.sourceUserId,
    sourceHouseId: args.sourceHouseId,
    sourceScenarioId,
    testHomeHouseId: args.testHomeHouseId,
    testScenarioId,
    parity,
  });
  return {
    ok: true,
    parity,
    copiedFromSourceCache: false,
    sourceInputHash: identity.inputHash,
  };
}

/**
 * @deprecated Artifact copy — use mirrorOnePathPastBuildInputsFromSource + test-home recalc.
 * Copy user-site Past artifact + build inputs from source house onto the One Path test home.
 */
export async function syncOnePathPastUserSiteParityFromSource(args: {
  ownerUserId: string;

  sourceUserId: string;

  sourceHouseId: string;

  testHomeHouseId: string;
}): Promise<OnePathPastParitySyncResult> {
  const sourceScenarioId = await findPastScenarioId({
    userId: args.sourceUserId,

    houseId: args.sourceHouseId,
  });

  const testScenarioId = await findPastScenarioId({
    userId: args.ownerUserId,

    houseId: args.testHomeHouseId,
  });

  if (!sourceScenarioId) {
    return {
      ok: false,
      code: "SOURCE_PAST_SCENARIO_MISSING",
      message: "Source house has no Past (Corrected) scenario.",
    };
  }

  if (!testScenarioId) {
    return {
      ok: false,

      code: "TEST_PAST_SCENARIO_MISSING",

      message:
        "One Path test home has no Past (Corrected) scenario after link.",
    };
  }

  let sourceBuildInputs = await loadPastSimulatorBuild({
    userId: args.sourceUserId,

    houseId: args.sourceHouseId,

    scenarioId: sourceScenarioId,
  });

  if (!sourceBuildInputs) {
    return {
      ok: false,

      code: "SOURCE_PAST_BUILD_MISSING",

      message:
        "Source house has no Past simulator build. Recalc Past on the user site first.",
    };
  }

  const sourceHouse = await getHouseAddressForUserHouse({
    userId: args.sourceUserId,

    houseId: args.sourceHouseId,
  });

  if (!sourceHouse) {
    return {
      ok: false,
      code: "SOURCE_HOUSE_NOT_FOUND",
      message: "Source house not found.",
    };
  }

  sourceBuildInputs = await resolveUserSiteBuildInputs({
    userId: args.sourceUserId,

    houseId: args.sourceHouseId,

    esiid: sourceHouse.esiid ?? null,

    buildInputs: sourceBuildInputs,
  });

  const { resolvePastArtifactIdentity } = await import("@/lib/usage/pastArtifactIdentity");
  const identity = await resolvePastArtifactIdentity({
    userId: args.sourceUserId,

    requestHouseId: args.sourceHouseId,

    requestHouseEsiid: sourceHouse.esiid ?? null,

    buildInputs: sourceBuildInputs,
  });

  if (!identity) {
    return {
      ok: false,
      code: "PARITY_IDENTITY_FAILED",
      message: "Could not resolve Past artifact identity for source house.",
    };
  }

  const snapshotHash = stableParityBuildInputsSnapshot(sourceBuildInputs);

  const cached = await loadSourcePastArtifact({
    sourceHouseId: args.sourceHouseId,

    sourceScenarioId,

    inputHash: identity.inputHash,
  });

  if (!cached) {
    return {
      ok: false,

      code: "SOURCE_PAST_ARTIFACT_MISSING",

      message: "Could not load or build source Past artifact for parity copy.",
    };
  }

  const series = (cached.datasetJson.series ?? {}) as { intervals15?: unknown };

  const intervals15 = Array.isArray(series.intervals15)
    ? series.intervals15
    : [];

  const parity: OnePathUserSiteParityLock = {
    sourceUserId: args.sourceUserId,

    sourceHouseId: args.sourceHouseId,

    sourceScenarioId,

    testScenarioId,

    parityInputHash: identity.inputHash,

    parityBuildInputsSnapshotHash: snapshotHash,

    syncedAt: new Date().toISOString(),

    sourceIntervalCount:
      Number(
        (cached.datasetJson.summary as { intervalsCount?: unknown })
          ?.intervalsCount,
      ) || intervals15.length,

    intervals15Count: intervals15.length,
  };

  await copyPastArtifactCacheRow({
    from: cached,

    sourceInputHash: identity.inputHash,

    windowStartUtc: identity.window.startDate,

    windowEndUtc: identity.window.endDate,

    targetHouseId: args.testHomeHouseId,

    targetScenarioId: testScenarioId,

    parity,
  });

  await copyPastSimulatorBuildFromSource({
    ownerUserId: args.ownerUserId,

    sourceUserId: args.sourceUserId,

    sourceHouseId: args.sourceHouseId,

    sourceScenarioId,

    testHomeHouseId: args.testHomeHouseId,

    testScenarioId,

    parity,
  });

  return {
    ok: true,

    parity,

    copiedFromSourceCache: true,

    sourceInputHash: identity.inputHash,
  };
}

/** No-op: dual-run uses test-home recalc, not user artifact copy before read. */
export async function ensureOnePathPastParityBeforeRead(_args: {
  ownerUserId: string;
  testHomeHouseId: string;
  sourceUserId: string;
  sourceHouseId: string;
}): Promise<OnePathPastParitySyncResult | null> {
  return null;
}

/** No-op: see docs/ONE_PATH_DUAL_RUN_GOAL.md */
export async function maybeHealOnePathPastParityForRead(_args: {
  ownerUserId: string;
  testHomeHouseId: string;
}): Promise<OnePathPastParitySyncResult | null> {
  return null;
}
