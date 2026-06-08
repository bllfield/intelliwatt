/**
 * Phase 2B — bootstrap manual Past cross-surface proof fixtures (WRITES database).
 *
 * Separates SAME_PAYLOAD fixtures from GAPFILL_DERIVED fixtures so derived GapFill
 * bootstrap cannot overwrite same-payload lab/admin state used for parity proof.
 *
 * Guardrails — refuses to run unless ALL are set:
 *   ALLOW_PROD_MANUAL_RECALC=1
 *   AUDIT_USER_EMAIL
 *   AUDIT_SOURCE_HOUSE_ID
 *   AUDIT_LAB_HOUSE_ID
 *
 * Optional:
 *   AUDIT_FIXTURE_PHASE=ALL|SAME_PAYLOAD|GAPFILL_DERIVED  (default ALL)
 *
 * Usage:
 *   PAST_SIM_RECALC_INLINE=true \
 *   ALLOW_PROD_MANUAL_RECALC=1 \
 *   AUDIT_USER_EMAIL=user@example.com \
 *   AUDIT_SOURCE_HOUSE_ID=<source-uuid> \
 *   AUDIT_LAB_HOUSE_ID=<lab-uuid> \
 *   npx tsx --require ./scripts/register-server-only-stub.cjs scripts/audit/bootstrap-manual-cross-surface-fixtures.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.PAST_SIM_RECALC_INLINE = "true";
process.env.MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST = "1";
process.env.MANUAL_CROSS_SURFACE_FIXTURE_BOOTSTRAP = "1";

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

function parseFixturePhase() {
  const raw = String(process.env.AUDIT_FIXTURE_PHASE ?? "ALL").trim().toUpperCase();
  if (raw !== "ALL" && raw !== "SAME_PAYLOAD" && raw !== "GAPFILL_DERIVED") {
    console.error("Invalid AUDIT_FIXTURE_PHASE (expected ALL, SAME_PAYLOAD, or GAPFILL_DERIVED).");
    process.exit(2);
  }
  return raw;
}

function parseFixtureFinalMode() {
  const raw = String(process.env.AUDIT_FIXTURE_FINAL_MODE ?? "MONTHLY").trim().toUpperCase();
  if (raw !== "MONTHLY" && raw !== "ANNUAL") {
    console.error("Invalid AUDIT_FIXTURE_FINAL_MODE (expected MONTHLY or ANNUAL).");
    process.exit(2);
  }
  return raw;
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

const SAME_PAYLOAD_READ_MODEL =
  "buildOnePathManualUsagePastSimReadResult->readOnePathSimulatedUsageScenario";
const USER_RUN_DISPATCH = "dispatchPastSimRecalc(MANUAL_TOTALS)->onePath recalcSimulatorBuild";
const LAB_RUN_DISPATCH =
  "dispatchPastSimRecalc(MANUAL_TOTALS)->usageSimulator wrapper->onePath recalcSimulatorBuild";
const ADMIN_RUN_DISPATCH =
  "adaptManual*RawInput->runSharedSimulation->runOnePathSimulatorBuild";

async function findPastScenarioId(prisma, userId, houseId) {
  const row = await prisma.usageSimulatorScenario.findFirst({
    where: { userId, houseId, name: "Past (Corrected)", archivedAt: null },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  return row?.id ?? null;
}

async function readArtifactRow(usagePrisma, houseId, scenarioId, inputHash) {
  if (inputHash) {
    const pinned = await usagePrisma.pastSimulatedDatasetCache.findFirst({
      where: { houseId, scenarioId: String(scenarioId), inputHash },
      select: { id: true, inputHash: true, updatedAt: true, datasetJson: true, windowStartUtc: true, windowEndUtc: true },
    });
    if (pinned) return pinned;
  }
  return usagePrisma.pastSimulatedDatasetCache.findFirst({
    where: { houseId, scenarioId: String(scenarioId) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, inputHash: true, updatedAt: true, datasetJson: true, windowStartUtc: true, windowEndUtc: true },
  });
}

function readArtifactPersistDiagnostics(artifactRow) {
  const datasetJson = artifactRow?.datasetJson ?? null;
  const meta = datasetJson && typeof datasetJson === "object" ? datasetJson.meta ?? {} : {};
  const summary =
    datasetJson && typeof datasetJson === "object" ? datasetJson.summary ?? {} : {};
  return {
    artifactCoverageStart: String(meta.coverageStart ?? summary.start ?? artifactRow?.windowStartUtc ?? "").slice(0, 10) || null,
    artifactCoverageEnd: String(meta.coverageEnd ?? summary.end ?? artifactRow?.windowEndUtc ?? "").slice(0, 10) || null,
    manualCanonicalArtifactWindowVersion:
      typeof meta.manualCanonicalArtifactWindowVersion === "string"
        ? meta.manualCanonicalArtifactWindowVersion
        : null,
    manualCanonicalArtifactWindowPersistAudit:
      meta.manualCanonicalArtifactWindowPersistAudit && typeof meta.manualCanonicalArtifactWindowPersistAudit === "object"
        ? meta.manualCanonicalArtifactWindowPersistAudit
        : null,
  };
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

async function validateNonZeroPayload(payload) {
  const { validateManualUsagePayload } = await import("../../modules/manualUsage/validation.ts");
  const {
    isZeroAnnualManualPayload,
    isZeroMonthlyManualPayload,
  } = await import("../../lib/usage/manualCrossSurfaceParityProof.ts");
  const validation = validateManualUsagePayload(payload);
  if (!validation.ok) {
    throw new Error(`manual payload validation failed: ${validation.error}`);
  }
  if (payload.mode === "MONTHLY" && isZeroMonthlyManualPayload(payload)) {
    throw new Error("manual monthly payload is all-zero");
  }
  if (payload.mode === "ANNUAL" && isZeroAnnualManualPayload(payload)) {
    throw new Error("manual annual payload is all-zero");
  }
  return validation.value;
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
      preservePastCacheVariants: true,
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
  const fixturePhase = parseFixturePhase();
  const fixtureFinalMode = parseFixtureFinalMode();
  const EMAIL = requireEnv("AUDIT_USER_EMAIL");
  const SOURCE_HOUSE = requireEnv("AUDIT_SOURCE_HOUSE_ID");
  const LAB_HOUSE = requireEnv("AUDIT_LAB_HOUSE_ID");
  const OWNER_EMAIL = String(process.env.AUDIT_OWNER_EMAIL ?? EMAIL).trim() || EMAIL;

  const manifestPath = resolve(process.cwd(), "scripts/audit/manual-cross-surface-fixture-manifest.json");
  let existingManifest = null;
  if (existsSync(manifestPath)) {
    try {
      existingManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      existingManifest = null;
    }
  }

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

  const [sourcePastId, labPastId, sourceManualBefore, sourceHouse] = await Promise.all([
    findPastScenarioId(prisma, user.id, SOURCE_HOUSE),
    findPastScenarioId(prisma, owner.id, LAB_HOUSE),
    getManualUsageInputForUserHouse({ userId: user.id, houseId: SOURCE_HOUSE }),
    getHouseAddressForUserHouse({ userId: user.id, houseId: SOURCE_HOUSE }),
  ]);
  const sourceTravelRanges = await getTravelRangesFromDb(user.id, SOURCE_HOUSE);
  const labTravelRanges = await getTravelRangesFromDb(owner.id, LAB_HOUSE);
  const correlationBase = `manual-fixture-bootstrap-${Date.now()}`;
  const legs = { ...(existingManifest?.legs ?? {}) };
  const samePayloadAnchor = { ...(existingManifest?.samePayloadAnchor ?? {}) };
  let canonicalSamePayloadMonthly = null;
  let canonicalSamePayloadAnnual = null;

  const nowIso = () => new Date().toISOString();

  async function recordLeg(legId, result) {
    const prior = legs[legId] ?? {};
    legs[legId] = {
      ...prior,
      ...result,
      updatedAt: nowIso(),
      createdAt: prior.createdAt ?? nowIso(),
    };
    if (legs[legId].status === "ok") {
      delete legs[legId].reason;
    }
  }

  function anchorFromPayload(payload) {
    const hashed = hashManualPayloadFields(payload);
    return {
      normalizedPayloadHash: hashed.normalizedPayloadHash,
      sourcePayloadHash: hashed.sourcePayloadHash,
      billPeriodHash: hashed.billPeriodHash,
      statementRangesHash: hashed.statementRangesHash,
      validationResultHash: hashed.validationResultHash,
    };
  }

  async function bootstrapLabLeg(args) {
    if (!labPastId) {
      await recordLeg(args.legId, { status: "skipped", reason: "lab_past_missing" });
      return null;
    }
    await saveManualUsageInputForUserHouse({
      userId: owner.id,
      houseId: LAB_HOUSE,
      payload: args.payload,
    });
    const recalc = await dispatchManualRecalc({
      userId: owner.id,
      houseId: LAB_HOUSE,
      esiid: args.esiid ?? null,
      actualContextHouseId: SOURCE_HOUSE,
      scenarioId: labPastId,
      travelRanges: labTravelRanges.length > 0 ? labTravelRanges : sourceTravelRanges,
      correlationId: `${correlationBase}-${args.legId}`,
      callerLabel: `manual_fixture_${args.legId}`,
      surface: "admin_lab",
    });
    const artifactInputHash =
      recalc.ok && recalc.artifactInputHash
        ? recalc.artifactInputHash
        : (await readArtifactRow(usagePrisma, LAB_HOUSE, labPastId, null))?.inputHash ?? null;
    const artifactRow = await readArtifactRow(usagePrisma, LAB_HOUSE, labPastId, artifactInputHash);
    const persistDiagnostics = readArtifactPersistDiagnostics(artifactRow);
    const hashed = hashManualPayloadFields(args.payload);
    await recordLeg(args.legId, {
      status: recalc.ok ? "ok" : "recalc_failed",
      scenarioId: labPastId,
      fixtureFamily: args.fixtureFamily,
      fixturePayloadMode: args.fixturePayloadMode,
      artifactId: artifactRow?.id ?? null,
      artifactInputHash,
      ...persistDiagnostics,
      sourcePayloadHash: hashed.sourcePayloadHash,
      normalizedPayloadHash: hashed.normalizedPayloadHash,
      billPeriodHash: hashed.billPeriodHash,
      statementRangesHash: hashed.statementRangesHash,
      validationResultHash: hashed.validationResultHash,
      gapfillDerivedPayloadHash: args.gapfillDerivedPayloadHash ?? null,
      readModelPath: args.readModelPath ?? SAME_PAYLOAD_READ_MODEL,
      runDispatchPath: args.runDispatchPath ?? LAB_RUN_DISPATCH,
      payloadSource: args.payloadSource ?? null,
      error: recalc.ok ? null : recalc.error,
      note: args.note ?? null,
    });
    return { recalc, artifactInputHash, hashed };
  }

  async function bootstrapSourceLeg(args) {
    if (!sourcePastId) {
      await recordLeg(args.legId, { status: "skipped", reason: "past_scenario_missing" });
      return null;
    }
    await saveManualUsageInputForUserHouse({
      userId: user.id,
      houseId: SOURCE_HOUSE,
      payload: args.payload,
    });
    const recalc = await dispatchManualRecalc({
      userId: user.id,
      houseId: SOURCE_HOUSE,
      esiid: sourceHouse?.esiid ?? null,
      actualContextHouseId: SOURCE_HOUSE,
      scenarioId: sourcePastId,
      travelRanges: sourceTravelRanges,
      correlationId: `${correlationBase}-${args.legId}`,
      callerLabel: `manual_fixture_${args.legId}`,
      surface: "user_site",
    });
    const artifactInputHash =
      recalc.ok && recalc.artifactInputHash
        ? recalc.artifactInputHash
        : (await readArtifactRow(usagePrisma, SOURCE_HOUSE, sourcePastId, null))?.inputHash ?? null;
    const artifactRow = await readArtifactRow(usagePrisma, SOURCE_HOUSE, sourcePastId, artifactInputHash);
    const persistDiagnostics = readArtifactPersistDiagnostics(artifactRow);
    const hashed = hashManualPayloadFields(args.payload);
    await recordLeg(args.legId, {
      status: recalc.ok ? "ok" : "recalc_failed",
      scenarioId: sourcePastId,
      fixtureFamily: "SAME_PAYLOAD",
      fixturePayloadMode: args.fixturePayloadMode,
      artifactId: artifactRow?.id ?? null,
      artifactInputHash,
      ...persistDiagnostics,
      sourcePayloadHash: hashed.sourcePayloadHash,
      normalizedPayloadHash: hashed.normalizedPayloadHash,
      billPeriodHash: hashed.billPeriodHash,
      statementRangesHash: hashed.statementRangesHash,
      validationResultHash: hashed.validationResultHash,
      readModelPath: "readOnePathSimulatedUsageScenario + buildManualUsageReadDecorations",
      runDispatchPath: USER_RUN_DISPATCH,
      error: recalc.ok ? null : recalc.error,
    });
    return { recalc, artifactInputHash, hashed };
  }

  if (fixturePhase === "ALL" || fixturePhase === "SAME_PAYLOAD") {
    const monthlyDerived = await resolveGapfillPayload({
      sourceUserId: user.id,
      sourceHouseId: SOURCE_HOUSE,
      sourceEsiid: sourceHouse?.esiid ?? null,
      labOwnerUserId: owner.id,
      labHouseId: LAB_HOUSE,
      usageInputMode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });
    if (!monthlyDerived.payload || monthlyDerived.payload.mode !== "MONTHLY") {
      console.error("Failed to derive canonical non-zero monthly same-payload fixture");
      process.exit(2);
    }
    canonicalSamePayloadMonthly = await validateNonZeroPayload(monthlyDerived.payload);
    samePayloadAnchor.monthly = anchorFromPayload(canonicalSamePayloadMonthly);

    const annualDerived = await resolveGapfillPayload({
      sourceUserId: user.id,
      sourceHouseId: SOURCE_HOUSE,
      sourceEsiid: sourceHouse?.esiid ?? null,
      labOwnerUserId: owner.id,
      labHouseId: LAB_HOUSE,
      usageInputMode: "ANNUAL_FROM_SOURCE_INTERVALS",
    });
    if (!annualDerived.payload || annualDerived.payload.mode !== "ANNUAL") {
      console.error("Failed to derive canonical non-zero annual same-payload fixture");
      process.exit(2);
    }
    canonicalSamePayloadAnnual = await validateNonZeroPayload(annualDerived.payload);
    samePayloadAnchor.annual = anchorFromPayload(canonicalSamePayloadAnnual);

    // Annual artifacts first — Past cache keeps one surviving row per scenario; monthly must be recalculated last.
    await bootstrapSourceLeg({
      legId: "user_manual_annual",
      payload: canonicalSamePayloadAnnual,
      fixturePayloadMode: "ANNUAL",
    });

    if (labPastId) {
      await bootstrapLabLeg({
        legId: "one_path_admin_manual_annual",
        payload: canonicalSamePayloadAnnual,
        fixtureFamily: "SAME_PAYLOAD",
        fixturePayloadMode: "ANNUAL",
        readModelPath: "buildOnePathManualUsagePastSimReadResult + remapManualDisplayDatasetToCanonicalWindow",
        runDispatchPath: ADMIN_RUN_DISPATCH,
        note: "same-payload annual fixture — not gapfill-derived family",
      });
    } else {
      await recordLeg("one_path_admin_manual_annual", { status: "skipped", reason: "lab_past_missing" });
    }

    await bootstrapSourceLeg({
      legId: "user_manual_monthly",
      payload: canonicalSamePayloadMonthly,
      fixturePayloadMode: "MONTHLY",
    });

    if (labPastId) {
      await replaceGlobalManualMonthlyLabTestHomeFromSource({
        ownerUserId: owner.id,
        sourceUserId: user.id,
        sourceHouseId: SOURCE_HOUSE,
      }).catch(() => null);
      await saveManualUsageInputForUserHouse({
        userId: owner.id,
        houseId: LAB_HOUSE,
        payload: canonicalSamePayloadMonthly,
      });
      const labMonthly = await bootstrapLabLeg({
        legId: "manual_monthly_lab",
        payload: canonicalSamePayloadMonthly,
        fixtureFamily: "SAME_PAYLOAD",
        fixturePayloadMode: "MONTHLY",
        readModelPath: "buildOnePathManualUsagePastSimReadResult + remapManualDisplayDatasetToCanonicalWindow",
        runDispatchPath: ADMIN_RUN_DISPATCH,
      });
      if (labMonthly) {
        await recordLeg("one_path_admin_manual_monthly", {
          ...legs.manual_monthly_lab,
          note: "shares lab Past artifact with manual_monthly_lab",
          runDispatchPath: ADMIN_RUN_DISPATCH,
          readModelPath: "buildOnePathManualUsagePastSimReadResult + remapManualDisplayDatasetToCanonicalWindow",
        });
      } else {
        await recordLeg("one_path_admin_manual_monthly", {
          status: "skipped",
          reason: "lab_past_or_source_monthly_missing",
        });
      }
      await bootstrapLabLeg({
        legId: "gapfill_manual_monthly",
        payload: canonicalSamePayloadMonthly,
        fixtureFamily: "SAME_PAYLOAD",
        fixturePayloadMode: "MONTHLY",
        payloadSource: "same_payload_anchor",
        note: "GapFill MANUAL_MONTHLY fed canonical same-payload fixture",
      });
    } else {
      await recordLeg("manual_monthly_lab", { status: "skipped", reason: "lab_past_missing" });
      await recordLeg("one_path_admin_manual_monthly", { status: "skipped", reason: "lab_past_missing" });
      await recordLeg("gapfill_manual_monthly", { status: "skipped", reason: "lab_past_missing" });
    }
  }

  if (fixturePhase === "ALL" || fixturePhase === "GAPFILL_DERIVED") {
    const derivedModes = [
      {
        legId: "gapfill_annual_from_source_intervals",
        usageInputMode: "ANNUAL_FROM_SOURCE_INTERVALS",
        fixturePayloadMode: "ANNUAL",
      },
      {
        legId: "gapfill_monthly_from_source_intervals",
        usageInputMode: "MONTHLY_FROM_SOURCE_INTERVALS",
        fixturePayloadMode: "MONTHLY",
      },
    ];
    for (const mode of derivedModes) {
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
      try {
        await validateNonZeroPayload(derived.payload);
      } catch (error) {
        await recordLeg(mode.legId, {
          status: "skipped",
          reason: error instanceof Error ? error.message : "gapfill_payload_invalid",
        });
        continue;
      }
      const hashed = hashManualPayloadFields(derived.payload);
      await bootstrapLabLeg({
        legId: mode.legId,
        payload: derived.payload,
        fixtureFamily: "GAPFILL_DERIVED",
        fixturePayloadMode: mode.fixturePayloadMode,
        esiid: sourceHouse?.esiid ?? null,
        gapfillDerivedPayloadHash: hashed.normalizedPayloadHash,
        payloadSource: derived.payloadSource ?? null,
        note: "GapFill source-interval-derived payload family",
      });
    }

    if (canonicalSamePayloadMonthly || samePayloadAnchor.monthly) {
      const restorePayload =
        canonicalSamePayloadMonthly ??
        (await resolveGapfillPayload({
          sourceUserId: user.id,
          sourceHouseId: SOURCE_HOUSE,
          sourceEsiid: sourceHouse?.esiid ?? null,
          labOwnerUserId: owner.id,
          labHouseId: LAB_HOUSE,
          usageInputMode: "MONTHLY_FROM_SOURCE_INTERVALS",
        }).then((resolved) => resolved.payload));
      if (restorePayload?.mode === "MONTHLY") {
        await saveManualUsageInputForUserHouse({
          userId: owner.id,
          houseId: LAB_HOUSE,
          payload: restorePayload,
        });
      }
    }
  }

  async function finalizeSurvivingArtifacts() {
    if (fixtureFinalMode === "MONTHLY") {
      if (canonicalSamePayloadMonthly && (fixturePhase === "ALL" || fixturePhase === "SAME_PAYLOAD")) {
        await bootstrapSourceLeg({
          legId: "user_manual_monthly",
          payload: canonicalSamePayloadMonthly,
          fixturePayloadMode: "MONTHLY",
        });
        if (labPastId) {
          await bootstrapLabLeg({
            legId: "manual_monthly_lab",
            payload: canonicalSamePayloadMonthly,
            fixtureFamily: "SAME_PAYLOAD",
            fixturePayloadMode: "MONTHLY",
            readModelPath: "buildOnePathManualUsagePastSimReadResult + remapManualDisplayDatasetToCanonicalWindow",
            runDispatchPath: ADMIN_RUN_DISPATCH,
          });
          await recordLeg("one_path_admin_manual_monthly", {
            ...legs.manual_monthly_lab,
            note: "shares lab Past artifact with manual_monthly_lab",
            runDispatchPath: ADMIN_RUN_DISPATCH,
            readModelPath: "buildOnePathManualUsagePastSimReadResult + remapManualDisplayDatasetToCanonicalWindow",
          });
          await bootstrapLabLeg({
            legId: "gapfill_manual_monthly",
            payload: canonicalSamePayloadMonthly,
            fixtureFamily: "SAME_PAYLOAD",
            fixturePayloadMode: "MONTHLY",
            payloadSource: "same_payload_anchor",
            note: "GapFill MANUAL_MONTHLY fed canonical same-payload fixture",
          });
        }
        return;
      }
      if (fixturePhase === "ALL" || fixturePhase === "GAPFILL_DERIVED") {
        const derived = await resolveGapfillPayload({
          sourceUserId: user.id,
          sourceHouseId: SOURCE_HOUSE,
          sourceEsiid: sourceHouse?.esiid ?? null,
          labOwnerUserId: owner.id,
          labHouseId: LAB_HOUSE,
          usageInputMode: "MONTHLY_FROM_SOURCE_INTERVALS",
        });
        if (derived.payload?.mode === "MONTHLY" && labPastId) {
          await validateNonZeroPayload(derived.payload);
          const hashed = hashManualPayloadFields(derived.payload);
          await bootstrapLabLeg({
            legId: "gapfill_monthly_from_source_intervals",
            payload: derived.payload,
            fixtureFamily: "GAPFILL_DERIVED",
            fixturePayloadMode: "MONTHLY",
            esiid: sourceHouse?.esiid ?? null,
            gapfillDerivedPayloadHash: hashed.normalizedPayloadHash,
            payloadSource: derived.payloadSource ?? null,
            note: "GapFill source-interval-derived payload family (final surviving artifact)",
          });
        }
      }
      return;
    }

    if (canonicalSamePayloadAnnual && (fixturePhase === "ALL" || fixturePhase === "SAME_PAYLOAD")) {
      await bootstrapSourceLeg({
        legId: "user_manual_annual",
        payload: canonicalSamePayloadAnnual,
        fixturePayloadMode: "ANNUAL",
      });
      if (labPastId) {
        await bootstrapLabLeg({
          legId: "one_path_admin_manual_annual",
          payload: canonicalSamePayloadAnnual,
          fixtureFamily: "SAME_PAYLOAD",
          fixturePayloadMode: "ANNUAL",
          readModelPath: "buildOnePathManualUsagePastSimReadResult + remapManualDisplayDatasetToCanonicalWindow",
          runDispatchPath: ADMIN_RUN_DISPATCH,
          note: "same-payload annual fixture — not gapfill-derived family",
        });
      }
      return;
    }
    if (fixturePhase === "ALL" || fixturePhase === "GAPFILL_DERIVED") {
      const derived = await resolveGapfillPayload({
        sourceUserId: user.id,
        sourceHouseId: SOURCE_HOUSE,
        sourceEsiid: sourceHouse?.esiid ?? null,
        labOwnerUserId: owner.id,
        labHouseId: LAB_HOUSE,
        usageInputMode: "ANNUAL_FROM_SOURCE_INTERVALS",
      });
      if (derived.payload?.mode === "ANNUAL" && labPastId) {
        await validateNonZeroPayload(derived.payload);
        const hashed = hashManualPayloadFields(derived.payload);
        await bootstrapLabLeg({
          legId: "gapfill_annual_from_source_intervals",
          payload: derived.payload,
          fixtureFamily: "GAPFILL_DERIVED",
          fixturePayloadMode: "ANNUAL",
          esiid: sourceHouse?.esiid ?? null,
          gapfillDerivedPayloadHash: hashed.normalizedPayloadHash,
          payloadSource: derived.payloadSource ?? null,
          note: "GapFill source-interval-derived payload family (final surviving artifact)",
        });
      }
    }
  }

  await finalizeSurvivingArtifacts();

  if (canonicalSamePayloadMonthly || canonicalSamePayloadAnnual) {
    const monthlyPayload = canonicalSamePayloadMonthly;
    const annualPayload = canonicalSamePayloadAnnual;
    if (fixtureFinalMode === "ANNUAL" && annualPayload) {
      await saveManualUsageInputForUserHouse({
        userId: user.id,
        houseId: SOURCE_HOUSE,
        payload: annualPayload,
      });
      if (labPastId) {
        await saveManualUsageInputForUserHouse({
          userId: owner.id,
          houseId: LAB_HOUSE,
          payload: annualPayload,
        });
      }
    } else if (monthlyPayload) {
      await saveManualUsageInputForUserHouse({
        userId: user.id,
        houseId: SOURCE_HOUSE,
        payload: monthlyPayload,
      });
      if (labPastId) {
        await saveManualUsageInputForUserHouse({
          userId: owner.id,
          houseId: LAB_HOUSE,
          payload: monthlyPayload,
        });
      }
    }
  }

  await prisma.$disconnect();

  const manifest = {
    bootstrapVersion: "manual_cross_surface_fixture_v2",
    generatedAt: nowIso(),
    fixturePhase,
    fixtureFinalMode,
    sourceHouseId: SOURCE_HOUSE,
    labHouseId: LAB_HOUSE,
    sourceUserEmail: EMAIL,
    ownerEmail: OWNER_EMAIL,
    samePayloadAnchor,
    legs,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
  console.log("Wrote", manifestPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
