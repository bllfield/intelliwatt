/**
 * In-process User/Admin Past weather parity audit (no dev server required).
 * Usage: npx tsx --require ./scripts/register-server-only-stub.cjs scripts/tmp-audit-past-weather-parity.ts
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function scoreCards(score: Record<string, unknown> | null) {
  if (!score) return null;
  return {
    weatherEfficiency: score.weatherEfficiencyScore0to100 ?? null,
    cooling: score.coolingSensitivityScore0to100 ?? null,
    heating: score.heatingSensitivityScore0to100 ?? null,
    confidence: score.confidenceScore0to100 ?? null,
  };
}

async function main() {
  const email = process.env.AUDIT_USER_EMAIL || "bllfield32@icloud.com";
  const houseId = process.env.AUDIT_HOUSE_ID || "0bbd25b6-9b8b-40ba-9382-dd85a1e1eda4";

  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (!user) throw new Error("user not found");

  const scenario = await prisma.usageSimulatorScenario.findFirst({
    where: { userId: user.id, houseId, name: "Past (Corrected)", archivedAt: null },
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!scenario) throw new Error("Past scenario not found for house");
  await prisma.$disconnect();

  const { readOnePathSimulatedUsageScenario } = await import("@/modules/onePathSim/serviceBridge");
  const { finalizePastDatasetDisplayReadModel } = await import("@/lib/usage/finalizePastDatasetDisplayReadModel");
  const { resolveUserPastApiWeatherResponse } = await import("@/lib/usage/userPastApiWeatherResponse");
  const { buildOnePathRunReadOnlyView } = await import("@/modules/onePathSim/runReadOnlyView");
  const { auditUserAdminPastReadModelParity } = await import("@/lib/usage/intervalReadModelInvariants");
  const { getHomeProfileSimulatedByUserHouse } = await import("@/modules/homeProfile/repo");
  const { getApplianceProfileSimulatedByUserHouse } = await import("@/modules/applianceProfile/repo");
  const { normalizeStoredApplianceProfile } = await import("@/modules/applianceProfile/validation");
  const { resolvePastWeatherHouseIdFromDataset } = await import("@/lib/usage/pastVisibleWeatherReadDiagnostics");
  const { readGreenButtonTrustedHomeDateKeysFromPastMeta } = await import("@/lib/usage/greenButtonPastTrustedPool");
  const { scoreCardValues } = await import("@/lib/usage/weatherScoringOwnership");

  let readback = await readOnePathSimulatedUsageScenario({
    userId: user.id,
    houseId,
    scenarioId: scenario.id,
    readMode: "artifact_only",
    projectionMode: "baseline",
    readContext: { artifactReadMode: "artifact_only", projectionMode: "baseline", userSiteIsolation: true },
  });
  if (!readback.ok) {
    throw new Error(`artifact read failed (read-only): ${readback.code} ${readback.message}`);
  }

  const cloneDataset = () => structuredClone(readback.dataset) as Record<string, unknown>;
  const [homeProfile, applianceProfileRec] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId: user.id, houseId }),
    getApplianceProfileSimulatedByUserHouse({ userId: user.id, houseId }),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);

  async function runUserPath() {
    const dataset = cloneDataset();
    const weatherHouseId = resolvePastWeatherHouseIdFromDataset({ dataset, fallbackHouseId: houseId });
    const trusted = readGreenButtonTrustedHomeDateKeysFromPastMeta(dataset.meta);
    const t0 = performance.now();
    const finalizeOutcome = await finalizePastDatasetDisplayReadModel({
      dataset,
      homeProfile,
      applianceProfile,
      weatherHouseId,
      fallbackHouseId: houseId,
      scenarioId: scenario.id,
      greenButtonTrustedHomeDateKeys: trusted.size > 0 ? trusted : undefined,
      persistDisplayWeatherToCache: true,
    });
    const pastWeather = await resolveUserPastApiWeatherResponse({
      dataset,
      scenarioName: scenario.name,
      scenarioId: scenario.id,
      requestedHouseId: houseId,
      weatherHouseId,
      homeProfile,
      applianceProfile,
    });
    return {
      durationMs: Math.round(performance.now() - t0),
      finalizeOutcome,
      diagnostics: pastWeather.diagnostics,
      visible: scoreCards(pastWeather.diagnostics.visibleWeatherScore),
      metaC: scoreCards(pastWeather.diagnostics.datasetMetaPastDisplayWeatherSensitivityScore),
      metaB: scoreCards(pastWeather.diagnostics.datasetMetaWeatherSensitivityScore),
    };
  }

  async function runAdminPath() {
    const dataset = cloneDataset();
    const weatherHouseId = resolvePastWeatherHouseIdFromDataset({ dataset, fallbackHouseId: houseId });
    const trusted = readGreenButtonTrustedHomeDateKeysFromPastMeta(dataset.meta);
    const t0 = performance.now();
    const finalizeOutcome = await finalizePastDatasetDisplayReadModel({
      dataset,
      homeProfile,
      applianceProfile,
      weatherHouseId,
      fallbackHouseId: houseId,
      scenarioId: scenario.id,
      greenButtonTrustedHomeDateKeys: trusted.size > 0 ? trusted : undefined,
      persistDisplayWeatherToCache: false,
    });
    const { resolvePastVisibleWeatherScore, applyFinalizedPastVisibleWeatherToRunDisplayView } = await import(
      "@/lib/usage/resolvePastVisibleWeatherScore"
    );
    const pastWeather = resolvePastVisibleWeatherScore({
      finalizedDataset: dataset,
      routeOwner: "app/api/admin/tools/one-path-sim/route.ts",
      scenarioName: scenario.name,
      scenarioId: scenario.id,
      requestedHouseId: houseId,
      weatherHouseId,
      finalizeOutcome,
    });
    const adminView = applyFinalizedPastVisibleWeatherToRunDisplayView(
      buildOnePathRunReadOnlyView({ dataset }),
      pastWeather
    );
    const staleMetaSnapshot = structuredClone(asRecord(dataset.meta));
    const compactMeta = {
      ...(staleMetaSnapshot ?? {}),
      ...(asRecord(dataset.meta) ?? {}),
    };
    const compactDerivedView = buildOnePathRunReadOnlyView({
      dataset: {
        ...dataset,
        meta: compactMeta,
      },
    });
    return {
      durationMs: Math.round(performance.now() - t0),
      finalizeOutcome,
      diagnostics: pastWeather.diagnostics,
      visible: scoreCardValues(pastWeather.diagnostics.visibleWeatherScore),
      adminCards: scoreCardValues(adminView?.weatherScore),
      compactAdminCards: scoreCardValues(compactDerivedView?.weatherScore),
      metaC: scoreCards(pastWeather.diagnostics.datasetMetaPastDisplayWeatherSensitivityScore),
      metaB: scoreCards(pastWeather.diagnostics.datasetMetaWeatherSensitivityScore),
    };
  }

  const userRun = await runUserPath();
  const adminRun = await runAdminPath();

  const warmReadback = await readOnePathSimulatedUsageScenario({
    userId: user.id,
    houseId,
    scenarioId: scenario.id,
    readMode: "artifact_only",
    projectionMode: "baseline",
    readContext: { artifactReadMode: "artifact_only", projectionMode: "baseline", userSiteIsolation: true },
  });
  if (!warmReadback.ok) throw new Error(`warm artifact read failed: ${warmReadback.code}`);

  async function runWarmUserPathFromCache() {
    const dataset = structuredClone(warmReadback.dataset) as Record<string, unknown>;
    const weatherHouseId = resolvePastWeatherHouseIdFromDataset({ dataset, fallbackHouseId: houseId });
    const trusted = readGreenButtonTrustedHomeDateKeysFromPastMeta(dataset.meta);
    const t0 = performance.now();
    const finalizeOutcome = await finalizePastDatasetDisplayReadModel({
      dataset,
      homeProfile,
      applianceProfile,
      weatherHouseId,
      fallbackHouseId: houseId,
      scenarioId: scenario.id,
      greenButtonTrustedHomeDateKeys: trusted.size > 0 ? trusted : undefined,
      persistDisplayWeatherToCache: false,
    });
    const pastWeather = await resolveUserPastApiWeatherResponse({
      dataset,
      scenarioName: scenario.name,
      scenarioId: scenario.id,
      requestedHouseId: houseId,
      weatherHouseId,
      homeProfile,
      applianceProfile,
    });
    return {
      durationMs: Math.round(performance.now() - t0),
      finalizeOutcome,
      diagnostics: pastWeather.diagnostics,
      visible: scoreCards(pastWeather.diagnostics.visibleWeatherScore),
    };
  }

  const warmUserRun = await runWarmUserPathFromCache();

  const datasetForParity = cloneDataset();
  await finalizePastDatasetDisplayReadModel({
    dataset: datasetForParity,
    homeProfile,
    applianceProfile,
    weatherHouseId: resolvePastWeatherHouseIdFromDataset({ dataset: datasetForParity, fallbackHouseId: houseId }),
    fallbackHouseId: houseId,
    scenarioId: scenario.id,
    persistDisplayWeatherToCache: false,
  });
  const parity = auditUserAdminPastReadModelParity({
    dataset: datasetForParity,
    scenarioName: scenario.name,
  });

  const acceptance = {
    userVisibleEqualsAdminVisible:
      JSON.stringify(userRun.visible) === JSON.stringify(adminRun.visible),
    userVisibleEqualsMetaC:
      JSON.stringify(userRun.visible) === JSON.stringify(userRun.metaC),
    adminVisibleEqualsMetaC:
      JSON.stringify(adminRun.adminCards) === JSON.stringify(adminRun.metaC),
    compactAdminEqualsMetaC:
      JSON.stringify(adminRun.compactAdminCards) === JSON.stringify(adminRun.metaC),
    warmUserSkipsRecompute: warmUserRun.finalizeOutcome?.weatherRecomputed === false,
    parityOk: parity.ok,
    parityViolations: parity.violations,
  };

  const out = {
    houseId,
    scenarioId: scenario.id,
    userDiagnostics: userRun.diagnostics,
    adminDiagnostics: adminRun.diagnostics,
    userVisible: userRun.visible,
    adminVisible: adminRun.adminCards,
    compactAdminVisible: adminRun.compactAdminCards,
    metaB_user: userRun.metaB,
    metaB_admin: adminRun.metaB,
    userDurationMs: userRun.durationMs,
    warmUserDurationMs: warmUserRun.durationMs,
    warmUserFinalize: warmUserRun.finalizeOutcome,
    acceptance,
  };

  const outPath = resolve(process.cwd(), "scripts/tmp-audit-past-weather-parity-output.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);

  if (!acceptance.userVisibleEqualsAdminVisible || !acceptance.userVisibleEqualsMetaC || !parity.ok) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
