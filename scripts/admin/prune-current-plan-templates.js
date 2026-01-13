/**
 * Prune non-computable current-plan BillPlanTemplate rows directly via DB (no Vercel / preview auth).
 *
 * Usage (PowerShell, repo root):
 *   node .\scripts\admin\prune-current-plan-templates.js
 *   node .\scripts\admin\prune-current-plan-templates.js --apply
 *
 * Requirements:
 *   - CURRENT_PLAN_DATABASE_URL must be set in your environment (or in your local .env.local, if you load it yourself).
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

function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}
function asUpper(x) {
  return String(x ?? "").trim().toUpperCase();
}
function isValidTouTier(t) {
  const start = typeof t?.start === "string" ? t.start.trim() : "";
  const end = typeof t?.end === "string" ? t.end.trim() : "";
  const cents = typeof t?.cents === "number" && Number.isFinite(t.cents) ? t.cents : null;
  return Boolean(start && end && cents != null);
}
function isValidEnergyTier(t) {
  const cents = typeof t?.rateCentsPerKwh === "number" && Number.isFinite(t.rateCentsPerKwh) ? t.rateCentsPerKwh : null;
  return cents != null && cents > 0 && cents < 500;
}

async function main() {
  const apply = argHas("--apply");
  const limitRaw = Number(argValue("--limit", "2000"));
  const limit = Math.max(1, Math.min(5000, Number.isFinite(limitRaw) ? limitRaw : 2000));

  if (!process.env.CURRENT_PLAN_DATABASE_URL) {
    throw new Error("CURRENT_PLAN_DATABASE_URL is not set. Refusing to run.");
  }

  // Prisma current-plan client is generated into ./.prisma/current-plan-client
  // (see prisma/current-plan/schema.prisma generator output).
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { PrismaClient } = require("../../.prisma/current-plan-client");
  const db = new PrismaClient();

  try {
    const rows = await db.billPlanTemplate.findMany({
      take: limit,
      orderBy: { updatedAt: "desc" },
    });

    const bad = (rows ?? []).filter((t) => {
      const providerKey = String(t?.providerNameKey ?? "").trim();
      const planKey = String(t?.planNameKey ?? "").trim();
      if (!providerKey || !planKey) return true;

      const rt = asUpper(t?.rateType);
      if (rt === "TIME_OF_USE") {
        const tiers = Array.isArray(t?.timeOfUseConfigJson) ? t.timeOfUseConfigJson : [];
        if (tiers.length === 0) return true;
        if (!tiers.some((x) => isValidTouTier(x))) return true;
        return false;
      }

      if (rt === "FIXED" || rt === "VARIABLE") {
        const tiers = Array.isArray(t?.energyRateTiersJson) ? t.energyRateTiersJson : [];
        if (tiers.length === 0) return true;
        if (!tiers.some((x) => isValidEnergyTier(x))) return true;
        return false;
      }

      if (!isNonEmptyString(t?.rateType)) return true;
      return true;
    });

    const ids = bad.map((t) => String(t.id));

    console.log(JSON.stringify({
      ok: true,
      dryRun: !apply,
      scanned: (rows ?? []).length,
      wouldDelete: ids.length,
      preview: bad.slice(0, 25).map((t) => ({
        id: String(t.id),
        providerNameKey: String(t.providerNameKey ?? ""),
        planNameKey: String(t.planNameKey ?? ""),
        providerName: t.providerName ?? null,
        planName: t.planName ?? null,
        rateType: t.rateType ?? null,
        updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : null,
      })),
    }, null, 2));

    if (apply && ids.length > 0) {
      const r = await db.billPlanTemplate.deleteMany({ where: { id: { in: ids } } });
      console.log(JSON.stringify({ deleted: r?.count ?? null }, null, 2));
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exitCode = 1;
});

