/**
 * DEPRECATED for User visible proof — see docs/PAST_WEATHER_PARITY_AGENT_BOOTSTRAP.md
 *
 * WARNING: User leg uses allow_rebuild on cache miss and CAN WRITE prod artifacts.
 * In-process User output is NOT valid proof of browser-visible User Past cards.
 * User proof = browser DevTools Network response only.
 *
 * Admin HTTP leg (persistRequested: false) is supplemental only.
 * Usage: npx tsx --require ./scripts/register-server-only-stub.cjs scripts/tmp-live-past-weather-proof.mjs
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
  };
}

function pickWeatherFields(label, body) {
  const meta = body?.dataset?.meta ?? body?.readModel?.dataset?.meta ?? {};
  const diag = body?.pastWeatherDiagnostics ?? {};
  const view = body?.runDisplayView ?? {};
  return {
    label,
    ok: body?.ok ?? null,
    runType: body?.runType ?? null,
    executionMode: body?.executionMode ?? null,
    artifactInputHash: meta.artifactInputHash ?? meta.inputHash ?? diag.artifactInputHash ?? null,
    netKwh: view?.summary?.totals?.netKwh ?? body?.dataset?.totals?.netKwh ?? body?.dataset?.summary?.totalKwh ?? null,
    weatherReadPath: body?.weatherReadPath ?? diag.weatherReadPath ?? null,
    weatherCardsSourceOwner: body?.weatherCardsSourceOwner ?? diag.weatherCardsSourceOwner ?? null,
    topLevel: scoreCard(body?.weatherSensitivityScore ?? diag.topLevelWeatherSensitivityScore),
    visibleDiagnostics: scoreCard(diag.visibleWeatherScore),
    metaBundleC: scoreCard(meta.pastDisplayWeatherSensitivityScore),
    metaBundleB: scoreCard(meta.weatherSensitivityScore),
    runDisplayWeather: scoreCard(view?.weatherScore),
    displayTruthRevision: meta.pastDisplayWeatherDisplayTruthRevision ?? diag.displayTruthRevision ?? null,
    finalizeVersion: meta.pastDisplayWeatherFinalizeVersion ?? null,
    recomputeCount: meta.displayWeatherRecomputeCount ?? diag.displayWeatherRecomputeCount ?? null,
    cachePersisted: meta.pastDisplayWeatherCachePersisted ?? diag.pastDisplayWeatherCachePersisted ?? null,
    houseId: meta.houseId ?? meta.artifactHouseId ?? null,
    actualContextHouseId: meta.actualContextHouseId ?? diag.actualContextHouseId ?? null,
  };
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

async function userPastInProcess(userId, houseId, scenarioId) {
  process.env.NEXT_RUNTIME = "nodejs";
  const { readOnePathSimulatedUsageScenario } = await import("../modules/onePathSim/serviceBridge.ts");
  const { finalizePastDatasetDisplayReadModel } = await import("../lib/usage/finalizePastDatasetDisplayReadModel.ts");
  const { resolveUserPastApiWeatherResponse } = await import("../lib/usage/userPastApiWeatherResponse.ts");
  const { getHomeProfileSimulatedByUserHouse } = await import("../modules/homeProfile/repo.ts");
  const { getApplianceProfileSimulatedByUserHouse } = await import("../modules/applianceProfile/repo.ts");
  const { normalizeStoredApplianceProfile } = await import("../modules/applianceProfile/validation.ts");
  const { resolveOnePathUpstreamUsageTruthForSimulation } = await import("../modules/onePathSim/runtime.ts");
  const { resolveStaleIncompleteMeterSlotCompleteDateKeys } = await import("../lib/usage/pastSimStaleIncompleteMeter.ts");
  const { readGreenButtonTrustedHomeDateKeysFromPastMeta } = await import("../lib/usage/greenButtonPastTrustedPool.ts");
  const { resolvePastWeatherHouseIdFromDataset } = await import("../lib/usage/pastVisibleWeatherReadDiagnostics.ts");
  const { prisma } = await import("../lib/db.ts");

  const scenario = await prisma.usageSimulatorScenario.findFirst({
    where: { id: scenarioId, userId, houseId },
    select: { id: true, name: true },
  });

  let readback = await readOnePathSimulatedUsageScenario({
    userId,
    houseId,
    scenarioId,
    readMode: "artifact_only",
    projectionMode: "baseline",
    readContext: { artifactReadMode: "artifact_only", projectionMode: "baseline", userSiteIsolation: true },
  });
  if (!readback.ok) {
    await prisma.$disconnect();
    return { ok: false, code: readback.code, message: readback.message, readOnlyBlocked: true };
  }

  const dataset = readback.dataset;
  const pastWeatherHouseId = resolvePastWeatherHouseIdFromDataset({ dataset, fallbackHouseId: houseId });
  const profileHouseId = pastWeatherHouseId;
  const meta = dataset?.meta ?? {};
  const preferredActualSource = String(meta.preferredActualSource ?? "GREEN_BUTTON").trim() || "GREEN_BUTTON";

  const [homeProfile, applianceProfileRec, sageTruth, smtSlotCompleteDateKeys] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId, houseId: profileHouseId }),
    getApplianceProfileSimulatedByUserHouse({ userId, houseId: profileHouseId }),
    resolveOnePathUpstreamUsageTruthForSimulation({
      userId,
      houseId,
      actualContextHouseId: pastWeatherHouseId,
      seedIfMissing: false,
      preferredActualSource,
      greenButtonFullYearIntervalsForDisplay: preferredActualSource === "GREEN_BUTTON",
    }).catch(() => null),
    resolveStaleIncompleteMeterSlotCompleteDateKeys({ esiid: null, meta }),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile(applianceProfileRec?.appliancesJson ?? null);
  const greenButtonTrustedHomeDateKeys = readGreenButtonTrustedHomeDateKeysFromPastMeta(meta);

  const finalizeOutcome = await finalizePastDatasetDisplayReadModel({
    dataset,
    sageActualDataset: sageTruth?.dataset ?? null,
    smtSlotCompleteDateKeys,
    greenButtonTrustedHomeDateKeys: greenButtonTrustedHomeDateKeys.size > 0 ? greenButtonTrustedHomeDateKeys : undefined,
    homeProfile,
    applianceProfile,
    weatherHouseId: pastWeatherHouseId,
    fallbackHouseId: houseId,
    scenarioId,
    persistDisplayWeatherToCache: false,
  });

  const pastWeather = await resolveUserPastApiWeatherResponse({
    dataset,
    scenarioName: scenario?.name ?? "Past (Corrected)",
    scenarioId,
    requestedHouseId: houseId,
    weatherHouseId: pastWeatherHouseId,
    preferredActualSource,
    finalizeOutcome,
  });

  await prisma.$disconnect();

  return {
    ok: true,
    routeOwner: "in-process user simulated/house (prod DB)",
    weatherSensitivityScore: pastWeather.weatherSensitivity.score,
    weatherCardsSourceOwner: pastWeather.weatherCardsSourceOwner,
    weatherReadPath: pastWeather.weatherReadPath,
    pastWeatherDiagnostics: pastWeather.diagnostics,
    dataset: { meta: dataset?.meta, totals: dataset?.totals, summary: dataset?.summary },
    finalizeOutcome,
    readMode: readback.readModeUsed ?? "artifact_only",
  };
}

async function profileFingerprint(userId, houseId) {
  const { getHomeProfileSimulatedByUserHouse } = await import("../modules/homeProfile/repo.ts");
  const { getApplianceProfileSimulatedByUserHouse } = await import("../modules/applianceProfile/repo.ts");
  const { createHash } = await import("crypto");
  const [home, app] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId, houseId }),
    getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
  ]);
  const canonical = JSON.stringify({ home, appliancesJson: app?.appliancesJson ?? null });
  return createHash("sha256").update(canonical, "utf8").digest("base64url").slice(0, 16);
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

  const sourceScenarioId = sourcePast?.id;
  const testScenarioId = testPast?.id;
  console.log("ids", { userId: user?.id, ownerId: owner?.id, sourceScenarioId, testScenarioId });

  const [sourceProfileFp, testProfileFp, ownerSourceProfileFp] = await Promise.all([
    user ? profileFingerprint(user.id, SOURCE_HOUSE) : null,
    owner ? profileFingerprint(owner.id, TEST_HOUSE) : null,
    owner ? profileFingerprint(owner.id, SOURCE_HOUSE) : null,
  ]);

  const adminRes = await adminPost({
    action: "run",
    email: EMAIL,
    houseId: TEST_HOUSE,
    sourceHouseId: SOURCE_HOUSE,
    onePathTestHomeHouseId: TEST_HOUSE,
    mode: "GREEN_BUTTON",
    runReason: "keeper-green-button-past",
    scenarioId: testScenarioId,
    persistRequested: false,
  });

  const userBody = user && sourceScenarioId ? await userPastInProcess(user.id, SOURCE_HOUSE, sourceScenarioId) : { ok: false };

  const crossSurfaceParity =
    userBody.ok && adminRes.json?.ok
      ? await (async () => {
          const { auditPastWeatherCrossSurfaceParity } = await import("../lib/usage/pastWeatherInputParity.ts");
          return auditPastWeatherCrossSurfaceParity({
            sourceUserId: user.id,
            sourceHouseId: SOURCE_HOUSE,
            sourceScenarioId,
            adminDataset: adminRes.json?.readModel?.dataset ?? adminRes.json?.dataset ?? {},
            adminUserId: owner?.id ?? user.id,
            adminHouseId: TEST_HOUSE,
          });
        })()
      : null;

  const adminPick = pickWeatherFields("admin_live_http", adminRes.json);
  const userPick = pickWeatherFields("user_live_inprocess", userBody);

  const parity = {
    topLevelMatch:
      JSON.stringify(adminPick.topLevel) === JSON.stringify(userPick.topLevel) &&
      adminPick.topLevel?.cooling != null,
    metaCMatch: JSON.stringify(adminPick.metaBundleC) === JSON.stringify(userPick.metaBundleC),
    metaBMatch: JSON.stringify(adminPick.metaBundleB) === JSON.stringify(userPick.metaBundleB),
    visibleDiagnosticsMatch:
      JSON.stringify(adminPick.visibleDiagnostics) === JSON.stringify(userPick.visibleDiagnostics),
    artifactHashMatch:
      adminPick.artifactInputHash && userPick.artifactInputHash
        ? adminPick.artifactInputHash === userPick.artifactInputHash
        : null,
    netKwhMatch:
      adminPick.netKwh != null && userPick.netKwh != null
        ? Math.abs(Number(adminPick.netKwh) - Number(userPick.netKwh)) < 0.2
        : null,
    profileFingerprint: {
      userSourceHouse: sourceProfileFp,
      ownerTestHome: testProfileFp,
      ownerSourceHouse: ownerSourceProfileFp,
      testMatchesUserSource: testProfileFp === sourceProfileFp,
      ownerSourceMatchesUserSource: ownerSourceProfileFp === sourceProfileFp,
    },
  };

  const out = {
    at: new Date().toISOString(),
    base: BASE,
    email: EMAIL,
    sourceHouse: SOURCE_HOUSE,
    testHouse: TEST_HOUSE,
    adminHttpStatus: adminRes.status,
    admin: adminPick,
    user: userPick,
    parity,
    crossSurfaceParity,
    verdict:
      crossSurfaceParity?.ok
        ? "WEATHER_INPUT_PARITY_OK"
        : parity.topLevelMatch && parity.visibleDiagnosticsMatch
        ? "WEATHER_PARITY_OK"
        : parity.metaCMatch && !parity.topLevelMatch
          ? "TOP_LEVEL_DIVERGES_FROM_META_C"
          : parity.metaCMatch !== parity.visibleDiagnosticsMatch
            ? "DIAGNOSTICS_DIVERGE_FROM_META_C"
            : "WEATHER_PARITY_FAIL",
  };

  const outPath = resolve(process.cwd(), "scripts/tmp-live-past-weather-proof-output.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
