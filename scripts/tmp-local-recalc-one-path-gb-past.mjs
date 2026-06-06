/**
 * Local One Path GB Past recalc on test home using in-process pipeline (WRITES prod DB).
 * Uses local profileHouseId fixes before read-only parity proof.
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

const EMAIL = process.env.AUDIT_USER_EMAIL || "bllfield32@icloud.com";
const OWNER_EMAIL = process.env.AUDIT_OWNER_EMAIL || "brian@intellipath-solutions.com";
const SOURCE_HOUSE = process.env.AUDIT_SOURCE_HOUSE_ID || "0bbd25b6-9b8b-40ba-9382-dd85a1e1eda4";
const TEST_HOUSE = process.env.AUDIT_LAB_HOUSE_ID || "29a3d820-2593-4673-9dd6-cd161bbd7f6f";

async function main() {
  const { prisma } = await import("../lib/db.ts");
  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (!user || !owner) throw new Error("user or owner missing");

  const { findPastScenarioId, ensureOnePathPastBuildInputsFromSource } = await import(
    "../lib/usage/onePathPastUserSiteParity.ts"
  );
  const { syncOnePathMissingProfilesFromSource } = await import("../modules/usageSimulator/labTestHome.ts");
  const { dispatchPastSimRecalc } = await import("../modules/usageSimulator/pastSimRecalcDispatch.ts");
  const { getHouseAddressForUserHouse } = await import("../modules/onePathSim/usageSimulator/repo.ts");

  const sourceScenarioId = await findPastScenarioId({ userId: user.id, houseId: SOURCE_HOUSE });
  const testScenarioId = await findPastScenarioId({ userId: owner.id, houseId: TEST_HOUSE });
  if (!sourceScenarioId || !testScenarioId) throw new Error("missing Past scenario");

  const mirror = await ensureOnePathPastBuildInputsFromSource({
    ownerUserId: owner.id,
    sourceUserId: user.id,
    sourceHouseId: SOURCE_HOUSE,
    testHomeHouseId: TEST_HOUSE,
    preferredActualSource: "GREEN_BUTTON",
    callerLabel: "one_path_admin_gb_past_run",
  });

  await syncOnePathMissingProfilesFromSource({
    ownerUserId: owner.id,
    sourceUserId: user.id,
    sourceHouseId: SOURCE_HOUSE,
    testHomeHouseId: TEST_HOUSE,
    overwriteExisting: true,
  });

  const testHouse = await getHouseAddressForUserHouse({ userId: owner.id, houseId: TEST_HOUSE });
  const recalc = await dispatchPastSimRecalc({
    userId: owner.id,
    houseId: TEST_HOUSE,
    esiid: testHouse?.esiid ?? null,
    mode: "SMT_BASELINE",
    scenarioId: testScenarioId,
    actualContextHouseId: SOURCE_HOUSE,
    persistPastSimBaseline: true,
    correlationId: `local-gb-recalc-${Date.now()}`,
    runContext: {
      callerLabel: "one_path_admin_gb_past_run",
      buildPathKind: "recalc",
      persistRequested: true,
      preferredActualSource: "GREEN_BUTTON",
    },
  });

  await prisma.$disconnect();

  const out = {
    at: new Date().toISOString(),
    mirror,
    recalc: recalc.executionMode === "inline" ? recalc.result : recalc,
    sourceScenarioId,
    testScenarioId,
  };
  const outPath = resolve(process.cwd(), "scripts/tmp-local-recalc-one-path-gb-past-output.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  if (recalc.executionMode !== "inline" || !recalc.result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
