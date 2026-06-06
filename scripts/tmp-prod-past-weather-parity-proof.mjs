/**
 * Read-only production Past weather cross-surface parity proof.
 * FAIL CLOSED — no allow_rebuild, no production writes.
 *
 * Prerequisites: deployed backend with pastWeatherInputParity + profileHouseId resolver.
 *
 * Usage:
 *   ADMIN_TOKEN=... npx tsx --require ./scripts/register-server-only-stub.cjs scripts/tmp-prod-past-weather-parity-proof.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const BASE = process.env.BASE_URL || "https://intelliwatt.com";
const TOKEN = process.env.ADMIN_TOKEN || "";
const EMAIL = process.env.AUDIT_USER_EMAIL || "bllfield32@icloud.com";
const SOURCE_HOUSE = process.env.AUDIT_SOURCE_HOUSE_ID || "0bbd25b6-9b8b-40ba-9382-dd85a1e1eda4";
const TEST_HOUSE = process.env.AUDIT_LAB_HOUSE_ID || "29a3d820-2593-4673-9dd6-cd161bbd7f6f";
const OWNER_EMAIL = process.env.AUDIT_OWNER_EMAIL || "brian@intellipath-solutions.com";

function scoreCard(score) {
  if (!score || typeof score !== "object") return null;
  return {
    efficiency: score.weatherEfficiencyScore0to100 ?? null,
    cooling: score.coolingSensitivityScore0to100 ?? null,
    heating: score.heatingSensitivityScore0to100 ?? null,
    confidence: score.confidenceScore0to100 ?? null,
    sourceOwner: score.sourceOwner ?? score.displayOwner ?? null,
    scoringContext: score.scoringContext ?? null,
  };
}

function pickMeta(body) {
  return body?.dataset?.meta ?? body?.readModel?.dataset?.meta ?? {};
}

async function adminPost(body) {
  const res = await fetch(`${BASE}/api/admin/tools/one-path-sim`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": TOKEN },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function loadSourceArtifactReadOnly(userId, houseId, scenarioId) {
  const { getCachedPastDataset } = await import("../modules/onePathSim/usageSimulator/pastCache.ts");
  const { loadPastSimBuildInputsForRead } = await import("../lib/usage/loadPastSimBuildInputsForRead.ts");
  const { resolvePastArtifactIdentity } = await import("../lib/usage/pastArtifactIdentity.ts");
  const { getHouseAddressForUserHouse } = await import("../modules/onePathSim/usageSimulator/repo.ts");

  const buildInputs = await loadPastSimBuildInputsForRead({ userId, houseId, scenarioId });
  const house = await getHouseAddressForUserHouse({ userId, houseId });
  if (!buildInputs || !house) return null;
  const identity = await resolvePastArtifactIdentity({
    userId,
    requestHouseId: houseId,
    requestHouseEsiid: house.esiid ?? null,
    buildInputs,
  });
  if (!identity?.inputHash) return null;
  return getCachedPastDataset({ houseId, scenarioId, inputHash: identity.inputHash });
}

async function main() {
  if (!TOKEN) {
    console.error("ADMIN_TOKEN missing");
    process.exit(2);
  }

  const { prisma } = await import("../lib/db.ts");
  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true } });
  const sourcePast = user
    ? await prisma.usageSimulatorScenario.findFirst({
        where: { userId: user.id, houseId: SOURCE_HOUSE, name: "Past (Corrected)", archivedAt: null },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
      })
    : null;
  const testPast = owner
    ? await prisma.usageSimulatorScenario.findFirst({
        where: { userId: owner.id, houseId: TEST_HOUSE, name: "Past (Corrected)", archivedAt: null },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
      })
    : null;
  await prisma.$disconnect();

  const adminRun = await adminPost({
    action: "run",
    email: EMAIL,
    houseId: TEST_HOUSE,
    sourceHouseId: SOURCE_HOUSE,
    onePathTestHomeHouseId: TEST_HOUSE,
    mode: "GREEN_BUTTON",
    runReason: "keeper-green-button-past",
    scenarioId: testPast?.id,
    persistRequested: false,
    overwriteProfilesFromSource: true,
  });

  const adminMeta = pickMeta(adminRun.json);
  const adminDiag = adminRun.json?.pastWeatherDiagnostics ?? {};
  const crossSurface = adminRun.json?.pastWeatherCrossSurfaceParity ?? null;
  const adminBundleC = scoreCard(adminMeta.pastDisplayWeatherSensitivityScore);
  const adminTop = scoreCard(adminRun.json?.weatherSensitivityScore ?? adminDiag.visibleWeatherScore);
  const adminAudit = adminMeta.pastDisplayWeatherScoringAudit ?? adminRun.json?.weatherScoringAudit ?? null;

  const sourceCached =
    user && sourcePast?.id
      ? await loadSourceArtifactReadOnly(user.id, SOURCE_HOUSE, sourcePast.id)
      : null;
  const sourceMeta = (sourceCached?.datasetJson as { meta?: Record<string, unknown> } | undefined)?.meta ?? {};
  const sourceBundleC = scoreCard(sourceMeta.pastDisplayWeatherSensitivityScore);

  const { buildPastWeatherInputFingerprint, computeSimulatedProfileFingerprint } = await import(
    "../lib/usage/pastWeatherInputParity.ts"
  );
  const { getHomeProfileSimulatedByUserHouse } = await import("../modules/homeProfile/repo.ts");
  const { getApplianceProfileSimulatedByUserHouse } = await import("../modules/applianceProfile/repo.ts");

  const [userHome, userApp, testHome, testApp] = await Promise.all([
    user ? getHomeProfileSimulatedByUserHouse({ userId: user.id, houseId: SOURCE_HOUSE }) : null,
    user ? getApplianceProfileSimulatedByUserHouse({ userId: user.id, houseId: SOURCE_HOUSE }) : null,
    owner ? getHomeProfileSimulatedByUserHouse({ userId: owner.id, houseId: TEST_HOUSE }) : null,
    owner ? getApplianceProfileSimulatedByUserHouse({ userId: owner.id, houseId: TEST_HOUSE }) : null,
  ]);
  const userProfileFp = computeSimulatedProfileFingerprint({
    homeProfile: userHome,
    applianceProfileJson: userApp?.appliancesJson ?? null,
  });
  const testProfileFp = computeSimulatedProfileFingerprint({
    homeProfile: testHome,
    applianceProfileJson: testApp?.appliancesJson ?? null,
  });

  const sourceFingerprint = sourceCached?.datasetJson
    ? buildPastWeatherInputFingerprint({ dataset: sourceCached.datasetJson })
    : null;
  const adminFingerprint = adminRun.json?.readModel?.dataset
    ? buildPastWeatherInputFingerprint({ dataset: adminRun.json.readModel.dataset })
    : null;

  const acceptance = {
    adminHttpOk: adminRun.status === 200 && adminRun.json?.ok === true,
    crossSurfaceParityOk: crossSurface?.ok === true,
    profileFingerprintsMatch: userProfileFp === testProfileFp,
    adminTopEqualsBundleC:
      JSON.stringify(adminTop) === JSON.stringify(adminBundleC) && adminBundleC?.cooling != null,
    adminAuditScorerModule: adminAudit?.scorerModule ?? null,
    adminAuditScoringContext: adminAudit?.scoringContext ?? null,
    sourceArtifactLoaded: Boolean(sourceCached),
    inputFingerprintMatch:
      sourceFingerprint && adminFingerprint
        ? JSON.stringify({
            displayTruthRevision: sourceFingerprint.displayTruthRevision,
            finalizedDailyRowsHash: sourceFingerprint.finalizedDailyRowsHash,
            dailyWeatherHash: sourceFingerprint.dailyWeatherHash,
            usageShapeProfileIdentity: sourceFingerprint.usageShapeProfileIdentity,
            validationKeys: sourceFingerprint.validationKeys,
            travelVacantFingerprint: sourceFingerprint.travelVacantFingerprint,
            scorerVersion: sourceFingerprint.scorerVersion,
          }) ===
          JSON.stringify({
            displayTruthRevision: adminFingerprint.displayTruthRevision,
            finalizedDailyRowsHash: adminFingerprint.finalizedDailyRowsHash,
            dailyWeatherHash: adminFingerprint.dailyWeatherHash,
            usageShapeProfileIdentity: adminFingerprint.usageShapeProfileIdentity,
            validationKeys: adminFingerprint.validationKeys,
            travelVacantFingerprint: adminFingerprint.travelVacantFingerprint,
            scorerVersion: adminFingerprint.scorerVersion,
          })
        : null,
    bundleCMatch:
      sourceBundleC && adminBundleC
        ? JSON.stringify(sourceBundleC) === JSON.stringify(adminBundleC)
        : null,
    netKwh: adminRun.json?.runDisplayView?.summary?.totals?.netKwh ?? null,
    wape: adminRun.json?.runDisplayView?.compare?.metrics?.wapePct ?? null,
  };

  const out = {
    at: new Date().toISOString(),
    base: BASE,
    note: "User browser network proof must be captured separately from DevTools GET /api/user/usage/simulated/house",
    adminRun: {
      status: adminRun.status,
      ok: adminRun.json?.ok,
      weatherReadPath: adminRun.json?.weatherReadPath,
      weatherCardsSourceOwner: adminRun.json?.weatherCardsSourceOwner,
      topLevel: adminTop,
      bundleC: adminBundleC,
      audit: adminAudit
        ? {
            scorerModule: adminAudit.scorerModule,
            scoringContext: adminAudit.scoringContext,
            scoreVersion: adminAudit.scoreVersion,
            calculationVersion: adminAudit.calculationVersion,
            outputField: adminAudit.outputField,
            outputScore: adminAudit.outputScore,
          }
        : null,
      artifactInputHash: adminMeta.artifactInputHash ?? adminMeta.inputHash ?? null,
      displayTruthRevision: adminMeta.pastDisplayWeatherDisplayTruthRevision ?? null,
      usageShapeProfileIdentity:
        adminMeta.lockboxInput?.profileContext?.usageShapeProfileIdentity ??
        adminMeta.profileContext?.usageShapeProfileIdentity ??
        null,
    },
    sourceArtifact: {
      loaded: Boolean(sourceCached),
      inputHash: sourceCached?.inputHash ?? null,
      bundleC: sourceBundleC,
      fingerprint: sourceFingerprint,
    },
    profiles: {
      userSourceHouse: userProfileFp,
      ownerTestHome: testProfileFp,
      match: userProfileFp === testProfileFp,
    },
    crossSurfaceParity: crossSurface,
    acceptance,
    verdict:
      acceptance.adminHttpOk &&
      acceptance.crossSurfaceParityOk &&
      acceptance.profileFingerprintsMatch &&
      acceptance.adminTopEqualsBundleC &&
      acceptance.inputFingerprintMatch &&
      acceptance.bundleCMatch
        ? "PROD_WEATHER_PARITY_PASS"
        : "PROD_WEATHER_PARITY_FAIL",
  };

  const outPath = resolve(process.cwd(), "scripts/tmp-prod-past-weather-parity-proof-output.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);

  if (out.verdict !== "PROD_WEATHER_PARITY_PASS") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
