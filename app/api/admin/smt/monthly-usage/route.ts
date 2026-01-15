import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

function cleanEsiid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "").trim();
  return digits.length >= 17 ? digits : null;
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const esiid = cleanEsiid(url.searchParams.get("esiid"));
  if (!esiid) {
    return NextResponse.json({ ok: false, error: "esiid_required" }, { status: 400 });
  }

  // Use the latest ts in DB to define a strict last-365-days window (matches user/usage behavior).
  const latest = await prisma.smtInterval.findFirst({
    where: { esiid },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });

  if (!latest?.ts) {
    return NextResponse.json({ ok: true, esiid, months: [], totals: { importKwh: 0, exportKwh: 0, netKwh: 0 } });
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const cutoff = new Date(latest.ts.getTime() - 365 * DAY_MS);

  const rows = await prisma.$queryRaw<
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
    WHERE "esiid" = ${esiid}
      AND "ts" >= ${cutoff}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const totals = rows.reduce(
    (acc, r) => ({
      importKwh: acc.importKwh + (Number(r.importkwh) || 0),
      exportKwh: acc.exportKwh + (Number(r.exportkwh) || 0),
      netKwh: acc.netKwh + (Number(r.netkwh) || 0),
    }),
    { importKwh: 0, exportKwh: 0, netKwh: 0 },
  );

  return NextResponse.json({
    ok: true,
    esiid,
    latest: latest.ts.toISOString(),
    cutoff: cutoff.toISOString(),
    months: rows.map((r) => ({
      month: String(r.month),
      importKwh: Number(r.importkwh) || 0,
      exportKwh: Number(r.exportkwh) || 0,
      netKwh: Number(r.netkwh) || 0,
    })),
    totals,
  });
}

