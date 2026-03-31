import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { getWeatherForRange } from "@/lib/sim/weatherProvider";

export const dynamic = "force-dynamic";

/**
 * Admin test for Open-Meteo hourly weather (simulator path).
 * GET ?lat=32.75&lon=-97.33&start=2025-01-01&end=2025-01-10
 * Returns real/cache-backed rows only. Run twice to verify second run uses cache.
 */
export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const url = new URL(req.url);
    const latParam = url.searchParams.get("lat");
    const lonParam = url.searchParams.get("lon");
    const start = String(url.searchParams.get("start") ?? "").trim().slice(0, 10);
    const end = String(url.searchParams.get("end") ?? "").trim().slice(0, 10);

    const lat = latParam != null && latParam !== "" ? Number(latParam) : NaN;
    const lon = lonParam != null && lonParam !== "" ? Number(lonParam) : NaN;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return NextResponse.json(
        { ok: false, error: "Valid lat required (-90 to 90)." },
        { status: 400 }
      );
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      return NextResponse.json(
        { ok: false, error: "Valid lon required (-180 to 180)." },
        { status: 400 }
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
      return NextResponse.json(
        { ok: false, error: "start and end must be YYYY-MM-DD with end >= start." },
        { status: 400 }
      );
    }

    const result = await getWeatherForRange(lat, lon, start, end);
    const rows = result.rows;
    const firstRow = rows[0]
      ? {
          timestampUtc: rows[0].timestampUtc instanceof Date ? rows[0].timestampUtc.toISOString() : String(rows[0].timestampUtc),
          temperatureC: rows[0].temperatureC,
          cloudcoverPct: rows[0].cloudcoverPct,
          solarRadiation: rows[0].solarRadiation,
        }
      : null;
    const lastRow = rows.length > 0
      ? (() => {
          const r = rows[rows.length - 1]!;
          return {
            timestampUtc: r.timestampUtc instanceof Date ? r.timestampUtc.toISOString() : String(r.timestampUtc),
            temperatureC: r.temperatureC,
            cloudcoverPct: r.cloudcoverPct,
            solarRadiation: r.solarRadiation,
          };
        })()
      : null;
    const sample = rows.slice(0, 5).map((r) => ({
      timestampUtc: r.timestampUtc instanceof Date ? r.timestampUtc.toISOString() : String(r.timestampUtc),
      temperatureC: r.temperatureC,
      cloudcoverPct: r.cloudcoverPct,
      solarRadiation: r.solarRadiation,
    }));

    return NextResponse.json({
      ok: true,
      fromStub: false,
      rowCount: rows.length,
      message: "Real weather (Open-Meteo/cache-backed) returned. Run again to confirm cache reuse.",
      firstRow,
      lastRow,
      sample,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
