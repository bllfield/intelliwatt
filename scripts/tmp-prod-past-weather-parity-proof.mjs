/**
 * Read-only production Past weather cross-surface parity proof.
 * FAIL CLOSED — no allow_rebuild on proof legs, no production writes from this script.
 *
 * Usage:
 *   npx tsx --require ./scripts/register-server-only-stub.cjs scripts/tmp-prod-past-weather-parity-proof.mjs
 *
 * Cache-safe acceptance capture (no prod HTTP leg):
 *   PROOF_AUDIT_ONLY=1 npx tsx --require ./scripts/register-server-only-stub.cjs scripts/tmp-prod-past-weather-parity-proof.mjs
 *
 * Lab home is single-occupancy by source family — run the matching dual recalc first:
 *   Green Button: scripts/audit/recalc-gb-dual-past.mjs
 *   SMT:          scripts/audit/recalc-smt-dual-past.mjs
 *
 * Set AUDIT_PROOF_SOURCE_TYPE=SMT|GREEN_BUTTON (defaults from source house committed usage).
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

const PROOF_AUDIT_ONLY =
  process.env.PROOF_AUDIT_ONLY === "1" ||
  process.env.PROOF_AUDIT_ONLY === "true" ||
  process.env.PROOF_AUDIT_ONLY === "yes";
const BASE = process.env.BASE_URL || "https://intelliwatt.com";
const TOKEN = process.env.ADMIN_TOKEN || "";
const EMAIL = process.env.AUDIT_USER_EMAIL || "bllfield32@icloud.com";
const SOURCE_HOUSE = process.env.AUDIT_SOURCE_HOUSE_ID || "0bbd25b6-9b8b-40ba-9382-dd85a1e1eda4";
const TEST_HOUSE = process.env.AUDIT_LAB_HOUSE_ID || "29a3d820-2593-4673-9dd6-cd161bbd7f6f";
const OWNER_EMAIL = process.env.AUDIT_OWNER_EMAIL || "brian@intellipath-solutions.com";
const PROOF_SOURCE_TYPE_RAW = String(process.env.AUDIT_PROOF_SOURCE_TYPE ?? "").trim().toUpperCase();

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

async function main() {
  if (!PROOF_AUDIT_ONLY && !TOKEN) {
    console.error("ADMIN_TOKEN missing (set PROOF_AUDIT_ONLY=1 for cache-safe audit-only proof)");
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

  let proofSourceType = null;
  if (PROOF_SOURCE_TYPE_RAW === "SMT" || PROOF_SOURCE_TYPE_RAW === "GREEN_BUTTON") {
    proofSourceType = PROOF_SOURCE_TYPE_RAW;
  } else if (user && SOURCE_HOUSE) {
    const { getHouseAddressForUserHouse } = await import("../modules/onePathSim/usageSimulator/repo.ts");
    const { resolveHouseCommittedUsageSource } = await import("../lib/usage/houseCommittedUsageSource.ts");
    const sourceHouse = await getHouseAddressForUserHouse({ userId: user.id, houseId: SOURCE_HOUSE }).catch(() => null);
    const committed = await resolveHouseCommittedUsageSource({
      houseId: SOURCE_HOUSE,
      userId: user.id,
      esiid: sourceHouse?.esiid ?? null,
    });
    if (committed === "SMT" || committed === "GREEN_BUTTON") proofSourceType = committed;
  }

  let labArtifactSourceFamily = null;
  let staleLabHomeMessage = null;
  if (testPast?.id) {
    const { getLatestCachedPastDatasetByScenario } = await import(
      "../modules/onePathSim/usageSimulator/pastCache.ts"
    );
    const {
      detectPastArtifactSourceFamilyFromDataset,
      buildStaleLabHomeSourceFamilyMessage,
      LAB_HOME_SINGLE_OCCUPANCY_OPS_NOTE,
    } = await import("../lib/usage/labHomePastArtifactSourceFamily.ts");
    const labCached = await getLatestCachedPastDatasetByScenario({
      houseId: TEST_HOUSE,
      scenarioId: testPast.id,
    });
    labArtifactSourceFamily = detectPastArtifactSourceFamilyFromDataset(
      labCached?.datasetJson ?? null
    );
    if (
      proofSourceType &&
      labArtifactSourceFamily &&
      proofSourceType !== labArtifactSourceFamily
    ) {
      staleLabHomeMessage = buildStaleLabHomeSourceFamilyMessage({
        proofSourceType,
        labArtifactSourceFamily,
      });
    }
  }

  await prisma.$disconnect();

  let crossSurface = null;
  if (!staleLabHomeMessage && user && owner && sourcePast?.id && testPast?.id) {
    const { auditPastWeatherCrossSurfaceParity } = await import(
      "../lib/usage/pastWeatherCrossSurfaceParity.server.ts"
    );
    crossSurface = await auditPastWeatherCrossSurfaceParity({
      sourceUserId: user.id,
      sourceHouseId: SOURCE_HOUSE,
      sourceScenarioId: sourcePast.id,
      adminDataset: {},
      adminUserId: owner.id,
      adminHouseId: TEST_HOUSE,
      adminScenarioId: testPast.id,
    });
  }

  const acceptanceProof = crossSurface?.acceptanceProof ?? null;

  let adminRun = { status: null, json: null };
  if (!PROOF_AUDIT_ONLY) {
    adminRun = await adminPost({
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
  }

  const adminMeta = pickMeta(adminRun.json ?? {});
  const adminDiag = adminRun.json?.pastWeatherDiagnostics ?? {};
  const adminBundleC =
    scoreCard(adminMeta.pastDisplayWeatherSensitivityScore) ??
    (acceptanceProof ? scoreCard(acceptanceProof.admin.bundleC) : null);
  const adminTop =
    scoreCard(adminRun.json?.weatherSensitivityScore ?? adminDiag.visibleWeatherScore) ?? adminBundleC;
  const adminAudit = adminMeta.pastDisplayWeatherScoringAudit ?? adminRun.json?.weatherScoringAudit ?? null;

  const { LAB_HOME_SINGLE_OCCUPANCY_OPS_NOTE } = await import("../lib/usage/labHomePastArtifactSourceFamily.ts");

  const out = {
    at: new Date().toISOString(),
    proofMode: PROOF_AUDIT_ONLY ? "audit_only" : "audit_then_admin_http",
    base: BASE,
    houses: { sourceHouse: SOURCE_HOUSE, testHome: TEST_HOUSE },
    proofSourceType,
    labArtifactSourceFamily,
    labHomeOpsNote: LAB_HOME_SINGLE_OCCUPANCY_OPS_NOTE,
    staleLabHomeSourceFamily: staleLabHomeMessage,
    scenarios: { sourcePastScenarioId: sourcePast?.id ?? null, testPastScenarioId: testPast?.id ?? null },
    userPast: acceptanceProof
      ? {
          bundleC: acceptanceProof.user.bundleC,
          visibleEqualsBundleC: acceptanceProof.userVisibleEqualsUserBundleC,
        }
      : null,
    adminPast: PROOF_AUDIT_ONLY
      ? acceptanceProof
        ? {
            bundleC: acceptanceProof.admin.bundleC,
            visibleEqualsBundleC: acceptanceProof.adminVisibleEqualsAdminBundleC,
            source: "cross_surface_finalize",
          }
        : null
      : {
          httpStatus: adminRun.status,
          ok: adminRun.json?.ok,
          weatherReadPath: adminRun.json?.weatherReadPath ?? adminDiag.weatherReadPath ?? null,
          weatherCardsSourceOwner: adminRun.json?.weatherCardsSourceOwner ?? adminDiag.weatherCardsSourceOwner ?? null,
          actualContextHouseId: adminDiag.actualContextHouseId ?? adminMeta.actualContextHouseId ?? null,
          weatherHouseId: adminDiag.weatherHouseId ?? null,
          topLevel: adminTop,
          bundleC: adminBundleC,
          visibleEqualsBundleC: acceptanceProof?.adminVisibleEqualsAdminBundleC ?? null,
          audit: adminAudit
            ? {
                scorerModule: adminAudit.scorerModule,
                scoringContext: adminAudit.scoringContext,
                scoreVersion: adminAudit.scoreVersion,
                calculationVersion: adminAudit.calculationVersion,
                outputField: adminAudit.outputField,
              }
            : null,
          netKwh: adminRun.json?.runDisplayView?.summary?.totals?.netKwh ?? null,
        },
    pastWeatherCrossSurfaceParity: crossSurface
      ? {
          ok: crossSurface.ok,
          violations: crossSurface.violations,
          sourceArtifactLoaded: crossSurface.sourceArtifactLoaded,
          sourceArtifactInputHash: crossSurface.sourceArtifactInputHash,
          acceptanceProof,
        }
      : null,
    verdict: staleLabHomeMessage
      ? "STALE_LAB_HOME_SOURCE_FAMILY"
      : crossSurface?.ok === true && acceptanceProof?.ok === true
        ? "PROD_WEATHER_PARITY_PASS"
        : "PROD_WEATHER_PARITY_FAIL",
  };

  const outPath = resolve(process.cwd(), "scripts/tmp-prod-past-weather-parity-proof-output.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);

  if (out.verdict === "STALE_LAB_HOME_SOURCE_FAMILY") {
    console.error(staleLabHomeMessage);
    console.error(LAB_HOME_SINGLE_OCCUPANCY_OPS_NOTE);
    process.exit(2);
  }
  if (out.verdict !== "PROD_WEATHER_PARITY_PASS") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
