import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  // Read-only verification endpoint:
  // - Confirms PlanEstimateMaterialized exists in master DB and provides basic stats.
  // - Confirms WattBuy offers module DB connectivity via a lightweight query.
  try {
    const master = await (async () => {
      let hasTable = false;
      let rowCount: number | null = null;
      let latestComputedAt: string | null = null;

      try {
        const rows = (await (prisma as any).$queryRaw`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'PlanEstimateMaterialized'
          LIMIT 1
        `) as Array<{ table_name: string }>;
        hasTable = Array.isArray(rows) && rows.length > 0;
      } catch {
        hasTable = false;
      }

      if (hasTable) {
        try {
          rowCount = await (prisma as any).planEstimateMaterialized.count();
        } catch {
          rowCount = null;
        }

        try {
          const latest = await (prisma as any).planEstimateMaterialized.findFirst({
            orderBy: { computedAt: "desc" },
            select: { computedAt: true },
          });
          latestComputedAt = latest?.computedAt instanceof Date ? latest.computedAt.toISOString() : null;
        } catch {
          latestComputedAt = null;
        }
      }

      return { hasTable, rowCount, latestComputedAt };
    })();

    const offersModule = await (async () => {
      // Lightweight connectivity check.
      // Use a table that always exists in this module schema.
      let ok = false;
      let snapshotCount: number | null = null;
      try {
        snapshotCount = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.count();
        ok = true;
      } catch {
        ok = false;
        snapshotCount = null;
      }
      return { ok, snapshotCount };
    })();

    return NextResponse.json({
      ok: true,
      now: new Date().toISOString(),
      master,
      offersModule,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ? String(e.message) : String(e) }, { status: 500 });
  }
}

