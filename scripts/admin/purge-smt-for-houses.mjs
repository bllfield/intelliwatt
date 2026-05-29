/**
 * Aggressive SMT stop for user-site GB test homes: intervals, auth, meter info, null ESIID.
 * Usage: node scripts/admin/purge-smt-for-houses.mjs --houseIds "uuid1,uuid2" --apply --confirm CLEAR
 */
import { readFileSync, existsSync } from "node:fs";
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

const apply = process.argv.includes("--apply");
const confirm = process.argv.includes("--confirm") ? process.argv[process.argv.indexOf("--confirm") + 1] : "";
const houseIds = (process.argv.find((a) => a.startsWith("--houseIds="))?.split("=")[1] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
if (houseIds.length === 0) throw new Error("Provide --houseIds=id1,id2");
if (apply && confirm !== "CLEAR") throw new Error("Use --apply --confirm CLEAR");

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

let usageDb = null;
if ((process.env.USAGE_DATABASE_URL ?? "").trim()) {
  const { PrismaClient: UsagePrismaClient } = await import("../../.prisma/usage-client/index.js");
  usageDb = new UsagePrismaClient();
}

try {
  const houses = await db.houseAddress.findMany({
    where: { id: { in: houseIds } },
    select: { id: true, userId: true, userEmail: true, esiid: true },
  });

  const esiids = [...new Set(houses.map((h) => String(h.esiid ?? "").trim()).filter(Boolean))];
  const report = { dryRun: !apply, housesBefore: houses, esiids, actions: {}, after: null };

  if (!apply) {
    for (const e of esiids) {
      report.actions[`intervals_${e}`] = await db.smtInterval.count({ where: { esiid: e } });
      report.actions[`auth_esiid_${e}`] = await db.smtAuthorization.count({ where: { esiid: e } });
    }
    for (const id of houseIds) {
      report.actions[`auth_house_${id}`] = await db.smtAuthorization.count({
        where: { OR: [{ houseAddressId: id }, { houseId: id }] },
      });
    }
  } else for (const e of esiids) {
    report.actions[`intervals_${e}`] = (await db.smtInterval.deleteMany({ where: { esiid: e } })).count;
    report.actions[`ledger_${e}`] = (await db.smtIntervalDayLedger.deleteMany({ where: { esiid: e } })).count;
    report.actions[`billing_${e}`] = (await db.smtBillingRead.deleteMany({ where: { esiid: e } })).count;
    report.actions[`auth_esiid_${e}`] = (await db.smtAuthorization.deleteMany({ where: { esiid: e } })).count;
    if (usageDb) {
      report.actions[`usageModule_${e}`] = (await usageDb.usageIntervalModule.deleteMany({ where: { esiid: e } })).count;
    }
  }

  if (apply) {
    for (const id of houseIds) {
      report.actions[`meterInfo_${id}`] = (await db.smtMeterInfo.deleteMany({ where: { houseId: id } })).count;
      report.actions[`auth_house_${id}`] = (
        await db.smtAuthorization.deleteMany({
          where: { OR: [{ houseAddressId: id }, { houseId: id }] },
        })
      ).count;
      const updated = await db.houseAddress.update({
        where: { id },
        data: { esiid: null },
        select: { id: true, userEmail: true, esiid: true },
      });
      report.actions[`nullEsiid_${id}`] = updated;
    }

    const userIds = [...new Set(houses.map((h) => h.userId))];
    report.actions.authSweep = (
      await db.smtAuthorization.deleteMany({
        where: {
          userId: { in: userIds },
          OR: [{ houseAddressId: { in: houseIds } }, { houseId: { in: houseIds } }, { esiid: { in: esiids } }],
        },
      })
    ).count;

    report.after = await db.houseAddress.findMany({
      where: { id: { in: houseIds } },
      select: {
        id: true,
        userEmail: true,
        esiid: true,
        smtAuthorizations: { where: { archivedAt: null }, select: { id: true } },
      },
    });

    for (const e of esiids) {
      report.actions[`remainingIntervals_${e}`] = await db.smtInterval.count({ where: { esiid: e } });
    }
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await db.$disconnect();
  if (usageDb) await usageDb.$disconnect();
}
