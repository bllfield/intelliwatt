// scripts/admin/usage-bucket-audit.ts
//
// Read-only audit of persisted monthly usage bucket keys for a given homeId.
// Usage:
//   npm run admin:usage:buckets:audit -- --homeId=<uuid> --limitMonths=12
//
// Notes:
// - Requires USAGE_DATABASE_URL in environment (or .env.local).
// - Performs read-only queries only (no writes).
//

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// @ts-ignore - tsx may not resolve @/ paths, using relative
import { usagePrisma } from "../../lib/db/usageClient";

type Args = { homeId: string | null; limitMonths: number };

function loadEnvLocalIfPresent() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  try {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex <= 0) continue;
      const key = trimmed.slice(0, equalIndex).trim();
      const rawValue = trimmed.slice(equalIndex + 1).trim();
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (key) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

function parseArgs(argv: string[]): Args {
  let homeId: string | null = null;
  let limitMonths = 12;

  for (const a of argv) {
    if (a.startsWith("--homeId=")) homeId = a.slice("--homeId=".length).trim() || null;
    if (a.startsWith("--limitMonths=")) {
      const raw = a.slice("--limitMonths=".length).trim();
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n)) limitMonths = Math.max(1, Math.min(24, Math.floor(n)));
    }
  }

  return { homeId, limitMonths };
}

function isLegacyKey(bucketKey: string): boolean {
  const k = String(bucketKey ?? "");
  return k.includes(".0000-2400") || /\.m\.(ALL|WEEKDAY|WEEKEND)\./.test(k);
}

function fmtBool(v: boolean): string {
  return v ? "yes" : "no";
}

async function main() {
  loadEnvLocalIfPresent();

  const { homeId, limitMonths } = parseArgs(process.argv.slice(2));
  if (!homeId) {
    console.error("Missing required arg: --homeId=<uuid>");
    console.error("Example: npm run admin:usage:buckets:audit -- --homeId=d8ee2a47-02f8-4e01-9c48-988ef4449214 --limitMonths=12");
    process.exit(1);
  }

  // A) Most recent months present for the home
  const recentMonthsRows = await usagePrisma.homeMonthlyUsageBucket.findMany({
    where: { homeId },
    distinct: ["yearMonth"],
    select: { yearMonth: true },
    orderBy: { yearMonth: "desc" },
    take: limitMonths,
  });
  const recentMonths = recentMonthsRows.map((r) => String(r.yearMonth));
  const mostRecentMonth = recentMonths[0] ?? null;

  // A) Distinct bucket keys summary (top 100)
  const bucketKeySummary = await usagePrisma.homeMonthlyUsageBucket.groupBy({
    by: ["bucketKey"],
    where: { homeId },
    _count: { bucketKey: true },
    _min: { yearMonth: true },
    _max: { yearMonth: true },
    orderBy: { _count: { bucketKey: "desc" } },
    take: 100,
  });

  if (!bucketKeySummary || bucketKeySummary.length === 0) {
    console.log(`No HomeMonthlyUsageBucket rows found for homeId=${homeId}`);
    return;
  }

  const legacyKeys = bucketKeySummary
    .filter((r) => isLegacyKey(String(r.bucketKey)))
    .map((r) => ({
      bucketKey: String(r.bucketKey),
      n: Number(r._count.bucketKey),
      minMonth: String(r._min.yearMonth ?? ""),
      maxMonth: String(r._max.yearMonth ?? ""),
    }));

  // C) Canonical presence check for last N months
  const canonicalKeys = [
    "kwh.m.all.total",
    "kwh.m.weekday.total",
    "kwh.m.weekend.total",
    "kwh.m.all.0700-2000",
    "kwh.m.all.2000-0700",
  ] as const;

  const canonicalRows =
    recentMonths.length > 0
      ? await usagePrisma.homeMonthlyUsageBucket.findMany({
          where: { homeId, yearMonth: { in: recentMonths }, bucketKey: { in: canonicalKeys as any } },
          select: { yearMonth: true, bucketKey: true },
        })
      : [];

  const presentByMonth = new Map<string, Set<string>>();
  for (const r of canonicalRows) {
    const ym = String(r.yearMonth);
    const key = String(r.bucketKey);
    if (!presentByMonth.has(ym)) presentByMonth.set(ym, new Set<string>());
    presentByMonth.get(ym)!.add(key);
  }

  const missingCanonicalByMonth = recentMonths.map((ym) => {
    const present = presentByMonth.get(ym) ?? new Set<string>();
    const missing = canonicalKeys.filter((k) => !present.has(k));
    return { yearMonth: ym, missing };
  });

  // D) Duplicate safety check (read-only):
  // Find any (yearMonth, bucketKey) pairs with count > 1 for that homeId.
  //
  // Note: we intentionally avoid raw SQL here to eliminate any chance of
  // SQL-injection from CLI arguments.
  const dupAgg = await usagePrisma.homeMonthlyUsageBucket.groupBy({
    by: ["yearMonth", "bucketKey"],
    where: { homeId },
    _count: { bucketKey: true },
    orderBy: [{ _count: { bucketKey: "desc" } }, { yearMonth: "desc" }, { bucketKey: "asc" }],
    take: 200,
  });
  const dupRows = dupAgg
    .filter((r) => Number(r._count.bucketKey) > 1)
    .map((r) => ({ yearMonth: String(r.yearMonth), bucketKey: String(r.bucketKey), n: Number(r._count.bucketKey) }));

  // Output
  console.log(`\n=== Usage Bucket Key Audit (read-only) ===`);
  console.log(`homeId: ${homeId}`);
  console.log(`monthsWindow: last ${limitMonths}`);
  console.log(`mostRecentMonthSeen: ${mostRecentMonth ?? "∅"}`);
  console.log(`distinctBucketKeys(top100): ${bucketKeySummary.length}`);
  console.log(`legacyKeysDetected(top100): ${legacyKeys.length}`);
  console.log(`duplicatesDetected: ${dupRows.length}`);

  console.log(`\n--- Bucket keys (top 100) ---`);
  for (const r of bucketKeySummary) {
    const key = String(r.bucketKey);
    const n = Number(r._count.bucketKey);
    const minMonth = String(r._min.yearMonth ?? "");
    const maxMonth = String(r._max.yearMonth ?? "");
    console.log(`${key}\t n=${n}\t min=${minMonth}\t max=${maxMonth}\t legacy=${fmtBool(isLegacyKey(key))}`);
  }

  console.log(`\n--- Legacy keys (detected in top 100) ---`);
  if (legacyKeys.length === 0) {
    console.log("none");
  } else {
    for (const r of legacyKeys) {
      console.log(`${r.bucketKey}\t n=${r.n}\t lastMonth=${r.maxMonth}`);
    }
  }

  console.log(`\n--- Canonical keys coverage (last ${recentMonths.length} months) ---`);
  if (recentMonths.length === 0) {
    console.log("no months found");
  } else {
    for (const m of missingCanonicalByMonth) {
      if (m.missing.length === 0) continue;
      console.log(`${m.yearMonth}\t missing=${m.missing.join(", ")}`);
    }
    const fullyCovered = missingCanonicalByMonth.filter((m) => m.missing.length === 0).length;
    console.log(`fullyCoveredMonths: ${fullyCovered}/${recentMonths.length}`);
  }

  console.log(`\n--- Duplicate rows (should be none) ---`);
  if (dupRows.length === 0) {
    console.log("none");
  } else {
    for (const r of dupRows) {
      console.log(`${r.yearMonth}\t ${r.bucketKey}\t n=${r.n}`);
    }
  }
}

main()
  .catch((e: any) => {
    console.error("Audit failed:", e?.message ?? String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await usagePrisma.$disconnect();
    } catch {
      // ignore
    }
  });

