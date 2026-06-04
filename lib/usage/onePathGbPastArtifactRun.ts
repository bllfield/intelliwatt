import "server-only";
import { resolvePastArtifactIdentity } from "@/lib/usage/pastArtifactIdentity";
import { loadPastSimBuildInputsForRead } from "@/lib/usage/loadPastSimBuildInputsForRead";
import { resolvePastSimEsiidForHouse } from "@/lib/usage/resolvePastSimEsiidForHouse";
import { getHouseAddressForUserHouse } from "@/modules/onePathSim/usageSimulator/repo";

/**
 * Green Button Past: skip recalc when test-home cache already matches current GB interval fingerprint.
 * Unlike SMT, GB only changes when the uploaded file changes — same file keeps the same inputHash.
 */
export async function resolveOnePathGbPastCachedArtifactInputHash(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  actualContextHouseId: string;
}): Promise<string | null> {
  const scenarioId = String(args.scenarioId ?? "").trim();
  if (!scenarioId) return null;

  let buildInputs = await loadPastSimBuildInputsForRead({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId,
  });
  if (!buildInputs) return null;

  const house = await getHouseAddressForUserHouse({
    userId: args.userId,
    houseId: args.houseId,
  });
  const esiid =
    (await resolvePastSimEsiidForHouse({
      userId: args.userId,
      houseId: args.houseId,
      houseEsiid: house?.esiid ?? null,
      buildInputs,
    })) ??
    house?.esiid ??
    null;

  buildInputs = {
    ...buildInputs,
    actualContextHouseId: args.actualContextHouseId,
    preferredActualSource: "GREEN_BUTTON",
  };

  const identity = await resolvePastArtifactIdentity({
    userId: args.userId,
    requestHouseId: args.houseId,
    requestHouseEsiid: esiid,
    buildInputs,
  });
  if (!identity?.inputHash) return null;

  const { getCachedPastDataset } = await import("@/modules/onePathSim/usageSimulator/pastCache");
  const { INTERVAL_CODEC_V1 } = await import("@/modules/onePathSim/usageSimulator/intervalCodec");
  const cached = await getCachedPastDataset({
    houseId: args.houseId,
    scenarioId,
    inputHash: identity.inputHash,
  });
  if (!cached || cached.intervalsCodec !== INTERVAL_CODEC_V1) return null;

  return identity.inputHash;
}
