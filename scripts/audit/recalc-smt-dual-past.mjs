/**
 * Controlled SMT dual Past recalc for One Path parity recovery (WRITES database).
 *
 * Runs source-house user Past recalc, mirrors build inputs + profiles to the lab
 * test home, then admin test-home Past recalc with the same SMT actual context.
 *
 * Guardrails — refuses to run unless ALL are set:
 *   ALLOW_PROD_PAST_RECALC=1
 *   AUDIT_USER_EMAIL
 *   AUDIT_OWNER_EMAIL (defaults to AUDIT_USER_EMAIL)
 *   AUDIT_SOURCE_HOUSE_ID
 *   AUDIT_LAB_HOUSE_ID
 *
 * Usage:
 *   ALLOW_PROD_PAST_RECALC=1 \
 *   AUDIT_USER_EMAIL=brian@intellipath-solutions.com \
 *   AUDIT_SOURCE_HOUSE_ID=<source-uuid> \
 *   AUDIT_LAB_HOUSE_ID=<lab-uuid> \
 *   npx tsx --require ./scripts/register-server-only-stub.cjs scripts/audit/recalc-smt-dual-past.mjs
 *
 * Lab home is single-occupancy: this recalc invalidates Green Button lab proof state.
 * Run SMT PROOF_AUDIT_ONLY immediately after; do not treat GB proof as valid until recalc-gb-dual-past.mjs runs again.
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
    process.exit(1);
  }
  return value;
}

function assertProdWriteAllowed() {
  const flag = String(process.env.ALLOW_PROD_PAST_RECALC ?? "").trim().toLowerCase();
  if (flag !== "1" && flag !== "true" && flag !== "yes") {
    console.error(
      "Refusing to write Past artifacts: set ALLOW_PROD_PAST_RECALC=1 with explicit house IDs before running."
    );
    process.exit(1);
  }
}

const EMAIL = requireEnv("AUDIT_USER_EMAIL");
const OWNER_EMAIL = String(process.env.AUDIT_OWNER_EMAIL ?? EMAIL).trim() || EMAIL;
const SOURCE_HOUSE = requireEnv("AUDIT_SOURCE_HOUSE_ID");
const TEST_HOUSE = requireEnv("AUDIT_LAB_HOUSE_ID");

async function main() {
  assertProdWriteAllowed();

  const { prisma } = await import("../../lib/db.ts");
  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (!user || !owner) throw new Error("user or owner missing");

  const { findPastScenarioId, ensureOnePathPastBuildInputsFromSource } = await import(
    "../../lib/usage/onePathPastUserSiteParity.ts"
  );
  const { syncOnePathMissingProfilesFromSource } = await import("../../modules/usageSimulator/labTestHome.ts");
  const { dispatchPastSimRecalc } = await import("../../modules/usageSimulator/pastSimRecalcDispatch.ts");
  const { getHouseAddressForUserHouse } = await import("../../modules/onePathSim/usageSimulator/repo.ts");
  const { getOnePathTravelRangesFromDb } = await import("../../modules/onePathSim/travelRanges.ts");
  const { resolvePastValidationPolicy } = await import("../../lib/usage/pastValidationPolicy.ts");

  const sourceScenarioId = await findPastScenarioId({ userId: user.id, houseId: SOURCE_HOUSE });
  const testScenarioId = await findPastScenarioId({ userId: owner.id, houseId: TEST_HOUSE });
  if (!sourceScenarioId || !testScenarioId) throw new Error("missing Past scenario");

  const sourceHouse = await getHouseAddressForUserHouse({ userId: user.id, houseId: SOURCE_HOUSE });
  const testHouse = await getHouseAddressForUserHouse({ userId: owner.id, houseId: TEST_HOUSE });
  const travelRanges = await getOnePathTravelRangesFromDb(user.id, SOURCE_HOUSE);
  const userValidationPolicy = resolvePastValidationPolicy({ surface: "user_site" });
  const adminValidationPolicy = resolvePastValidationPolicy({ surface: "admin_lab" });
  const correlationBase = `smt-dual-recalc-${Date.now()}`;

  const sourceRecalc = await dispatchPastSimRecalc({
    userId: user.id,
    houseId: SOURCE_HOUSE,
    esiid: sourceHouse?.esiid ?? null,
    mode: "SMT_BASELINE",
    scenarioId: sourceScenarioId,
    persistPastSimBaseline: true,
    preLockboxTravelRanges: travelRanges,
    validationDaySelectionMode: userValidationPolicy.selectionMode,
    validationDayCount: userValidationPolicy.validationDayCount,
    correlationId: `${correlationBase}-source`,
    runContext: {
      callerLabel: "user_recalc",
      buildPathKind: "recalc",
      persistRequested: true,
      preferredActualSource: "SMT",
    },
  });

  const mirror = await ensureOnePathPastBuildInputsFromSource({
    ownerUserId: owner.id,
    sourceUserId: user.id,
    sourceHouseId: SOURCE_HOUSE,
    testHomeHouseId: TEST_HOUSE,
    preferredActualSource: "SMT",
    callerLabel: "one_path_admin_past_run",
  });

  await syncOnePathMissingProfilesFromSource({
    ownerUserId: owner.id,
    sourceUserId: user.id,
    sourceHouseId: SOURCE_HOUSE,
    testHomeHouseId: TEST_HOUSE,
    overwriteExisting: true,
  });

  const testRecalc = await dispatchPastSimRecalc({
    userId: owner.id,
    houseId: TEST_HOUSE,
    esiid: sourceHouse?.esiid ?? testHouse?.esiid ?? null,
    mode: "SMT_BASELINE",
    scenarioId: testScenarioId,
    actualContextHouseId: SOURCE_HOUSE,
    persistPastSimBaseline: true,
    preLockboxTravelRanges: travelRanges,
    validationDaySelectionMode: adminValidationPolicy.selectionMode,
    validationDayCount: adminValidationPolicy.validationDayCount,
    correlationId: `${correlationBase}-test`,
    runContext: {
      callerLabel: "one_path_admin_past_run",
      buildPathKind: "recalc",
      persistRequested: true,
      preferredActualSource: "SMT",
    },
  });

  await prisma.$disconnect();

  const out = {
    at: new Date().toISOString(),
    houses: { sourceHouse: SOURCE_HOUSE, testHome: TEST_HOUSE },
    scenarios: { sourceScenarioId, testScenarioId },
    travelRangeCount: travelRanges.length,
    validationPolicy: {
      user: userValidationPolicy,
      admin: adminValidationPolicy,
    },
    sourceRecalc:
      sourceRecalc.executionMode === "inline"
        ? {
            ok: sourceRecalc.result.ok,
            artifactInputHash: sourceRecalc.result.canonicalArtifactInputHash ?? null,
            error: sourceRecalc.result.ok ? null : sourceRecalc.result.error,
          }
        : sourceRecalc,
    mirror: mirror.ok ? { ok: true, syncKind: mirror.syncKind, sourceInputHash: mirror.sourceInputHash } : mirror,
    testRecalc:
      testRecalc.executionMode === "inline"
        ? {
            ok: testRecalc.result.ok,
            artifactInputHash: testRecalc.result.canonicalArtifactInputHash ?? null,
            error: testRecalc.result.ok ? null : testRecalc.result.error,
          }
        : testRecalc,
  };

  const outPath = resolve(process.cwd(), "scripts/audit/recalc-smt-dual-past-output.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);

  const sourceOk = sourceRecalc.executionMode === "inline" && sourceRecalc.result.ok;
  const testOk = testRecalc.executionMode === "inline" && testRecalc.result.ok;
  if (!sourceOk || !testOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
