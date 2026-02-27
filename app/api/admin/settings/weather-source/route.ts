import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { getWeatherSourceMode, setWeatherSourceMode } from "@/modules/adminSettings/repo";
import type { WeatherSourceMode } from "@/modules/adminSettings/types";

export const dynamic = "force-dynamic";

function normalizeMode(raw: unknown): WeatherSourceMode {
  const v = String(raw ?? "").trim().toUpperCase();
  return v === "REAL_API" ? "REAL_API" : "STUB";
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const mode = await getWeatherSourceMode();
    return NextResponse.json({ ok: true, mode });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const body = await req.json().catch(() => ({}));
    const mode = normalizeMode((body as any)?.mode);
    await setWeatherSourceMode(mode);
    return NextResponse.json({ ok: true, mode });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
