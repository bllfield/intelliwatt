import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(d: any): string | null {
  if (!d) return null;
  try {
    return new Date(d).toISOString();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const esiid = (req.nextUrl.searchParams.get("esiid") ?? "").trim();
  if (!esiid) {
    return NextResponse.json({ ok: false, error: "ESIID_REQUIRED" }, { status: 400 });
  }

  const prismaAny = prisma as any;
  const agg = await prismaAny.smtInterval.aggregate({
    where: { esiid },
    _count: { _all: true },
    _min: { ts: true },
    _max: { ts: true },
  });

  const rows = Number(agg?._count?._all ?? 0) || 0;
  const minTs = agg?._min?.ts ?? null;
  const maxTs = agg?._max?.ts ?? null;
  const daysCovered =
    minTs && maxTs
      ? Math.floor((new Date(maxTs).getTime() - new Date(minTs).getTime()) / (24 * 60 * 60 * 1000)) + 1
      : 0;

  return NextResponse.json(
    {
      ok: true,
      esiid,
      smtInterval: {
        rows,
        minTs: toIso(minTs),
        maxTs: toIso(maxTs),
        daysCovered,
      },
    },
    { status: 200 },
  );
}


