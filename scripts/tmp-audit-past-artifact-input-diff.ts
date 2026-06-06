/**
 * Read-only diff: User source-house Past artifact vs Admin test-home Past artifact.
 * FAIL CLOSED on cache miss — never allow_rebuild.
 *
 * Usage: npx tsx --require ./scripts/register-server-only-stub.cjs scripts/tmp-audit-past-artifact-input-diff.ts
 */
import { createHash } from "crypto";
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
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const SOURCE_HOUSE = process.env.AUDIT_SOURCE_HOUSE_ID || "0bbd25b6-9b8b-40ba-9382-dd85a1e1eda4";
const TEST_HOUSE = process.env.AUDIT_LAB_HOUSE_ID || "29a3d820-2593-4673-9dd6-cd161bbd7f6f";
const USER_EMAIL = process.env.AUDIT_USER_EMAIL || "bllfield32@icloud.com";
const OWNER_EMAIL = process.env.AUDIT_OWNER_EMAIL || "brian@intellipath-solutions.com";
const SOURCE_HASH =
  process.env.AUDIT_SOURCE_ARTIFACT_HASH || "Bxsq8-D9513vn5lt8LhO5A7HAIL0NE_0z5qpGtLnBpc";
const TEST_HASH =
  process.env.AUDIT_TEST_ARTIFACT_HASH || "OaBVcok_Am3aFQqxRV7pt-qcucqQ9pcB56fz4k75rOo";

async function profileFingerprint(userId: string, houseId: string) {
  const { getHomeProfileSimulatedByUserHouse } = await import("@/modules/homeProfile/repo");
  const { getApplianceProfileSimulatedByUserHouse } = await import("@/modules/applianceProfile/repo");
  const { computeSimulatedProfileFingerprint } = await import("@/lib/usage/pastWeatherInputParity");
  const [home, app] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId, houseId }),
    getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
  ]);
  return {
    home: computeSimulatedProfileFingerprint({ homeProfile: home, applianceProfileJson: null }),
    appliance: computeSimulatedProfileFingerprint({
      homeProfile: null,
      applianceProfileJson: app?.appliancesJson ?? null,
    }),
    combined: computeSimulatedProfileFingerprint({
      homeProfile: home,
      applianceProfileJson: app?.appliancesJson ?? null,
    }),
  };
}

async function loadArtifact(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  inputHash: string;
  label: string;
}) {
  const { getCachedPastDataset } = await import("@/modules/onePathSim/usageSimulator/pastCache");
  const cached = await getCachedPastDataset({
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    inputHash: args.inputHash,
  });
  if (!cached?.datasetJson) {
    throw new Error(
      `artifact cache miss (${args.label}) house=${args.houseId} hash=${args.inputHash} — read-only audit fail closed`
    );
  }
  return cached.datasetJson as Record<string, unknown>;
}

async function main() {
  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findFirst({ where: { email: USER_EMAIL }, select: { id: true } });
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (!user || !owner) throw new Error("user/owner not found");

  const [sourceScenario, testScenario] = await Promise.all([
    prisma.usageSimulatorScenario.findFirst({
      where: { userId: user.id, houseId: SOURCE_HOUSE, name: "Past (Corrected)", archivedAt: null },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.usageSimulatorScenario.findFirst({
      where: { userId: owner.id, houseId: TEST_HOUSE, name: "Past (Corrected)", archivedAt: null },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  await prisma.$disconnect();
  if (!sourceScenario || !testScenario) throw new Error("Past scenario missing");

  const [userDataset, adminDatasetAttempt, userProfiles, testProfiles, ownerSourceProfiles] = await Promise.all([
    loadArtifact({
      userId: user.id,
      houseId: SOURCE_HOUSE,
      scenarioId: sourceScenario.id,
      inputHash: SOURCE_HASH,
      label: "user_source",
    }),
    loadArtifact({
      userId: owner.id,
      houseId: TEST_HOUSE,
      scenarioId: testScenario.id,
      inputHash: TEST_HASH,
      label: "admin_test",
    }).catch(() => null),
    profileFingerprint(user.id, SOURCE_HOUSE),
    profileFingerprint(owner.id, TEST_HOUSE),
    profileFingerprint(owner.id, SOURCE_HOUSE),
  ]);

  if (!adminDatasetAttempt) {
    const { buildPastWeatherInputFingerprint } = await import("@/lib/usage/pastWeatherInputParity");
    const sourceFingerprint = buildPastWeatherInputFingerprint({ dataset: userDataset });
    const out = {
      at: new Date().toISOString(),
      sourceHouse: SOURCE_HOUSE,
      testHouse: TEST_HOUSE,
      sourceArtifactHash: SOURCE_HASH,
      testArtifactHash: TEST_HASH,
      testArtifactLoaded: false,
      profileFingerprints: {
        userSourceHouse: userProfiles.combined,
        ownerTestHome: testProfiles.combined,
        ownerSourceHouse: ownerSourceProfiles.combined,
        testMatchesUserSource: testProfiles.combined === userProfiles.combined,
      },
      sourceFingerprint,
      parityOk: false,
      violations: [
        `admin test-home artifact cache miss (hash=${TEST_HASH}) — cannot diff locally; run against prod or populate test-home cache`,
        ...(testProfiles.combined !== userProfiles.combined
          ? [`homeProfileFingerprint: user=${userProfiles.combined} admin=${testProfiles.combined}`]
          : []),
      ],
    };
    const outPath = resolve(process.cwd(), "scripts/tmp-audit-past-artifact-input-diff-output.json");
    writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    console.log("Wrote", outPath);
    process.exit(1);
  }

  const adminDataset = adminDatasetAttempt;

  const { auditPastWeatherInputParity } = await import("@/lib/usage/pastWeatherInputParity");
  const { resolvePastWeatherHouseIdFromDataset } = await import("@/lib/usage/pastVisibleWeatherReadDiagnostics");

  const parity = auditPastWeatherInputParity({
    userDataset,
    adminDataset,
    userWeatherHouseId: resolvePastWeatherHouseIdFromDataset({
      dataset: userDataset,
      fallbackHouseId: SOURCE_HOUSE,
    }),
    adminWeatherHouseId: resolvePastWeatherHouseIdFromDataset({
      dataset: adminDataset,
      fallbackHouseId: TEST_HOUSE,
    }),
    userProfileFingerprints: {
      homeProfile: userProfiles.combined,
      applianceProfile: userProfiles.appliance,
    },
    adminProfileFingerprints: {
      homeProfile: testProfiles.combined,
      applianceProfile: testProfiles.appliance,
    },
  });

  const diffFields = [
    "artifactInputHash",
    "displayTruthRevision",
    "finalizedDailyRowsHash",
    "dailyWeatherHash",
    "usageShapeProfileIdentity",
    "resolvedSimFingerprint",
    "intervalDataFingerprint",
    "usageFingerprint",
    "weatherIdentity",
    "validationKeys",
    "travelVacantFingerprint",
    "bundleC",
    "bundleB",
    "netKwhDailySum",
  ] as const;

  const fieldDiffs = diffFields.map((field) => ({
    field,
    user: parity.user[field],
    admin: parity.admin[field],
    match: JSON.stringify(parity.user[field]) === JSON.stringify(parity.admin[field]),
  }));

  const out = {
    at: new Date().toISOString(),
    sourceHouse: SOURCE_HOUSE,
    testHouse: TEST_HOUSE,
    sourceArtifactHash: SOURCE_HASH,
    testArtifactHash: TEST_HASH,
    profileFingerprints: {
      userSourceHouse: userProfiles.combined,
      ownerTestHome: testProfiles.combined,
      ownerSourceHouse: ownerSourceProfiles.combined,
      testMatchesUserSource: testProfiles.combined === userProfiles.combined,
    },
    parityOk: parity.ok,
    violations: parity.violations,
    fieldDiffs: fieldDiffs.filter((row) => !row.match),
    bundleC: { user: parity.user.bundleC, admin: parity.admin.bundleC },
    bundleB: { user: parity.user.bundleB, admin: parity.admin.bundleB },
  };

  const outPath = resolve(process.cwd(), "scripts/tmp-audit-past-artifact-input-diff-output.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
  if (!parity.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
