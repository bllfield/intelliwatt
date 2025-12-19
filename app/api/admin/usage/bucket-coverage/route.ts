import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/admin";
import { usagePrisma } from "@/lib/db/usageClient";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail: detail ?? null }, { status });
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const m = Math.floor(n);
  return Math.max(min, Math.min(max, m));
}

function decimalishToNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function uniq<T>(arr: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function aliasesForCanonicalMonthlyBucketKey(key: string): string[] {
  const s = String(key ?? "").trim();
  // canonical keys are lowercase dayType + `.total` or HHMM-HHMM
  // kwh.m.<dayType>.<suffix>
  const m = s.match(/^kwh\.m\.(all|weekday|weekend)\.(.+)$/);
  if (!m) return [s];
  const day = m[1];
  const suffix = m[2];

  const out: string[] = [];
  out.push(`kwh.m.${day}.${suffix}`);
  out.push(`kwh.m.${day.toUpperCase()}.${suffix}`);

  if (suffix === "total") {
    out.push(`kwh.m.${day}.0000-2400`);
    out.push(`kwh.m.${day.toUpperCase()}.0000-2400`);
    out.push(`kwh.m.${day.toUpperCase()}.total`);
  }

  return uniq(out);
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const sp = req.nextUrl.searchParams;
  const homeId = String(sp.get("homeId") ?? "").trim();
  if (!homeId) return jsonError(400, "missing_homeId");

  const monthsCount = clampInt(sp.get("monthsCount") ?? "12", 1, 12, 12);

  const bucketKeysRaw: string[] = [];
  // allow repeated bucketKeys=... and/or comma-separated bucketKeys
  for (const v of sp.getAll("bucketKeys")) {
    const parts = String(v ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    bucketKeysRaw.push(...parts);
  }
  // also allow bucketKey=
  for (const v of sp.getAll("bucketKey")) {
    const parts = String(v ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    bucketKeysRaw.push(...parts);
  }

  const canonicalBucketKeys = uniq(bucketKeysRaw.filter(Boolean));
  if (canonicalBucketKeys.length === 0) return jsonError(400, "missing_bucketKeys");
  if (canonicalBucketKeys.length > 60) return jsonError(400, "bucketKeys_too_many", { max: 60 });

  // Determine the most recent months present for this home (desc), bounded by monthsCount.
  const monthGroups = await usagePrisma.homeMonthlyUsageBucket.groupBy({
    by: ["yearMonth"],
    where: { homeId },
    orderBy: { yearMonth: "desc" },
    take: monthsCount,
    _count: { yearMonth: true },
  });
  const months = monthGroups.map((g) => g.yearMonth).filter(Boolean);

  // If there are no buckets at all, still return an empty months list (fail-closed UI).
  if (months.length === 0) {
    return NextResponse.json({
      ok: true,
      homeId,
      monthsCount,
      months: [],
      bucketKeys: canonicalBucketKeys,
      cells: {},
      summary: { fullyCoveredMonths: 0, missingKeysTop: canonicalBucketKeys.slice(0, 12) },
    });
  }

  const aliasesByCanonical: Record<string, string[]> = {};
  const allQueryKeys: string[] = [];
  for (const k of canonicalBucketKeys) {
    const aliases = aliasesForCanonicalMonthlyBucketKey(k);
    aliasesByCanonical[k] = aliases;
    allQueryKeys.push(...aliases);
  }

  const rows = await usagePrisma.homeMonthlyUsageBucket.findMany({
    where: {
      homeId,
      yearMonth: { in: months },
      bucketKey: { in: uniq(allQueryKeys) },
    },
    select: { yearMonth: true, bucketKey: true, kwhTotal: true },
  });

  // Build lookup: month -> dbKey -> kwh
  const byMonthKey: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const ym = String(r.yearMonth);
    const bk = String(r.bucketKey);
    const kwh = decimalishToNumber((r as any).kwhTotal);
    if (!byMonthKey[ym]) byMonthKey[ym] = {};
    if (kwh != null) byMonthKey[ym][bk] = kwh;
  }

  const cells: Record<string, Record<string, { present: boolean; kwhTotal?: number; sourceKey?: string }>> = {};
  const missingCountByKey: Record<string, number> = {};
  let fullyCoveredMonths = 0;

  for (const ym of months) {
    cells[ym] = {};
    let monthOk = true;

    for (const canonicalKey of canonicalBucketKeys) {
      const aliases = aliasesByCanonical[canonicalKey] ?? [canonicalKey];
      const monthMap = byMonthKey[ym] ?? {};

      let found: { sourceKey: string; kwh: number } | null = null;
      for (const ak of aliases) {
        const v = monthMap[ak];
        if (typeof v === "number" && Number.isFinite(v)) {
          found = { sourceKey: ak, kwh: v };
          break;
        }
      }

      if (found) {
        cells[ym][canonicalKey] = {
          present: true,
          kwhTotal: found.kwh,
          sourceKey: found.sourceKey !== canonicalKey ? found.sourceKey : undefined,
        };
      } else {
        monthOk = false;
        missingCountByKey[canonicalKey] = (missingCountByKey[canonicalKey] ?? 0) + 1;
        cells[ym][canonicalKey] = { present: false };
      }
    }

    if (monthOk) fullyCoveredMonths += 1;
  }

  const missingKeysTop = Object.entries(missingCountByKey)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 12)
    .map(([k]) => k);

  return NextResponse.json({
    ok: true,
    homeId,
    monthsCount,
    months,
    bucketKeys: canonicalBucketKeys,
    cells,
    summary: { fullyCoveredMonths, missingKeysTop },
  });
}

