/**
 * Clear usage + sim artifacts for specific homes (keeps User + HouseAddress).
 *
 * Dry-run (default):
 *   node scripts/admin/clear-house-usage.js --emails "a@b.com" --houseIds "uuid1,uuid2"
 *
 * Apply:
 *   node scripts/admin/clear-house-usage.js --emails "a@b.com" --houseIds "uuid1" --apply --confirm CLEAR
 */
/* eslint-disable no-console */

const { readFileSync, existsSync } = require("node:fs");
const { resolve } = require("node:path");
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

function argHas(flag) {
  return process.argv.includes(flag);
}
function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return fallback;
  const next = process.argv[idx + 1];
  return next ? next : fallback;
}
function csvList(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function uniq(xs) {
  return Array.from(new Set(xs));
}

async function countSafe(fn) {
  try {
    return await fn();
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

async function deleteSafe(label, fn) {
  try {
    const result = await fn();
    const count = typeof result?.count === "number" ? result.count : 0;
    return { label, count };
  } catch (e) {
    return { label, error: String(e?.message ?? e) };
  }
}

async function clearUsageForHouse(db, usageDb, house, options) {
  const houseId = String(house.id).trim();
  const userId = String(house.userId).trim();
  const esiid = typeof house.esiid === "string" && house.esiid.trim() ? house.esiid.trim() : null;
  const summary = { houseId, userId, email: house.userEmail ?? null, esiid, counts: {}, deleted: {} };

  const count = async (label, fn) => {
    summary.counts[label] = await countSafe(fn);
  };

  await count("usageSimulatorBuild", () => db.usageSimulatorBuild.count({ where: { userId, houseId } }));
  await count("usageSimulatorScenario", () => db.usageSimulatorScenario.count({ where: { userId, houseId } }));
  await count("manualUsageInput", () => db.manualUsageInput.count({ where: { userId, houseId } }));
  await count("manualUsageUpload", () => db.manualUsageUpload.count({ where: { houseId } }));
  await count("greenButtonUpload", () => db.greenButtonUpload.count({ where: { houseId } }));
  if (esiid) {
    await count("smtInterval", () => db.smtInterval.count({ where: { esiid } }));
    await count("smtIntervalDayLedger", () => db.smtIntervalDayLedger.count({ where: { esiid } }));
    await count("smtBillingRead", () => db.smtBillingRead.count({ where: { esiid } }));
  }
  await count("smtMeterInfo", () => db.smtMeterInfo.count({ where: { houseId } }));
  await count("planEstimateMaterialized", () =>
    db.planEstimateMaterialized.count({ where: { houseAddressId: houseId } }),
  );
  await count("homeSavingsSnapshot", () => db.homeSavingsSnapshot.count({ where: { houseAddressId: houseId } }));
  await count("houseDailyWeather", () => db.houseDailyWeather.count({ where: { houseId } }));
  await count("simulationDataAlert", () => db.simulationDataAlert.count({ where: { houseId } }));
  if (options.clearSmtAuth) {
    await count("smtAuthorization", () => db.smtAuthorization.count({ where: { houseAddressId: houseId } }));
  }

  if (usageDb) {
    await count("usage.greenButtonInterval", () => usageDb.greenButtonInterval.count({ where: { homeId: houseId } }));
    await count("usage.rawGreenButton", () => usageDb.rawGreenButton.count({ where: { homeId: houseId } }));
    await count("usage.homeMonthlyUsageBucket", () =>
      usageDb.homeMonthlyUsageBucket.count({ where: { homeId: houseId } }),
    );
    await count("usage.homeDailyUsageBucket", () => usageDb.homeDailyUsageBucket.count({ where: { homeId: houseId } }));
    await count("usage.homeSimulatedUsageBucket", () =>
      usageDb.homeSimulatedUsageBucket.count({ where: { homeId: houseId } }),
    );
    await count("usage.intervalSeries", () => usageDb.intervalSeries.count({ where: { houseId } }));
    await count("usage.usageShapeProfile", () => usageDb.usageShapeProfile.count({ where: { houseId } }));
    await count("usage.wholeHomeFingerprint", () => usageDb.wholeHomeFingerprint.count({ where: { houseId } }));
    await count("usage.usageFingerprint", () => usageDb.usageFingerprint.count({ where: { houseId } }));
    await count("usage.pastSimulatedDatasetCache", () =>
      usageDb.pastSimulatedDatasetCache.count({ where: { houseId } }),
    );
    await count("usage.gapfillCompareRunSnapshot", () =>
      usageDb.gapfillCompareRunSnapshot.count({ where: { houseId } }),
    );
    if (esiid) {
      await count("usage.usageIntervalModule", () => usageDb.usageIntervalModule.count({ where: { esiid } }));
    }
  }

  if (!options.apply) return summary;

  const manualUploadIds = (
    await db.manualUsageUpload.findMany({ where: { houseId }, select: { id: true } })
  ).map((r) => r.id);
  if (manualUploadIds.length) {
    summary.deleted.entryManualUsageUnlink = (
      await db.entry.updateMany({
        where: { manualUsageId: { in: manualUploadIds } },
        data: { manualUsageId: null },
      })
    ).count;
  }

  const scenarioIds = (
    await db.usageSimulatorScenario.findMany({ where: { userId, houseId }, select: { id: true } })
  ).map((r) => r.id);
  if (scenarioIds.length) {
    summary.deleted.usageSimulatorScenarioEvent = (
      await deleteSafe("usageSimulatorScenarioEvent", () =>
        db.usageSimulatorScenarioEvent.deleteMany({ where: { scenarioId: { in: scenarioIds } } }),
      )
    ).count;
  }

  const masterDeletes = [
    ["usageSimulatorBuild", () => db.usageSimulatorBuild.deleteMany({ where: { userId, houseId } })],
    ["usageSimulatorScenario", () => db.usageSimulatorScenario.deleteMany({ where: { userId, houseId } })],
    ["manualUsageInput", () => db.manualUsageInput.deleteMany({ where: { userId, houseId } })],
    ["manualUsageUpload", () => db.manualUsageUpload.deleteMany({ where: { houseId } })],
    ["greenButtonUpload", () => db.greenButtonUpload.deleteMany({ where: { houseId } })],
    ["smtMeterInfo", () => db.smtMeterInfo.deleteMany({ where: { houseId } })],
    ["planEstimateMaterialized", () => db.planEstimateMaterialized.deleteMany({ where: { houseAddressId: houseId } })],
    ["homeSavingsSnapshot", () => db.homeSavingsSnapshot.deleteMany({ where: { houseAddressId: houseId } })],
    ["houseDailyWeather", () => db.houseDailyWeather.deleteMany({ where: { houseId } })],
    ["simulationDataAlert", () => db.simulationDataAlert.deleteMany({ where: { houseId } })],
  ];
  if (esiid) {
    masterDeletes.push(
      ["smtInterval", () => db.smtInterval.deleteMany({ where: { esiid } })],
      ["smtIntervalDayLedger", () => db.smtIntervalDayLedger.deleteMany({ where: { esiid } })],
      ["smtBillingRead", () => db.smtBillingRead.deleteMany({ where: { esiid } })],
    );
  }
  if (options.clearSmtAuth) {
    masterDeletes.push(["smtAuthorization", () => db.smtAuthorization.deleteMany({ where: { houseAddressId: houseId } })]);
  }

  for (const [label, fn] of masterDeletes) {
    const r = await deleteSafe(label, fn);
    summary.deleted[label] = r.count ?? r.error;
  }

  if (usageDb) {
    const seriesIds = (
      await usageDb.intervalSeries.findMany({ where: { houseId }, select: { id: true } })
    ).map((r) => r.id);
    if (seriesIds.length) {
      summary.deleted.intervalPoint15m = (
        await deleteSafe("intervalPoint15m", () =>
          usageDb.intervalPoint15m.deleteMany({ where: { seriesId: { in: seriesIds } } }),
        )
      ).count;
    }
    const usageDeletes = [
      ["greenButtonInterval", () => usageDb.greenButtonInterval.deleteMany({ where: { homeId: houseId } })],
      ["rawGreenButton", () => usageDb.rawGreenButton.deleteMany({ where: { homeId: houseId } })],
      ["homeMonthlyUsageBucket", () => usageDb.homeMonthlyUsageBucket.deleteMany({ where: { homeId: houseId } })],
      ["homeDailyUsageBucket", () => usageDb.homeDailyUsageBucket.deleteMany({ where: { homeId: houseId } })],
      ["homeSimulatedUsageBucket", () => usageDb.homeSimulatedUsageBucket.deleteMany({ where: { homeId: houseId } })],
      ["intervalSeries", () => usageDb.intervalSeries.deleteMany({ where: { houseId } })],
      ["usageShapeProfile", () => usageDb.usageShapeProfile.deleteMany({ where: { houseId } })],
      ["wholeHomeFingerprint", () => usageDb.wholeHomeFingerprint.deleteMany({ where: { houseId } })],
      ["usageFingerprint", () => usageDb.usageFingerprint.deleteMany({ where: { houseId } })],
      ["pastSimulatedDatasetCache", () => usageDb.pastSimulatedDatasetCache.deleteMany({ where: { houseId } })],
      ["gapfillCompareRunSnapshot", () => usageDb.gapfillCompareRunSnapshot.deleteMany({ where: { houseId } })],
    ];
    if (esiid) {
      usageDeletes.push(["usageIntervalModule", () => usageDb.usageIntervalModule.deleteMany({ where: { esiid } })]);
    }
    for (const [label, fn] of usageDeletes) {
      const r = await deleteSafe(`usage.${label}`, fn);
      summary.deleted[`usage.${label}`] = r.count ?? r.error;
    }
  }

  return summary;
}

async function main() {
  const apply = argHas("--apply");
  const confirm = String(argValue("--confirm", "")).trim();
  const clearSmtAuth = argHas("--clear-smt-auth");
  const emails = uniq(csvList(argValue("--emails", "")).map((x) => x.toLowerCase()));
  const houseIds = uniq(csvList(argValue("--houseIds", "")).concat(csvList(argValue("--houseids", ""))));

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Refusing to run.");
  }
  if (apply && confirm !== "CLEAR") {
    throw new Error('Refusing to apply without explicit confirmation. Re-run with: --apply --confirm CLEAR');
  }
  if (emails.length === 0 && houseIds.length === 0) {
    throw new Error("Provide --emails and/or --houseIds.");
  }

  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();

  let usageDb = null;
  if ((process.env.USAGE_DATABASE_URL ?? "").trim()) {
    try {
      const { PrismaClient: UsagePrismaClient } = require("../../.prisma/usage-client");
      usageDb = new UsagePrismaClient();
    } catch (e) {
      console.warn("[clear-house-usage] usage DB client unavailable:", e?.message ?? e);
    }
  } else {
    console.warn("[clear-house-usage] USAGE_DATABASE_URL not set; skipping usage-module DB deletes.");
  }

  try {
    const users =
      emails.length > 0
        ? await db.user.findMany({
            where: { email: { in: emails } },
            select: { id: true, email: true },
          })
        : [];
    const userIds = uniq(users.map((u) => u.id));

    const houses = await db.houseAddress.findMany({
      where: {
        archivedAt: null,
        OR: [
          ...(houseIds.length ? [{ id: { in: houseIds } }] : []),
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
        ],
      },
      select: {
        id: true,
        userId: true,
        userEmail: true,
        esiid: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
      },
    });

    const targetHouses = houseIds.length ? houses.filter((h) => houseIds.includes(h.id)) : houses;
    if (houseIds.length) {
      const found = new Set(targetHouses.map((h) => h.id));
      const missing = houseIds.filter((id) => !found.has(id));
      if (missing.length) {
        throw new Error(`House id(s) not found or archived: ${missing.join(", ")}`);
      }
    }

    const results = [];
    for (const house of targetHouses) {
      results.push(
        await clearUsageForHouse(db, usageDb, house, { apply, clearSmtAuth }),
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: !apply,
          clearSmtAuth,
          inputs: { emails, houseIds },
          housesResolved: targetHouses.length,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await db.$disconnect();
    } catch {}
    try {
      if (usageDb) await usageDb.$disconnect();
    } catch {}
  }
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exitCode = 1;
});
