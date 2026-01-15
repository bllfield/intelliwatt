import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { usagePrisma } from "@/lib/db/usageClient";

export const dynamic = "force-dynamic";

function cleanEsiid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "").trim();
  return digits.length >= 17 ? digits : null;
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

function aliasesForTotalBucketKey(): string[] {
  // `homeMonthlyUsageBucket.bucketKey` historically had a few variants; read them all.
  return uniq([
    "kwh.m.all.total",
    "kwh.m.all.0000-2400",
    "kwh.m.ALL.total",
    "kwh.m.ALL.0000-2400",
  ]);
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const esiid = cleanEsiid(url.searchParams.get("esiid"));
  const homeIdRaw = String(url.searchParams.get("homeId") ?? "").trim();
  const homeId = homeIdRaw.length > 0 ? homeIdRaw : null;

  if (!esiid && !homeId) {
    return NextResponse.json({ ok: false, error: "esiid_or_homeId_required" }, { status: 400 });
  }

  // Resolve homeId <-> esiid if one is missing.
  const resolved = await (async () => {
    if (homeId && esiid) return { homeId, esiid };

    if (homeId && !esiid) {
      const house = await prisma.houseAddress.findFirst({
        where: { id: homeId, archivedAt: null },
        select: { esiid: true },
      });
      const e = cleanEsiid(house?.esiid ?? null);
      return { homeId, esiid: e };
    }

    // esiid only -> best-effort: find latest non-archived house with this esiid.
    const house = await prisma.houseAddress.findFirst({
      where: { esiid: esiid!, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    return { homeId: house?.id ?? null, esiid };
  })();

  if (!resolved.esiid) {
    return NextResponse.json({ ok: false, error: "esiid_not_found_for_home" }, { status: 404 });
  }

  // Use the latest ts in DB to define a strict last-365-days window (matches user/usage behavior).
  const latest = await prisma.smtInterval.findFirst({
    where: { esiid: resolved.esiid },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });

  if (!latest?.ts) {
    return NextResponse.json({
      ok: true,
      esiid: resolved.esiid,
      homeId: resolved.homeId,
      window: { latest: null, cutoff: null },
      raw: { months: [], totals: { importKwh: 0, exportKwh: 0, netKwh: 0 } },
      normalized: { months: [], totals: { kwh: 0 } },
      comparison: { months: [], totals: { rawImportKwh: 0, normalizedKwh: 0, diffKwh: 0 } },
    });
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const cutoff = new Date(latest.ts.getTime() - 365 * DAY_MS);

  const rawRows = await prisma.$queryRaw<
    Array<{ month: string; importkwh: number; exportkwh: number; netkwh: number }>
  >(Prisma.sql`
    SELECT
      to_char(
        date_trunc('month', (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'))::date,
        'YYYY-MM'
      ) AS month,
      COALESCE(SUM(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END), 0)::float AS importkwh,
      COALESCE(SUM(CASE WHEN "kwh" < 0 THEN ABS("kwh") ELSE 0 END), 0)::float AS exportkwh,
      COALESCE(SUM("kwh"), 0)::float AS netkwh
    FROM "SmtInterval"
    WHERE "esiid" = ${resolved.esiid}
      AND "ts" >= ${cutoff}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const rawTotals = rawRows.reduce(
    (acc, r) => ({
      importKwh: acc.importKwh + (Number(r.importkwh) || 0),
      exportKwh: acc.exportKwh + (Number(r.exportkwh) || 0),
      netKwh: acc.netKwh + (Number(r.netkwh) || 0),
    }),
    { importKwh: 0, exportKwh: 0, netKwh: 0 },
  );

  // Normalized/UI monthly totals: read the stored usage-bucket month totals (kwh.m.all.total).
  // Note: the customer UI uses the plan-engine "stitched month" path, which is backed by these buckets.
  const totalBucketAliases = aliasesForTotalBucketKey();
  const normalizedRows =
    resolved.homeId
      ? await usagePrisma.homeMonthlyUsageBucket.findMany({
          where: {
            homeId: resolved.homeId,
            yearMonth: { gte: String(rawRows?.[0]?.month ?? "").trim() || undefined },
            bucketKey: { in: totalBucketAliases },
          },
          select: { yearMonth: true, bucketKey: true, kwhTotal: true, computedAt: true },
        })
      : [];

  // Prefer canonical key if multiple aliases exist for same month.
  const normalizedByMonth = new Map<string, { kwh: number; bucketKey: string; computedAt: string | null }>();
  const canonical = "kwh.m.all.total";
  for (const r of normalizedRows) {
    const ym = String(r.yearMonth);
    const kwh = Number((r as any).kwhTotal?.toString?.() ?? r.kwhTotal) || 0;
    const existing = normalizedByMonth.get(ym);
    const computedAt = r.computedAt instanceof Date ? r.computedAt.toISOString() : null;
    if (!existing) {
      normalizedByMonth.set(ym, { kwh, bucketKey: String(r.bucketKey), computedAt });
      continue;
    }
    // Prefer canonical key; otherwise keep the first.
    if (existing.bucketKey !== canonical && String(r.bucketKey) === canonical) {
      normalizedByMonth.set(ym, { kwh, bucketKey: String(r.bucketKey), computedAt });
    }
  }

  const monthsUnion = uniq([
    ...rawRows.map((r) => String(r.month)),
    ...Array.from(normalizedByMonth.keys()),
  ]).sort();

  const normalizedMonths = monthsUnion
    .map((ym) => {
      const v = normalizedByMonth.get(ym);
      return v
        ? { month: ym, kwh: v.kwh, bucketKey: v.bucketKey, computedAt: v.computedAt }
        : { month: ym, kwh: null as number | null, bucketKey: null as string | null, computedAt: null as string | null };
    })
    .filter((m) => m.kwh !== null);

  const normalizedTotals = normalizedMonths.reduce((acc, r) => acc + (Number(r.kwh) || 0), 0);

  const rawByMonth = new Map<string, { importKwh: number; exportKwh: number; netKwh: number }>();
  for (const r of rawRows) {
    rawByMonth.set(String(r.month), {
      importKwh: Number(r.importkwh) || 0,
      exportKwh: Number(r.exportkwh) || 0,
      netKwh: Number(r.netkwh) || 0,
    });
  }

  const comparisonMonths = monthsUnion.map((ym) => {
    const raw = rawByMonth.get(ym) ?? null;
    const norm = normalizedByMonth.get(ym) ?? null;
    const rawImport = raw ? raw.importKwh : null;
    const normKwh = norm ? norm.kwh : null;
    const diff = rawImport != null && normKwh != null ? normKwh - rawImport : null;
    return {
      month: ym,
      raw: raw,
      normalized: norm ? { kwh: norm.kwh, bucketKey: norm.bucketKey, computedAt: norm.computedAt } : null,
      diffKwh: diff,
    };
  });

  const comparisonTotals = {
    rawImportKwh: rawTotals.importKwh,
    normalizedKwh: normalizedTotals,
    diffKwh: normalizedTotals - rawTotals.importKwh,
  };

  return NextResponse.json({
    ok: true,
    esiid: resolved.esiid,
    homeId: resolved.homeId,
    window: { latest: latest.ts.toISOString(), cutoff: cutoff.toISOString() },
    raw: {
      months: rawRows.map((r) => ({
        month: String(r.month),
        importKwh: Number(r.importkwh) || 0,
        exportKwh: Number(r.exportkwh) || 0,
        netKwh: Number(r.netkwh) || 0,
      })),
      totals: rawTotals,
    },
    normalized: {
      bucketKeyAliases: totalBucketAliases,
      months: normalizedMonths,
      totals: { kwh: normalizedTotals },
    },
    comparison: {
      months: comparisonMonths,
      totals: comparisonTotals,
    },
  });
}

