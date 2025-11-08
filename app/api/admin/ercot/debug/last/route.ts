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

  const prisma = new PrismaClient();
  try {
    // Try to find ErcotIngest or similar table - order by finishedAt, fallback to createdAt
    // Adjust table/model name based on your actual Prisma schema
    const lastIngest = await prisma.$queryRawUnsafe<any[]>(`
      SELECT *
      FROM "ErcotIngest"
      ORDER BY COALESCE("finishedAt", "createdAt") DESC
      LIMIT 1
    `).catch(() => {
      // If table doesn't exist or query fails, return empty
      return [];
    });

    if (lastIngest.length === 0) {
      return NextResponse.json({
        ok: true,
        ingest: null,
        message: "No ERCOT ingests found",
      });
    }

    return NextResponse.json({
      ok: true,
      ingest: lastIngest[0],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to fetch last ingest" },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}

