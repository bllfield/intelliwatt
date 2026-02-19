import { NextRequest, NextResponse } from "next/server";
import { getUpgradesPrisma } from "@/lib/db/upgradesClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function formatUpgradesDbError(e: any): string {
  const msg = typeof e?.message === "string" ? e.message : String(e ?? "");
  if (/UPGRADES_DATABASE_URL/i.test(msg)) return "upgrades_db_missing_env";
  if (/P1001/i.test(msg)) return "upgrades_db_unreachable";
  const code = (e as any)?.code ?? (e as any)?.errorCode;
  if (typeof code === "string") return `upgrades_db_error_${code}`;
  return "upgrades_db_error";
}

export async function GET(req: NextRequest) {
  if (!ADMIN_TOKEN) return NextResponse.json({ ok: false, error: "ADMIN_TOKEN not configured" }, { status: 500 });
  const headerToken = req.headers.get("x-admin-token");
  if (!headerToken || headerToken !== ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getUpgradesPrisma();
    const rows = await (db as any).upgradeLedger.findMany({
      where: { upgradeType: "WINDOW_REPLACEMENT", status: "ACTIVE" },
      select: {
        userId: true,
        houseId: true,
        quantity: true,
        units: true,
        deltaKwhAnnualMeasured: true,
        deltaKwhAnnualSimulated: true,
      },
    });

    const totalUsers = new Set(rows.map((r: any) => r.userId)).size;
    const totalHouses = new Set(rows.map((r: any) => r.houseId).filter(Boolean)).size;
    const totalWindowActions = rows.length;
    const windowRows = rows.filter((r: any) => r.units === "windows" && r.quantity != null);
    const totalWindowsQty = windowRows.reduce((sum: number, r: any) => sum + (Number(r.quantity) || 0), 0);
    const avgWindowsPerAction = totalWindowActions ? totalWindowsQty / totalWindowActions : 0;
    const measured = rows.map((r: any) => r.deltaKwhAnnualMeasured).filter((v: any) => v != null && Number.isFinite(v));
    const simulated = rows.map((r: any) => r.deltaKwhAnnualSimulated).filter((v: any) => v != null && Number.isFinite(v));
    const avgDeltaKwhAnnualMeasured = measured.length ? measured.reduce((a: number, b: number) => a + b, 0) / measured.length : null;
    const avgDeltaKwhAnnualSimulated = simulated.length ? simulated.reduce((a: number, b: number) => a + b, 0) / simulated.length : null;

    return NextResponse.json({
      ok: true,
      totalUsers,
      totalHouses,
      totalWindowActions,
      totalWindowsQty,
      avgWindowsPerAction,
      avgDeltaKwhAnnualMeasured,
      avgDeltaKwhAnnualSimulated,
    });
  } catch (e: any) {
    console.error("[admin/upgrade-analytics/window-replacement] failed", e);
    const errCode = formatUpgradesDbError(e);
    return NextResponse.json({ ok: false, error: errCode, message: e?.message }, { status: 503 });
  }
}
