/**
 * Phase 1B — bootstrap manual Past cross-surface proof fixtures (WRITES database).
 *
 * Uses existing dispatch/save paths only. Lab/test-home writes are isolated to AUDIT_LAB_HOUSE_ID.
 * Source-house manual payloads are never overwritten — only recalc when payload already exists.
 *
 * Guardrails — refuses to run unless ALL are set:
 *   ALLOW_PROD_MANUAL_RECALC=1
 *   AUDIT_USER_EMAIL
 *   AUDIT_SOURCE_HOUSE_ID
 *   AUDIT_LAB_HOUSE_ID
 *
 * Usage:
 *   ALLOW_PROD_MANUAL_RECALC=1 \
 *   AUDIT_USER_EMAIL=user@example.com \
 *   AUDIT_SOURCE_HOUSE_ID=<source-uuid> \
 *   AUDIT_LAB_HOUSE_ID=<lab-uuid> \
 *   npx tsx --require ./scripts/register-server-only-stub.cjs scripts/audit/bootstrap-manual-cross-surface-fixtures.mjs
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

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(2);
  }
  return value;
}

function assertProdWriteAllowed() {
  const flag = String(process.env.ALLOW_PROD_MANUAL_RECALC ?? "").trim().toLowerCase();
  if (flag !== "1" && flag !== "true" && flag !== "yes") {
    console.error(
      "Refusing to write manual fixtures: set ALLOW_PROD_MANUAL_RECALC=1 with explicit house IDs before running."
    );
    process.exit(2);
  }
}

const GAPFILL_MODES = [
  { legId: "gapfill_manual_monthly", usageInputMode: "MANUAL_MONTHLY" },
  { legId: "gapfill_monthly_from_source_intervals", usageInputMode: "MONTHLY_FROM_SOURCE_INTERVALS" },
  { legId: "gapfill_annual_from_source_intervals", usageInputMode: "ANNUAL_FROM_SOURCE_INTERVALS" },
];

async function findPastScenarioId(prisma, userId, houseId) {
  const row = await prisma.usageSimulatorScenario.findFirst({
    where: { userId, houseId, name: "Past (Corrected)", archivedAt: null },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  return row?.id ?? null;
}

async function readLatestArtifactInputHash(usagePrisma, houseId, scenarioId) {
  const row = await usagePrisma.pastSimulatedDatasetCache.findFirst({
    where: { houseId, scenarioId: String(scenarioId) },
    orderBy: { updatedAt: "desc" },
    select: { inputHash: true, id: true, updatedAt: true },
  });
  return row?.inputHash ?? null;
}

async function resolveGapfillPayload(args) {
  const {
    reanchorGapfillManualStageOnePayload,
    resolveGapfillSyntheticAnchorEndDate,
    resolveSharedManualStageOneContract,
  } = await import("../../modules/manualUsage/prefill.ts");
  const { addDaysToIsoDate } = await import("../../modules/manualUsage/statementRanges.ts");
  const { getManualUsageInputForUserHouse } = await import("../../modules/manualUsage/store.ts");
  const { getActualUsageDatasetForHouse } = await import("../../lib/usage/actualDatasetForHouse.ts");

  const [sourceManualRec, testHomeManualRec, sourceUsageDataset] = await Promise.all([
    getManualUsageInputForUserHouse({ userId: args.sourceUserId, houseId: args.sourceHouseId }),
    getManualUsageInputForUserHouse({ userId: args.labOwnerUserId, houseId: args.labHouseId }),
    getActualUsageDatasetForHouse(args.sourceHouseId, args.sourceEsiid ?? null, {
      skipFullYearIntervalFetch: true,
    }).catch(() => ({ dataset: null })),
  ]);
  const actualEndDate = String(sourceUsageDataset?.dataset?.summary?.end ?? "").slice(0, 10) || null;
  const syntheticAnchorEndDate =
    args.usageInputMode === "ANNUAL_FROM_SOURCE_INTERVALS"
      ? actualEndDate
        ? addDaysToIsoDate(actualEndDate, -2)
        : null
      : resolveGapfillSyntheticAnchorEndDate(actualEndDate);
  const resolved = resolveSharedManualStageOneContract({
    mode: args.usageInputMode === "ANNUAL_FROM_SOURCE_INTERVALS" ? "ANNUAL" : "MONTHLY",
    sourcePayload: sourceManualRec.payload,
    actualEndDate: syntheticAnchorEndDate,
    travelRanges: testHomeManualRec.payload?.travelRanges ?? sourceManualRec.payload?.travelRanges ?? [],
    dailyRows: sourceUsageDataset?.dataset?.daily ?? [],
    testHomePayload: testHomeManualRec.payload,
  });
  if (!resolved.payload || !syntheticAnchorEndDate) return resolved;
  if (resolved.payloadSource === "test_home_saved_payload") return resolved;
  return {
    ...resolved,
    payload: reanchorGapfillManualStageOnePayload({
      payload: {
        ...resolved.payload,
        dateSourceMode: "AUTO_DATES",
      },
      anchorEndDate: syntheticAnchorEndDate,
    }),
  };
}

async function dispatchManualRecalc(args) {
  const { dispatchPastSimRecalc } = await import("../../modules/usageSimulator/pastSimRecalcDispatch.ts");
  const { resolvePastValidationPolicy } = await import("../../lib/usage/pastValidationPolicy.ts");
  const { resolveUserWeatherLogicSetting } = await import("../../modules/usageSimulator/pastSimWeatherPolicy.ts");
  const validationPolicy = resolvePastValidationPolicy({
    surface: args.surface ?? "user_site",
  });
  const weather = resolveUserWeatherLogicSetting();
  const dispatched = await dispatchPastSimRecalc({
    userId: args.userId,
    houseId: args.houseId,
    esiid: args.esiid ?? null,
    actualContextHouseId: args.actualContextHouseId ?? args.houseId,
    mode: "MANUAL_TOTALS",
    scenarioId: args.scenarioId,
    weatherPreference: weather.weatherPreference,
    persistPastSimBaseline: true,
    preLockboxTravelRanges: args.travelRanges ?? [],
    validationDaySelectionMode: validationPolicy.selectionMode,
    validationDayCount: validationPolicy.validationDayCount,
    correlationId: args.correlationId,
    runContext: {
      callerLabel: args.callerLabel ?? "manual_fixture_bootstrap",
      buildPathKind: "recalc",
      persistRequested: true,
    },
  });
  if (dispatched.executionMode === "droplet_async") {
    return {
      ok: false,
      error: "droplet_async",
      message: "Manual fixture bootstrap requires inline recalc; droplet async is not supported here.",
      jobId: dispatched.jobId,
    };
  }
  if (!dispatched.result.ok) {
    return {
      ok: false,
      error: dispatched.result.error ?? "recalc_failed",
      message: String(dispatched.result.error ?? "recalc_failed"),
    };
  }
  return {
    ok: true,
    artifactInputHash: dispatched.result.canonicalArtifactInputHash ?? null,
  };
}

async function main() {
  assertProdWriteAllowed();
  const EMAIL = requireEnv("AUDIT_USER_EMAIL");
  const SOURCE_HOUSE = requireEnv("AUDIT_SOURCE_HOUSE_ID");
  const LAB_HOUSE = requireEnv("AUDIT_LAB_HOUSE_ID");
  const OWNER_EMAIL = String(process.env.AUDIT_OWNER_EMAIL ?? EMAIL).trim() || EMAIL;

  const { prisma } = await import("../../lib/db.ts");
  const { usagePrisma } = await import("../../lib/db/usageClient.ts");
  const { getManualUsageInputForUserHouse, saveManualUsageInputForUserHouse } = await import(
    "../../modules/manualUsage/store.ts"
  );
  const { getTravelRangesFromDb } = await import("../../app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers.ts");
  const { getHouseAddressForUserHouse } = await import("../../modules/onePathSim/usageSimulator/repo.ts");
  const { replaceGlobalManualMonthlyLabTestHomeFromSource } = await import(
    "../../modules/usageSimulator/labTestHome.ts"
  );
  const { hashManualPayloadFields } = await import("../../lib/usage/manualCrossSurfaceParityProof.ts");

  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (!user || !owner) {
    console.error("user or owner account missing");
    process.exit(2);
  }

  const [sourcePastId, labPastId, sourceManual, sourceHouse] = await Promise.all([
    findPastScenarioId(prisma, user.id, SOURCE_HOUSE),
    findPastScenarioId(prisma, owner.id, LAB_HOUSE),
    getManualUsageInputForUserHouse({ userId: user.id, houseId: SOURCE_HOUSE }),
    getHouseAddressForUserHouse({ userId: user.id, houseId: SOURCE_HOUSE }),
  ]);
  const sourceTravelRanges = await getTravelRangesFromDb(user.id, SOURCE_HOUSE);
  const labTravelRanges = await getTravelRangesFromDb(owner.id, LAB_HOUSE);
  const correlationBase = `manual-fixture-bootstrap-${Date.now()}`;
  const legs = {};

  async function recordLeg(legId, result) {
    legs[legId] = result;
  }

  if (sourceManual.payload?.mode === "MONTHLY" && sourcePastId) {
    const recalc = await dispatchManualRecalc({
      userId: user.id,
      houseId: SOURCE_HOUSE,
      esiid: sourceHouse?.esiid ?? null,
      actualContextHouseId: SOURCE_HOUSE,
      scenarioId: sourcePastId,
      travelRanges: sourceTravelRanges,
      correlationId: `${correlationBase}-user-monthly`,
      callerLabel: "manual_fixture_user_monthly",
      surface: "user_site",
    });
    const artifactInputHash =
      recalc.ok && recalc.artifactInputHash
        ? recalc.artifactInputHash
        : await readLatestArtifactInputHash(usagePrisma, SOURCE_HOUSE, sourcePastId);
    await recordLeg("user_manual_monthly", {
      status: recalc.ok ? "ok" : "recalc_failed",
      scenarioId: sourcePastId,
      artifactInputHash,
      normalizedPayloadHash: hashManualPayloadFields(sourceManual.payload).normalizedPayloadHash,
      error: recalc.ok ? null : recalc.error,
    });
  } else {
    await recordLeg("user_manual_monthly", {
      status: "skipped",
      reason: sourceManual.payload?.mode === "MONTHLY" ? "past_scenario_missing" : "source_manual_monthly_missing",
    });
  }

  if (sourceManual.payload?.mode === "ANNUAL" && sourcePastId) {
    const recalc = await dispatchManualRecalc({
      userId: user.id,
      houseId: SOURCE_HOUSE,
      esiid: sourceHouse?.esiid ?? null,
      actualContextHouseId: SOURCE_HOUSE,
      scenarioId: sourcePastId,
      travelRanges: sourceTravelRanges,
      correlationId: `${correlationBase}-user-annual`,
      callerLabel: "manual_fixture_user_annual",
      surface: "user_site",
    });
    const artifactInputHash =
      recalc.ok && recalc.artifactInputHash
        ? recalc.artifactInputHash
        : await readLatestArtifactInputHash(usagePrisma, SOURCE_HOUSE, sourcePastId);
    await recordLeg("user_manual_annual", {
      status: recalc.ok ? "ok" : "recalc_failed",
      scenarioId: sourcePastId,
      artifactInputHash,
      normalizedPayloadHash: hashManualPayloadFields(sourceManual.payload).normalizedPayloadHash,
      error: recalc.ok ? null : recalc.error,
    });
  } else {
    await recordLeg("user_manual_annual", {
      status: "skipped",
      reason: sourceManual.payload?.mode === "ANNUAL" ? "past_scenario_missing" : "source_manual_annual_missing",
    });
  }

  if (labPastId && sourceManual.payload?.mode === "MONTHLY") {
    await replaceGlobalManualMonthlyLabTestHomeFromSource({
      ownerUserId: owner.id,
      sourceUserId: user.id,
      sourceHouseId: SOURCE_HOUSE,
    }).catch(() => null);
    const labManual = await getManualUsageInputForUserHouse({ userId: owner.id, houseId: LAB_HOUSE });
    const recalc = await dispatchManualRecalc({
      userId: owner.id,
      houseId: LAB_HOUSE,
      esiid: null,
      actualContextHouseId: SOURCE_HOUSE,
      scenarioId: labPastId,
      travelRanges: labTravelRanges.length > 0 ? labTravelRanges : sourceTravelRanges,
      correlationId: `${correlationBase}-lab-monthly`,
      callerLabel: "manual_fixture_lab_monthly",
      surface: "admin_lab",
    });
    const artifactInputHash =
      recalc.ok && recalc.artifactInputHash
        ? recalc.artifactInputHash
        : await readLatestArtifactInputHash(usagePrisma, LAB_HOUSE, labPastId);
    await recordLeg("manual_monthly_lab", {
      status: recalc.ok ? "ok" : "recalc_failed",
      scenarioId: labPastId,
      artifactInputHash,
      normalizedPayloadHash: labManual.payload ? hashManualPayloadFields(labManual.payload).normalizedPayloadHash : null,
      error: recalc.ok ? null : recalc.error,
    });
    await recordLeg("one_path_admin_manual_monthly", {
      status: recalc.ok ? "ok" : "recalc_failed",
      scenarioId: labPastId,
      artifactInputHash,
      normalizedPayloadHash: labManual.payload ? hashManualPayloadFields(labManual.payload).normalizedPayloadHash : null,
      error: recalc.ok ? null : recalc.error,
      note: "shares lab Past artifact with manual_monthly_lab",
    });
  } else {
    await recordLeg("manual_monthly_lab", { status: "skipped", reason: "lab_past_or_source_monthly_missing" });
    await recordLeg("one_path_admin_manual_monthly", {
      status: "skipped",
      reason: "lab_past_or_source_monthly_missing",
    });
  }

  const annualDerived = await resolveGapfillPayload({
    sourceUserId: user.id,
    sourceHouseId: SOURCE_HOUSE,
    sourceEsiid: sourceHouse?.esiid ?? null,
    labOwnerUserId: owner.id,
    labHouseId: LAB_HOUSE,
    usageInputMode: "ANNUAL_FROM_SOURCE_INTERVALS",
  });
  if (labPastId && annualDerived.payload?.mode === "ANNUAL") {
    await saveManualUsageInputForUserHouse({
      userId: owner.id,
      houseId: LAB_HOUSE,
      payload: annualDerived.payload,
    });
    const recalc = await dispatchManualRecalc({
      userId: owner.id,
      houseId: LAB_HOUSE,
      esiid: sourceHouse?.esiid ?? null,
      actualContextHouseId: SOURCE_HOUSE,
      scenarioId: labPastId,
      travelRanges: labTravelRanges.length > 0 ? labTravelRanges : sourceTravelRanges,
      correlationId: `${correlationBase}-lab-annual`,
      callerLabel: "manual_fixture_lab_annual",
      surface: "admin_lab",
    });
    const artifactInputHash =
      recalc.ok && recalc.artifactInputHash
        ? recalc.artifactInputHash
        : await readLatestArtifactInputHash(usagePrisma, LAB_HOUSE, labPastId);
    await recordLeg("one_path_admin_manual_annual", {
      status: recalc.ok ? "ok" : "recalc_failed",
      scenarioId: labPastId,
      artifactInputHash,
      gapfillDerivedPayloadHash: hashManualPayloadFields(annualDerived.payload).normalizedPayloadHash,
      normalizedPayloadHash: hashManualPayloadFields(annualDerived.payload).normalizedPayloadHash,
      error: recalc.ok ? null : recalc.error,
      note: "lab-only annual payload derived from source intervals",
    });
  } else {
    await recordLeg("one_path_admin_manual_annual", {
      status: "skipped",
      reason: annualDerived.payload ? "lab_past_missing" : "annual_derived_payload_unresolved",
    });
  }

  for (const mode of GAPFILL_MODES) {
    if (!labPastId) {
      await recordLeg(mode.legId, { status: "skipped", reason: "lab_past_missing" });
      continue;
    }
    const derived = await resolveGapfillPayload({
      sourceUserId: user.id,
      sourceHouseId: SOURCE_HOUSE,
      sourceEsiid: sourceHouse?.esiid ?? null,
      labOwnerUserId: owner.id,
      labHouseId: LAB_HOUSE,
      usageInputMode: mode.usageInputMode,
    });
    if (!derived.payload) {
      await recordLeg(mode.legId, { status: "skipped", reason: "gapfill_payload_unresolved" });
      continue;
    }
    await saveManualUsageInputForUserHouse({
      userId: owner.id,
      houseId: LAB_HOUSE,
      payload: derived.payload,
    });
    const recalc = await dispatchManualRecalc({
      userId: owner.id,
      houseId: LAB_HOUSE,
      esiid: mode.usageInputMode === "MANUAL_MONTHLY" ? null : sourceHouse?.esiid ?? null,
      actualContextHouseId: SOURCE_HOUSE,
      scenarioId: labPastId,
      travelRanges: labTravelRanges.length > 0 ? labTravelRanges : sourceTravelRanges,
      correlationId: `${correlationBase}-${mode.legId}`,
      callerLabel: `manual_fixture_${mode.legId}`,
      surface: "admin_lab",
    });
    const artifactInputHash =
      recalc.ok && recalc.artifactInputHash
        ? recalc.artifactInputHash
        : await readLatestArtifactInputHash(usagePrisma, LAB_HOUSE, labPastId);
    await recordLeg(mode.legId, {
      status: recalc.ok ? "ok" : "recalc_failed",
      scenarioId: labPastId,
      usageInputMode: mode.usageInputMode,
      artifactInputHash,
      gapfillDerivedPayloadHash: hashManualPayloadFields(derived.payload).normalizedPayloadHash,
      normalizedPayloadHash: hashManualPayloadFields(derived.payload).normalizedPayloadHash,
      payloadSource: derived.payloadSource ?? null,
      error: recalc.ok ? null : recalc.error,
    });
  }

  await prisma.$disconnect();

  const manifest = {
    bootstrapVersion: "manual_cross_surface_fixture_v1",
    generatedAt: new Date().toISOString(),
    sourceHouseId: SOURCE_HOUSE,
    labHouseId: LAB_HOUSE,
    sourceUserEmail: EMAIL,
    ownerEmail: OWNER_EMAIL,
    legs,
  };
  const outPath = resolve(process.cwd(), "scripts/audit/manual-cross-surface-fixture-manifest.json");
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
  console.log("Wrote", outPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
