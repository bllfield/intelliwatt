/**
 * Read-only manual Past cross-surface parity proof (Phase 1 — diagnostics only).
 *
 * Usage:
 *   PROOF_AUDIT_ONLY=1 \
 *   AUDIT_USER_EMAIL=user@example.com \
 *   AUDIT_SOURCE_HOUSE_ID=<uuid> \
 *   AUDIT_LAB_HOUSE_ID=<uuid> \
 *   AUDIT_MANUAL_MODE=MONTHLY \
 *   AUDIT_GAPFILL_MODE=MANUAL_MONTHLY \
 *   npx tsx --require ./scripts/register-server-only-stub.cjs scripts/audit/manual-cross-surface-parity-proof.mjs
 *
 * Optional write gate (NOT used in Phase 1 normal runs):
 *   ALLOW_PROD_MANUAL_RECALC=1
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

function parseProofAuditOnly() {
  const raw = String(process.env.PROOF_AUDIT_ONLY ?? "").trim().toLowerCase();
  if (raw !== "1" && raw !== "true" && raw !== "yes") {
    console.error("Refusing to run: set PROOF_AUDIT_ONLY=1 for read-only manual parity proof.");
    process.exit(2);
  }
  return true;
}

function parseManualMode() {
  const raw = String(process.env.AUDIT_MANUAL_MODE ?? "").trim().toUpperCase();
  if (raw !== "MONTHLY" && raw !== "ANNUAL") {
    console.error("Missing or invalid AUDIT_MANUAL_MODE (expected MONTHLY or ANNUAL).");
    process.exit(2);
  }
  return raw;
}

function parseGapfillMode() {
  const raw = String(process.env.AUDIT_GAPFILL_MODE ?? "").trim().toUpperCase();
  if (
    raw !== "MANUAL_MONTHLY" &&
    raw !== "MONTHLY_FROM_SOURCE_INTERVALS" &&
    raw !== "ANNUAL_FROM_SOURCE_INTERVALS"
  ) {
    console.error(
      "Missing or invalid AUDIT_GAPFILL_MODE (expected MANUAL_MONTHLY, MONTHLY_FROM_SOURCE_INTERVALS, or ANNUAL_FROM_SOURCE_INTERVALS)."
    );
    process.exit(2);
  }
  return raw;
}

const LEG_IDS = [
  "user_manual_monthly",
  "user_manual_annual",
  "manual_monthly_lab",
  "one_path_admin_manual_monthly",
  "one_path_admin_manual_annual",
  "gapfill_manual_monthly",
  "gapfill_monthly_from_source_intervals",
  "gapfill_annual_from_source_intervals",
];

function legPayloadMode(legId) {
  if (legId.includes("annual")) return "ANNUAL";
  if (legId.includes("monthly")) return "MONTHLY";
  return null;
}

function legInManualModeScope(legId, auditManualMode) {
  const mode = legPayloadMode(legId);
  if (!mode) return true;
  if (legId === "gapfill_manual_monthly") return auditManualMode === "MONTHLY";
  if (legId.startsWith("gapfill_")) return mode === auditManualMode || legId.includes(auditManualMode.toLowerCase());
  return mode === auditManualMode;
}

function legInGapfillScope(legId, auditGapfillMode) {
  if (!legId.startsWith("gapfill_")) return true;
  const map = {
    gapfill_manual_monthly: "MANUAL_MONTHLY",
    gapfill_monthly_from_source_intervals: "MONTHLY_FROM_SOURCE_INTERVALS",
    gapfill_annual_from_source_intervals: "ANNUAL_FROM_SOURCE_INTERVALS",
  };
  return map[legId] === auditGapfillMode;
}

async function resolveGapfillDerivedPayload(args) {
  const {
    reanchorGapfillManualStageOnePayload,
    resolveGapfillSyntheticAnchorEndDate,
    resolveSharedManualStageOneContract,
  } = await import("../../modules/manualUsage/prefill.ts");
  const { addDaysToIsoDate } = await import("../../modules/manualUsage/statementRanges.ts");
  const { getManualUsageInputForUserHouse } = await import("../../modules/manualUsage/store.ts");
  const { getActualUsageDatasetForHouse } = await import("../../lib/usage/actualDatasetForHouse.ts");
  const { getHouseAddressForUserHouse } = await import("../../modules/onePathSim/usageSimulator/repo.ts");

  const sourceHouse = await getHouseAddressForUserHouse({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
  });
  const [sourceManualRec, testHomeManualRec, sourceUsageDataset] = await Promise.all([
    getManualUsageInputForUserHouse({ userId: args.sourceUserId, houseId: args.sourceHouseId }),
    getManualUsageInputForUserHouse({ userId: args.labOwnerUserId, houseId: args.labHouseId }),
    getActualUsageDatasetForHouse(args.sourceHouseId, sourceHouse?.esiid ?? null, {
      skipFullYearIntervalFetch: true,
    }).catch(() => ({ dataset: null })),
  ]);
  const actualEndDate = String(sourceUsageDataset?.dataset?.summary?.end ?? "").slice(0, 10) || null;
  const syntheticAnchorEndDate =
    args.gapfillMode === "ANNUAL_FROM_SOURCE_INTERVALS"
      ? actualEndDate
        ? addDaysToIsoDate(actualEndDate, -2)
        : null
      : resolveGapfillSyntheticAnchorEndDate(actualEndDate);
  const resolved = resolveSharedManualStageOneContract({
    mode: args.gapfillMode === "ANNUAL_FROM_SOURCE_INTERVALS" ? "ANNUAL" : "MONTHLY",
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

async function probeArtifactLeg(args) {
  const {
    buildManualReadModelFingerprints,
    hashManualPayloadFields,
    readArtifactCoverageFromDataset,
    readDisplayCoverageFromDataset,
    readManualArtifactProofDiagnostics,
    resolveCanonicalCoverageForProof,
  } = await import("../../lib/usage/manualCrossSurfaceParityProof.ts");
  const { readOnePathSimulatedUsageScenario } = await import("../../modules/onePathSim/serviceBridge.ts");
  const canonicalCoverage = resolveCanonicalCoverageForProof();
  const payloadHashes = hashManualPayloadFields(args.payload);
  const base = {
    legId: args.legId,
    houseId: args.houseId,
    userId: args.userId,
    scenarioId: args.scenarioId,
    mode: args.surfaceMode ?? null,
    canonicalCoverageStart: canonicalCoverage.startDate,
    canonicalCoverageEnd: canonicalCoverage.endDate,
    runDispatchPath: args.runDispatchPath ?? null,
    readModelPath: args.readModelPath ?? null,
    producerVersion: null,
    gapfillDerivedPayloadHash: args.gapfillDerivedPayloadHash ?? null,
    gapfillActualComparison: args.gapfillActualComparison ?? null,
    comparisonFamily: args.comparisonFamily ?? null,
    payloadProvenance: args.payloadProvenance ?? null,
    fixtureArtifactInputHash: args.exactArtifactInputHash ?? null,
    fixtureFamily: args.fixtureFamily ?? null,
    applyAdminRemap: args.applyAdminRemap === true,
    ...payloadHashes,
  };

  if (!args.scenarioId) {
    return {
      ...base,
      status: "missing_fixture",
      unavailableReason: "past_scenario_missing",
      coverageWindowMatch: null,
    };
  }
  if (!args.payload) {
    return {
      ...base,
      status: "missing_fixture",
      unavailableReason: args.missingPayloadReason ?? "manual_payload_missing",
      coverageWindowMatch: null,
    };
  }

  const readback = await readOnePathSimulatedUsageScenario({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode: "artifact_only",
    exactArtifactInputHash: args.exactArtifactInputHash ?? undefined,
    requireExactArtifactMatch: args.exactArtifactInputHash != null,
    projectionMode: "baseline",
    readContext: {
      artifactReadMode: "artifact_only",
      projectionMode: "baseline",
      compareSidecarRequest: true,
      userSiteIsolation: args.userId !== args.labOwnerUserId,
    },
  });
  if (!readback.ok || !readback.dataset) {
    return {
      ...base,
      status: "missing_fixture",
      unavailableReason: readback.code ?? readback.message ?? "artifact_missing",
      coverageWindowMatch: null,
    };
  }

  const dataset = readback.dataset;
  const meta = dataset.meta ?? {};
  const artifactCoverage = readArtifactCoverageFromDataset(dataset);
  const proofDiagnostics = readManualArtifactProofDiagnostics(dataset);
  const display = readDisplayCoverageFromDataset({
    dataset,
    usageInputMode: args.surfaceMode ?? null,
    applyAdminRemap: args.applyAdminRemap === true,
  });
  const fingerprints = buildManualReadModelFingerprints({
    dataset: display.displayDataset ?? dataset,
    fallbackHouseId: args.houseId,
  });

  return {
    ...base,
    status: "ok",
    unavailableReason: null,
    ...artifactCoverage,
    displayCoverageStart: display.displayCoverageStart,
    displayCoverageEnd: display.displayCoverageEnd,
    coverageWindowMatch:
      artifactCoverage.artifactCoverageStart === display.displayCoverageStart &&
      artifactCoverage.artifactCoverageEnd === display.displayCoverageEnd,
    artifactInputHash: readback.artifactInputHash ?? meta.inputHash ?? null,
    producerVersion: meta.simVersion ?? meta.engineVersion ?? null,
    manualCanonicalArtifactWindowVersion:
      typeof meta.manualCanonicalArtifactWindowVersion === "string"
        ? meta.manualCanonicalArtifactWindowVersion
        : args.fixtureManualCanonicalArtifactWindowVersion ?? null,
    manualCanonicalArtifactWindowPersistAudit:
      meta.manualCanonicalArtifactWindowPersistAudit &&
      typeof meta.manualCanonicalArtifactWindowPersistAudit === "object"
        ? meta.manualCanonicalArtifactWindowPersistAudit
        : null,
    fixtureManualCanonicalArtifactWindowVersion: args.fixtureManualCanonicalArtifactWindowVersion ?? null,
    manualArtifactCoverageClass: proofDiagnostics.manualArtifactCoverageClass,
    legacyManualDisplayRemapApplied: proofDiagnostics.legacyManualDisplayRemapApplied,
    ...fingerprints,
  };
}

async function buildGapfillActualComparison(args) {
  const { buildManualUsageReadModel } = await import("../../modules/manualUsage/readModel.ts");
  const { resolveManualCompareActualDataset } = await import("../../lib/usage/manualCompareActualDataset.ts");
  const { evaluateGapfillBillPeriodActualComparison } = await import(
    "../../lib/usage/manualCrossSurfaceParityProof.ts"
  );
  const { readOnePathSimulatedUsageScenario } = await import("../../modules/onePathSim/serviceBridge.ts");
  if (!args.scenarioId || !args.payload) return null;
  const [simRead, actualDataset] = await Promise.all([
    readOnePathSimulatedUsageScenario({
      userId: args.labOwnerUserId,
      houseId: args.labHouseId,
      scenarioId: args.scenarioId,
      readMode: "artifact_only",
      exactArtifactInputHash: args.exactArtifactInputHash ?? undefined,
      requireExactArtifactMatch: args.exactArtifactInputHash != null,
      projectionMode: "baseline",
      readContext: {
        artifactReadMode: "artifact_only",
        projectionMode: "baseline",
        compareSidecarRequest: true,
        userSiteIsolation: false,
      },
    }),
    resolveManualCompareActualDataset({
      actualReference: {
        userId: args.sourceUserId,
        houseId: args.sourceHouseId,
        scenarioId: null,
        esiid: args.sourceEsiid ?? null,
      },
    }).catch(() => null),
  ]);
  if (!simRead.ok || !simRead.dataset) {
    return evaluateGapfillBillPeriodActualComparison({ readModel: null, reason: "artifact_missing" });
  }
  const readModel = buildManualUsageReadModel({
    payload: args.payload,
    dataset: simRead.dataset,
    actualDataset,
  });
  return evaluateGapfillBillPeriodActualComparison({ readModel });
}

async function main() {
  parseProofAuditOnly();
  const EMAIL = requireEnv("AUDIT_USER_EMAIL");
  const SOURCE_HOUSE = requireEnv("AUDIT_SOURCE_HOUSE_ID");
  const LAB_HOUSE = requireEnv("AUDIT_LAB_HOUSE_ID");
  const AUDIT_MANUAL_MODE = parseManualMode();
  const AUDIT_GAPFILL_MODE = parseGapfillMode();
  const OWNER_EMAIL = String(process.env.AUDIT_OWNER_EMAIL ?? EMAIL).trim() || EMAIL;
  const ALLOW_PROD_MANUAL_RECALC =
    process.env.ALLOW_PROD_MANUAL_RECALC === "1" ||
    process.env.ALLOW_PROD_MANUAL_RECALC === "true" ||
    process.env.ALLOW_PROD_MANUAL_RECALC === "yes";

  if (ALLOW_PROD_MANUAL_RECALC) {
    console.error(
      "ALLOW_PROD_MANUAL_RECALC is set but Phase 1 proof performs no writes; flag is recorded for future phases only."
    );
  }

  const {
    MANUAL_CROSS_SURFACE_PROOF_VERSION,
    aggregateManualCrossSurfaceProofViolations,
    buildUnavailableLeg,
    hashManualPayloadFields,
    resolveAuditProofFamilyFromGapfillMode,
    resolveCanonicalCoverageForProof,
    resolveManifestFixtureFamily,
    resolveManualProofComparisonFamily,
    resolveManualProofLegPayload,
    resolveManualProofPayloadProvenance,
    runOnePathManualFacadeParityCheck,
  } = await import("../../lib/usage/manualCrossSurfaceParityProof.ts");
  const { getManualUsageInputForUserHouse } = await import("../../modules/manualUsage/store.ts");
  const { prisma } = await import("../../lib/db.ts");

  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (!user || !owner) {
    console.error("user or owner account missing");
    process.exit(2);
  }

  const [sourcePast, labPast, sourceHouseRow] = await Promise.all([
    prisma.usageSimulatorScenario.findFirst({
      where: { userId: user.id, houseId: SOURCE_HOUSE, name: "Past (Corrected)", archivedAt: null },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.usageSimulatorScenario.findFirst({
      where: { userId: owner.id, houseId: LAB_HOUSE, name: "Past (Corrected)", archivedAt: null },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.houseAddress.findFirst({
      where: { id: SOURCE_HOUSE },
      select: { esiid: true },
    }),
  ]);
  const sourceEsiid = sourceHouseRow?.esiid ? String(sourceHouseRow.esiid) : null;

  const canonicalCoverage = resolveCanonicalCoverageForProof();
  const [sourceManual, labManual] = await Promise.all([
    getManualUsageInputForUserHouse({ userId: user.id, houseId: SOURCE_HOUSE }),
    getManualUsageInputForUserHouse({ userId: owner.id, houseId: LAB_HOUSE }),
  ]);

  const gapfillDerived = await resolveGapfillDerivedPayload({
    sourceUserId: user.id,
    sourceHouseId: SOURCE_HOUSE,
    labOwnerUserId: owner.id,
    labHouseId: LAB_HOUSE,
    gapfillMode: AUDIT_GAPFILL_MODE,
  });
  const samePayloadMonthlyDerived = await resolveGapfillDerivedPayload({
    sourceUserId: user.id,
    sourceHouseId: SOURCE_HOUSE,
    labOwnerUserId: owner.id,
    labHouseId: LAB_HOUSE,
    gapfillMode: "MONTHLY_FROM_SOURCE_INTERVALS",
  });
  const samePayloadAnnualDerived = await resolveGapfillDerivedPayload({
    sourceUserId: user.id,
    sourceHouseId: SOURCE_HOUSE,
    labOwnerUserId: owner.id,
    labHouseId: LAB_HOUSE,
    gapfillMode: "ANNUAL_FROM_SOURCE_INTERVALS",
  });
  const samePayloadMonthlyFallback =
    samePayloadMonthlyDerived.payload?.mode === "MONTHLY" ? samePayloadMonthlyDerived.payload : null;
  const samePayloadAnnualFallback =
    samePayloadAnnualDerived.payload?.mode === "ANNUAL" ? samePayloadAnnualDerived.payload : null;
  const gapfillPayloadHash = gapfillDerived.payload
    ? hashManualPayloadFields(gapfillDerived.payload).normalizedPayloadHash
    : null;

  const fixtureManifestPath =
    String(process.env.AUDIT_FIXTURE_MANIFEST ?? "").trim() ||
    resolve(process.cwd(), "scripts/audit/manual-cross-surface-fixture-manifest.json");
  let fixtureManifest = null;
  if (existsSync(fixtureManifestPath)) {
    try {
      fixtureManifest = JSON.parse(readFileSync(fixtureManifestPath, "utf8"));
    } catch {
      console.error(`Failed to parse fixture manifest: ${fixtureManifestPath}`);
      process.exit(2);
    }
  }
  const fixtureArtifactHashForLeg = (legId) => {
    const entry = fixtureManifest?.legs?.[legId];
    return typeof entry?.artifactInputHash === "string" && entry.artifactInputHash.trim()
      ? entry.artifactInputHash.trim()
      : null;
  };
  const fixturePersistVersionForLeg = (legId) => {
    const entry = fixtureManifest?.legs?.[legId];
    return typeof entry?.manualCanonicalArtifactWindowVersion === "string"
      ? entry.manualCanonicalArtifactWindowVersion
      : null;
  };
  const fixtureFamilyForLeg = (legId) => {
    const entry = fixtureManifest?.legs?.[legId];
    return entry?.fixtureFamily ?? resolveManifestFixtureFamily(legId);
  };
  const auditProofFamily = resolveAuditProofFamilyFromGapfillMode(AUDIT_GAPFILL_MODE);

  const samplePayloads = [sourceManual.payload, labManual.payload, gapfillDerived.payload].filter(Boolean);
  const onePathFacadeParity = await runOnePathManualFacadeParityCheck({
    samplePayloads,
  });

  const legs = [];
  for (const legId of LEG_IDS) {
    if (!legInManualModeScope(legId, AUDIT_MANUAL_MODE)) {
      legs.push(
        buildUnavailableLeg({
          legId,
          reason: `leg_mode_mismatch: AUDIT_MANUAL_MODE=${AUDIT_MANUAL_MODE}`,
          canonicalCoverage,
        })
      );
      continue;
    }
    if (!legInGapfillScope(legId, AUDIT_GAPFILL_MODE)) {
      legs.push(
        buildUnavailableLeg({
          legId,
          reason: `gapfill_mode_scope: AUDIT_GAPFILL_MODE=${AUDIT_GAPFILL_MODE}`,
          canonicalCoverage,
        })
      );
      continue;
    }
    const legFixtureFamily = fixtureFamilyForLeg(legId);
    if (legFixtureFamily !== auditProofFamily && !legId.startsWith("user_")) {
      legs.push(
        buildUnavailableLeg({
          legId,
          reason: `fixture_family_scope: leg=${legFixtureFamily} audit=${auditProofFamily}`,
          canonicalCoverage,
        })
      );
      continue;
    }
    if (auditProofFamily === "GAPFILL_DERIVED" && legId.startsWith("user_")) {
      legs.push(
        buildUnavailableLeg({
          legId,
          reason: `reference_leg_out_of_scope: auditProofFamily=${auditProofFamily}`,
          canonicalCoverage,
        })
      );
      continue;
    }

    if (legId === "user_manual_monthly" || legId === "user_manual_annual") {
      const wantMode = legId.endsWith("annual") ? "ANNUAL" : "MONTHLY";
      const manifestLeg = fixtureManifest?.legs?.[legId] ?? null;
      const payload = resolveManualProofLegPayload({
        livePayload: sourceManual.payload,
        wantMode,
        manifestLeg,
        fallbackPayload:
          wantMode === "MONTHLY" ? samePayloadMonthlyFallback : samePayloadAnnualFallback,
      });
      legs.push(
        await probeArtifactLeg({
          legId,
          userId: user.id,
          labOwnerUserId: owner.id,
          houseId: SOURCE_HOUSE,
          scenarioId: sourcePast?.id ?? null,
          payload,
          missingPayloadReason: `source_manual_${wantMode.toLowerCase()}_missing`,
          surfaceMode: wantMode === "MONTHLY" ? "MANUAL_MONTHLY" : "MANUAL_ANNUAL",
          applyAdminRemap: false,
          exactArtifactInputHash: fixtureArtifactHashForLeg(legId),
          fixtureManualCanonicalArtifactWindowVersion: fixturePersistVersionForLeg(legId),
          fixtureFamily: fixtureFamilyForLeg(legId),
          comparisonFamily: resolveManualProofComparisonFamily(legId),
          payloadProvenance: resolveManualProofPayloadProvenance(legId),
          runDispatchPath: "dispatchPastSimRecalc(MANUAL_TOTALS)->onePath recalcSimulatorBuild",
          readModelPath: "readOnePathSimulatedUsageScenario + buildManualUsageReadDecorations",
        })
      );
      continue;
    }

    if (legId === "manual_monthly_lab") {
      const manifestLeg = fixtureManifest?.legs?.[legId] ?? null;
      const payload = resolveManualProofLegPayload({
        livePayload: labManual.payload,
        wantMode: "MONTHLY",
        manifestLeg,
        fallbackPayload: samePayloadMonthlyFallback,
      });
      legs.push(
        await probeArtifactLeg({
          legId,
          userId: owner.id,
          labOwnerUserId: owner.id,
          houseId: LAB_HOUSE,
          scenarioId: labPast?.id ?? null,
          payload,
          missingPayloadReason: "lab_manual_monthly_missing",
          surfaceMode: "MANUAL_MONTHLY",
          applyAdminRemap: true,
          exactArtifactInputHash: fixtureArtifactHashForLeg(legId),
          fixtureManualCanonicalArtifactWindowVersion: fixturePersistVersionForLeg(legId),
          fixtureFamily: fixtureFamilyForLeg(legId),
          comparisonFamily: resolveManualProofComparisonFamily(legId),
          payloadProvenance: resolveManualProofPayloadProvenance(legId),
          runDispatchPath: "onePathSim/usageSimulator/pastSimRecalcDispatch(MANUAL_TOTALS)",
          readModelPath: "buildOnePathManualUsagePastSimReadResult->readOnePathSimulatedUsageScenario",
        })
      );
      continue;
    }

    if (legId === "one_path_admin_manual_monthly" || legId === "one_path_admin_manual_annual") {
      const wantMode = legId.endsWith("annual") ? "ANNUAL" : "MONTHLY";
      const manifestLeg = fixtureManifest?.legs?.[legId] ?? null;
      const payload = resolveManualProofLegPayload({
        livePayload: labManual.payload,
        wantMode,
        manifestLeg,
        fallbackPayload:
          wantMode === "MONTHLY" ? samePayloadMonthlyFallback : samePayloadAnnualFallback,
      });
      legs.push(
        await probeArtifactLeg({
          legId,
          userId: owner.id,
          labOwnerUserId: owner.id,
          houseId: LAB_HOUSE,
          scenarioId: labPast?.id ?? null,
          payload,
          missingPayloadReason: `lab_manual_${wantMode.toLowerCase()}_missing`,
          surfaceMode: wantMode === "MONTHLY" ? "MANUAL_MONTHLY" : "MANUAL_ANNUAL",
          applyAdminRemap: true,
          exactArtifactInputHash: fixtureArtifactHashForLeg(legId),
          fixtureManualCanonicalArtifactWindowVersion: fixturePersistVersionForLeg(legId),
          fixtureFamily: fixtureFamilyForLeg(legId),
          comparisonFamily: resolveManualProofComparisonFamily(legId),
          payloadProvenance: resolveManualProofPayloadProvenance(legId),
          runDispatchPath: "adaptManual*RawInput->runSharedSimulation->runOnePathSimulatorBuild",
          readModelPath: "buildOnePathManualUsagePastSimReadResult + remapManualDisplayDatasetToCanonicalWindow",
        })
      );
      continue;
    }

    const gapfillModeMap = {
      gapfill_manual_monthly: "MANUAL_MONTHLY",
      gapfill_monthly_from_source_intervals: "MONTHLY_FROM_SOURCE_INTERVALS",
      gapfill_annual_from_source_intervals: "ANNUAL_FROM_SOURCE_INTERVALS",
    };
    const gapfillMode = gapfillModeMap[legId];
    const wantPayloadMode = legId.includes("annual") ? "ANNUAL" : "MONTHLY";
    let derivedPayload = null;
    const manifestLeg = fixtureManifest?.legs?.[legId] ?? null;
    if (legId === "gapfill_manual_monthly") {
      derivedPayload = resolveManualProofLegPayload({
        livePayload: labManual.payload,
        wantMode: "MONTHLY",
        manifestLeg,
        fallbackPayload: samePayloadMonthlyFallback,
      });
    } else if (legId.includes("source_intervals")) {
      const perLegDerived = await resolveGapfillDerivedPayload({
        sourceUserId: user.id,
        sourceHouseId: SOURCE_HOUSE,
        labOwnerUserId: owner.id,
        labHouseId: LAB_HOUSE,
        gapfillMode,
      });
      derivedPayload =
        perLegDerived.payload?.mode === wantPayloadMode ? perLegDerived.payload : null;
    }
    const gapfillPayloadHashForLeg = derivedPayload
      ? hashManualPayloadFields(derivedPayload).normalizedPayloadHash
      : null;
    const gapfillActualComparison =
      legId.includes("source_intervals") && derivedPayload
        ? await buildGapfillActualComparison({
            sourceUserId: user.id,
            sourceHouseId: SOURCE_HOUSE,
            sourceEsiid,
            labOwnerUserId: owner.id,
            labHouseId: LAB_HOUSE,
            scenarioId: labPast?.id ?? null,
            payload: derivedPayload,
            exactArtifactInputHash: fixtureArtifactHashForLeg(legId),
          })
        : legId === "gapfill_manual_monthly"
          ? null
          : null;
    legs.push(
      await probeArtifactLeg({
        legId,
        userId: owner.id,
        labOwnerUserId: owner.id,
        houseId: LAB_HOUSE,
        scenarioId: labPast?.id ?? null,
        payload: derivedPayload,
        missingPayloadReason: `gapfill_${gapfillMode.toLowerCase()}_payload_unresolved`,
        surfaceMode: gapfillMode,
        applyAdminRemap: false,
        exactArtifactInputHash: fixtureArtifactHashForLeg(legId),
        fixtureManualCanonicalArtifactWindowVersion: fixturePersistVersionForLeg(legId),
        fixtureFamily: fixtureFamilyForLeg(legId),
        gapfillDerivedPayloadHash: gapfillPayloadHashForLeg,
        gapfillActualComparison,
        comparisonFamily: resolveManualProofComparisonFamily(legId),
        payloadProvenance: resolveManualProofPayloadProvenance(legId),
        runDispatchPath: "dispatchPastSimRecalc(MANUAL_TOTALS)->usageSimulator wrapper->onePath recalcSimulatorBuild",
        readModelPath: "buildOnePathManualUsagePastSimReadResult->readOnePathSimulatedUsageScenario",
      })
    );
  }

  const { violations, warnings, auditProofFamily: resolvedAuditProofFamily } = aggregateManualCrossSurfaceProofViolations({
    legs,
    auditManualMode: AUDIT_MANUAL_MODE,
    auditGapfillMode: AUDIT_GAPFILL_MODE,
    onePathFacadeParity,
    manifest: fixtureManifest,
    expectCanonicalArtifactPersist:
      String(process.env.MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST ?? "").trim() === "1",
  });

  await prisma.$disconnect();

  const out = {
    proofVersion: MANUAL_CROSS_SURFACE_PROOF_VERSION,
    generatedAt: new Date().toISOString(),
    proofMode: "audit_only",
    sourceHouseId: SOURCE_HOUSE,
    labHouseId: LAB_HOUSE,
    mode: AUDIT_MANUAL_MODE,
    payloadMode: AUDIT_MANUAL_MODE,
    auditGapfillMode: AUDIT_GAPFILL_MODE,
    auditProofFamily: resolvedAuditProofFamily,
    anchorDate: legs.find((leg) => leg.status === "ok")?.anchorDate ?? null,
    canonicalCoverageStart: canonicalCoverage.startDate,
    canonicalCoverageEnd: canonicalCoverage.endDate,
    allowProdManualRecalc: ALLOW_PROD_MANUAL_RECALC,
    fixtureManifestPath: existsSync(fixtureManifestPath) ? fixtureManifestPath : null,
    comparisonFamilies: {
      same_payload_parity: legs.filter((leg) => leg.comparisonFamily === "same_payload_parity").map((leg) => leg.legId),
      gapfill_derived_payload_parity: legs
        .filter((leg) => leg.comparisonFamily === "gapfill_derived_payload_parity")
        .map((leg) => leg.legId),
    },
    onePathFacadeParity,
    legs,
    violations,
    warnings,
    verdict: violations.length === 0 ? "MANUAL_CROSS_SURFACE_PARITY_PASS" : "MANUAL_CROSS_SURFACE_PARITY_FAIL",
  };

  const outPath =
    String(process.env.AUDIT_PROOF_OUTPUT ?? "").trim() ||
    resolve(process.cwd(), "scripts/audit/manual-cross-surface-parity-proof-output.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
  process.exit(violations.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
