import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAdmin(req: NextRequest) {
  const token = req.headers.get("x-admin-token") || "";
  const expected = process.env.ADMIN_TOKEN || "";
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const dateStart = url.searchParams.get("dateStart");
  const dateEnd = url.searchParams.get("dateEnd");
  const status = url.searchParams.get("status");
  const tdsp = url.searchParams.get("tdsp");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

  const prisma = new PrismaClient();
  try {
    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (dateStart) {
      conditions.push(`"createdAt" >= $${idx++}::timestamptz`);
      params.push(dateStart);
    }
    if (dateEnd) {
      conditions.push(`"createdAt" < $${idx++}::timestamptz`);
      params.push(dateEnd);
    }
    if (status) {
      conditions.push(`"status" = $${idx++}`);
      params.push(status);
    }
    if (tdsp) {
      conditions.push(`"tdsp" = $${idx++}`);
      params.push(tdsp);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT *
      FROM "ErcotIngest"
      ${whereClause}
      ORDER BY COALESCE("finishedAt", "createdAt") DESC
      LIMIT $${idx}
    `;
    params.push(limit);

    const ingests = await prisma.$queryRawUnsafe<any[]>(sql, ...params).catch(() => {
      return [];
    });

    return NextResponse.json({
      ok: true,
      count: ingests.length,
      ingests,
      filters: {
        dateStart: dateStart || null,
        dateEnd: dateEnd || null,
        status: status || null,
        tdsp: tdsp || null,
        limit,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to fetch ingests" },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}

