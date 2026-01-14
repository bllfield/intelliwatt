/**
 * Purge specific test users + their houses/data directly via DB (no Vercel/admin API).
 *
 * Usage (PowerShell, repo root):
 *   # Dry-run (recommended first):
 *   node .\scripts\admin\purge-test-users.js --preset iw_test
 *
 *   # Apply (destructive):
 *   node .\scripts\admin\purge-test-users.js --preset iw_test --apply --confirm DELETE
 *
 * Or pass your own targets:
 *   node .\scripts\admin\purge-test-users.js --emails "a@b.com,c@d.com" --houseIds "uuid1,uuid2"
 *   node .\scripts\admin\purge-test-users.js --emails "a@b.com" --apply --confirm DELETE
 *
 * Requirements:
 *   - DATABASE_URL must be set (master DB)
 *   - CURRENT_PLAN_DATABASE_URL should be set if you want to purge current-plan module rows too
 */
/* eslint-disable no-console */

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

const PRESETS = {
  iw_test: {
    emails: [
      "bllfield@yahoo.com",
      "bllfield32@icloud.com",
      "bllfield32@gmail.com",
      "brian@intellipath-solutions.com",
    ],
    houseIds: [
      "a1af0c7e-c579-4785-9e7b-0e13af75eb19",
      "d8ee2a47-02f8-4e01-9c48-988ef4449214",
      "d75c9c63-78dd-40c3-9d29-e7b67861fefe",
      "77823cb9-6907-46fd-afa8-7df1064915c0",
    ],
  },
};

async function main() {
  const preset = String(argValue("--preset", "")).trim();
  const apply = argHas("--apply");
  const confirm = String(argValue("--confirm", "")).trim();
  const includeTemplates = argHas("--include-templates"); // default false

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Refusing to run.");
  }

  if (apply && confirm !== "DELETE") {
    throw new Error('Refusing to apply without explicit confirmation. Re-run with: --apply --confirm DELETE');
  }

  const presetTargets = preset && PRESETS[preset] ? PRESETS[preset] : null;
  const emails = uniq([
    ...(presetTargets?.emails ?? []),
    ...csvList(argValue("--emails", "")),
  ].map((x) => String(x).trim().toLowerCase()).filter(Boolean));
  const houseIds = uniq([
    ...(presetTargets?.houseIds ?? []),
    ...csvList(argValue("--houseIds", "")),
    ...csvList(argValue("--houseids", "")),
  ].map((x) => String(x).trim()).filter(Boolean));

  if (emails.length === 0 && houseIds.length === 0) {
    throw new Error("Provide --preset iw_test, or --emails and/or --houseIds.");
  }

  // eslint-disable-next-line global-require
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();

  // Prisma current-plan client is generated into ./.prisma/current-plan-client
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const CurrentPlanPrismaClient = process.env.CURRENT_PLAN_DATABASE_URL
    ? require("../../.prisma/current-plan-client").PrismaClient
    : null;
  const cp = CurrentPlanPrismaClient ? new CurrentPlanPrismaClient() : null;

  try {
    const users = emails.length
      ? await db.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })
      : [];
    const userIds = uniq(users.map((u) => u.id));

    const houses = await db.houseAddress.findMany({
      where: {
        OR: [
          ...(houseIds.length ? [{ id: { in: houseIds } }] : []),
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
        ],
      },
      select: { id: true, userId: true, userEmail: true, esiid: true },
    });

    const targetHouseIds = uniq(houses.map((h) => h.id));
    const targetUserIds = uniq([...userIds, ...houses.map((h) => h.userId)].filter(Boolean));
    const esiids = uniq(houses.map((h) => String(h.esiid ?? "").trim()).filter(Boolean));

    const summary = {
      preset: preset || null,
      apply,
      includeTemplates,
      inputs: { emails, houseIds },
      resolved: { users, targetUserIds, targetHouseIds, esiids },
    };

    const counts = {};
    if (targetUserIds.length) {
      counts.User = await db.user.count({ where: { id: { in: targetUserIds } } });
      counts.Session = await db.session.count({ where: { userId: { in: targetUserIds } } });
      counts.Entry = await db.entry.count({ where: { userId: { in: targetUserIds } } });
      counts.EntryExpiryDigest = await db.entryExpiryDigest.count({ where: { userId: { in: targetUserIds } } });
      counts.UserProfile = await db.userProfile.count({ where: { userId: { in: targetUserIds } } });
      counts.UsageData = await db.usageData.count({ where: { userId: { in: targetUserIds } } });
      counts.UtilityPlan = await db.utilityPlan.count({ where: { userId: { in: targetUserIds } } });
      counts.Referral = await db.referral.count({ where: { referredById: { in: targetUserIds } } });
      counts.CommissionRecord = await db.commissionRecord.count({ where: { userId: { in: targetUserIds } } });
      counts.JackpotPayout = await db.jackpotPayout.count({ where: { userId: { in: targetUserIds } } });
      counts.SmtAuthorization = await db.smtAuthorization.count({ where: { userId: { in: targetUserIds } } });
      counts.NormalizedCurrentPlan = await db.normalizedCurrentPlan.count({
        where: { userId: { in: targetUserIds }, sourceModule: "current-plan" },
      });
    }
    if (targetHouseIds.length) {
      counts.HouseAddress = await db.houseAddress.count({ where: { id: { in: targetHouseIds } } });
      counts.GreenButtonUpload = await db.greenButtonUpload.count({ where: { houseId: { in: targetHouseIds } } });
      counts.ManualUsageUpload = await db.manualUsageUpload.count({ where: { houseId: { in: targetHouseIds } } });
      counts.SmtMeterInfo = await db.smtMeterInfo.count({ where: { houseId: { in: targetHouseIds } } });
      counts.PlanEstimateMaterialized = await db.planEstimateMaterialized.count({ where: { houseAddressId: { in: targetHouseIds } } });
      counts.WattBuyApiSnapshot = await db.wattBuyApiSnapshot.count({ where: { houseAddressId: { in: targetHouseIds } } });
      counts.NormalizedCurrentPlan_byHome = await db.normalizedCurrentPlan.count({
        where: { homeId: { in: targetHouseIds }, sourceModule: "current-plan" },
      });
    }
    if (esiids.length) {
      counts.SmtInterval = await db.smtInterval.count({ where: { esiid: { in: esiids } } });
      counts.SmtBillingRead = await db.smtBillingRead.count({ where: { esiid: { in: esiids } } });
    }
    if (cp && targetUserIds.length) {
      counts.currentPlan_CurrentPlanManualEntry = await cp.currentPlanManualEntry.count({ where: { userId: { in: targetUserIds } } });
      counts.currentPlan_ParsedCurrentPlan = await cp.parsedCurrentPlan.count({ where: { userId: { in: targetUserIds } } });
      counts.currentPlan_CurrentPlanBillUpload = await cp.currentPlanBillUpload.count({ where: { userId: { in: targetUserIds } } });
      counts.currentPlan_BillPlanTemplate = includeTemplates ? await cp.billPlanTemplate.count() : undefined;
    }

    console.log(JSON.stringify({ ok: true, ...summary, counts, dryRun: !apply }, null, 2));

    if (!apply) return;

    const deleted = {};

    // Current-plan module deletes (user-scoped). Do NOT delete templates by default.
    if (cp && targetUserIds.length) {
      deleted.currentPlan_ParsedCurrentPlan = (await cp.parsedCurrentPlan.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.currentPlan_CurrentPlanManualEntry = (await cp.currentPlanManualEntry.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.currentPlan_CurrentPlanBillUpload = (await cp.currentPlanBillUpload.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      if (includeTemplates) {
        deleted.currentPlan_BillPlanTemplate = (await cp.billPlanTemplate.deleteMany({})).count;
      }
    }

    // Master DB deletes: do children first
    if (targetHouseIds.length) {
      deleted.GreenButtonUpload = (await db.greenButtonUpload.deleteMany({ where: { houseId: { in: targetHouseIds } } })).count;
      deleted.ManualUsageUpload = (await db.manualUsageUpload.deleteMany({ where: { houseId: { in: targetHouseIds } } })).count;
      deleted.WattBuyApiSnapshot = (await db.wattBuyApiSnapshot.deleteMany({ where: { houseAddressId: { in: targetHouseIds } } })).count;
      deleted.SmtMeterInfo = (await db.smtMeterInfo.deleteMany({ where: { houseId: { in: targetHouseIds } } })).count;
      deleted.PlanEstimateMaterialized = (await db.planEstimateMaterialized.deleteMany({ where: { houseAddressId: { in: targetHouseIds } } })).count;
      deleted.NormalizedCurrentPlan_byHome = (await db.normalizedCurrentPlan.deleteMany({ where: { homeId: { in: targetHouseIds }, sourceModule: "current-plan" } })).count;
    }
    if (esiids.length) {
      deleted.SmtInterval = (await db.smtInterval.deleteMany({ where: { esiid: { in: esiids } } })).count;
      deleted.SmtBillingRead = (await db.smtBillingRead.deleteMany({ where: { esiid: { in: esiids } } })).count;
    }
    if (targetUserIds.length) {
      // Entries have status logs; delete logs first to avoid FK issues.
      const entryIds = (await db.entry.findMany({ where: { userId: { in: targetUserIds } }, select: { id: true } })).map((e) => e.id);
      if (entryIds.length) {
        deleted.EntryStatusLog = (await db.entryStatusLog.deleteMany({ where: { entryId: { in: entryIds } } })).count;
      }
      deleted.EntryExpiryDigest = (await db.entryExpiryDigest.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.Session = (await db.session.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.Entry = (await db.entry.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.UsageData = (await db.usageData.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.UtilityPlan = (await db.utilityPlan.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.CommissionRecord = (await db.commissionRecord.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.JackpotPayout = (await db.jackpotPayout.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.SmtAuthorization = (await db.smtAuthorization.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.Referral = (await db.referral.deleteMany({ where: { referredById: { in: targetUserIds } } })).count;
      deleted.UserProfile = (await db.userProfile.deleteMany({ where: { userId: { in: targetUserIds } } })).count;
      deleted.NormalizedCurrentPlan = (await db.normalizedCurrentPlan.deleteMany({ where: { userId: { in: targetUserIds }, sourceModule: "current-plan" } })).count;
    }
    if (targetHouseIds.length) {
      deleted.HouseAddress = (await db.houseAddress.deleteMany({ where: { id: { in: targetHouseIds } } })).count;
    }
    if (targetUserIds.length) {
      deleted.User = (await db.user.deleteMany({ where: { id: { in: targetUserIds } } })).count;
    }

    console.log(JSON.stringify({ ok: true, deleted }, null, 2));
  } finally {
    try { await db.$disconnect(); } catch {}
    try { if (cp) await cp.$disconnect(); } catch {}
  }
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exitCode = 1;
});

