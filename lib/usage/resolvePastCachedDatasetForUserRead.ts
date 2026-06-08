import { loadPastSimBuildInputsForRead } from "@/lib/usage/loadPastSimBuildInputsForRead";
import {
  resolvePastArtifactIdentity,
  type ResolvedPastArtifactIdentity,
} from "@/lib/usage/pastArtifactIdentity";
import { getHouseAddressForUserHouse } from "@/modules/onePathSim/usageSimulator/repo";
import {
  getCachedPastDataset,
  getLatestCachedPastDatasetByScenario,
  type CachedPastDataset,
} from "@/modules/onePathSim/usageSimulator/pastCache";
import { INTERVAL_CODEC_V1 } from "@/modules/onePathSim/usageSimulator/intervalCodec";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readArtifactIntervalDataFingerprint(dataset: Record<string, unknown>): string | null {
  const meta = asRecord(dataset.meta);
  const direct = String(meta.intervalDataFingerprint ?? "").trim();
  if (direct) return direct;
  const lockbox = asRecord(meta.lockboxInput);
  const sourceContext = asRecord(lockbox.sourceContext);
  return (
    String(sourceContext.intervalFingerprint ?? sourceContext.intervalDataFingerprint ?? "").trim() || null
  );
}

function isUsablePastCachedRow(row: CachedPastDataset | null | undefined): row is CachedPastDataset {
  if (!row?.datasetJson || !row.intervalsCompressed) return false;
  return row.intervalsCodec === INTERVAL_CODEC_V1;
}

export type PastCachedDatasetUserReadPath =
  | "identity_exact_hash"
  | "identity_miss_interval_fingerprint_bound_latest"
  | "artifact_missing";

/** Read-only Past cache resolution aligned with user Past route (no identity-heal recalc). */
export async function resolvePastCachedDatasetForUserRead(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  buildInputs?: Record<string, unknown> | null;
  requestedInputHash?: string | null;
}): Promise<{
  cached: CachedPastDataset | null;
  resolvedInputHash: string | null;
  identityInputHash: string | null;
  readPath: PastCachedDatasetUserReadPath;
  identity: ResolvedPastArtifactIdentity | null;
}> {
  const buildInputs =
    args.buildInputs ??
    (await loadPastSimBuildInputsForRead({
      userId: args.userId,
      houseId: args.houseId,
      scenarioId: args.scenarioId,
    }));
  const house = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId });
  const identity =
    buildInputs && house
      ? await resolvePastArtifactIdentity({
          userId: args.userId,
          requestHouseId: args.houseId,
          requestHouseEsiid: house.esiid ?? null,
          buildInputs,
        })
      : null;

  const identityInputHash = identity?.inputHash ?? null;
  const requestedHash = String(args.requestedInputHash ?? "").trim() || null;

  const tryHash = async (
    inputHash: string,
    readPath: PastCachedDatasetUserReadPath
  ): Promise<{ cached: CachedPastDataset; readPath: PastCachedDatasetUserReadPath } | null> => {
    const row = await getCachedPastDataset({
      houseId: args.houseId,
      scenarioId: args.scenarioId,
      inputHash,
    });
    if (!isUsablePastCachedRow(row)) return null;
    return { cached: row, readPath };
  };

  if (identityInputHash) {
    const exact = await tryHash(identityInputHash, "identity_exact_hash");
    if (exact) {
      return {
        cached: exact.cached,
        resolvedInputHash: identityInputHash,
        identityInputHash,
        readPath: exact.readPath,
        identity,
      };
    }
  }

  if (requestedHash && requestedHash !== identityInputHash) {
    const requested = await tryHash(requestedHash, "identity_exact_hash");
    if (requested) {
      return {
        cached: requested.cached,
        resolvedInputHash: requestedHash,
        identityInputHash,
        readPath: "identity_exact_hash",
        identity,
      };
    }
  }

  if (identity?.intervalDataFingerprint) {
    const latest = await getLatestCachedPastDatasetByScenario({
      houseId: args.houseId,
      scenarioId: args.scenarioId,
    });
    if (isUsablePastCachedRow(latest)) {
      const boundFingerprint = readArtifactIntervalDataFingerprint(latest.datasetJson);
      if (boundFingerprint && boundFingerprint === identity.intervalDataFingerprint) {
        return {
          cached: latest,
          resolvedInputHash: String(latest.inputHash ?? "").trim() || null,
          identityInputHash,
          readPath: "identity_miss_interval_fingerprint_bound_latest",
          identity,
        };
      }
    }
  }

  return {
    cached: null,
    resolvedInputHash: identityInputHash ?? requestedHash,
    identityInputHash,
    readPath: "artifact_missing",
    identity,
  };
}
