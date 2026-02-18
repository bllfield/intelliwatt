import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const FLAG_LANDING_SETUP_TIME_MINUTES = "public:landing_setup_time_minutes";
const DEFAULT_SETUP_TIME_MINUTES = 10;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function requireAdmin(req: NextRequest): Response | null {
  const headerToken = req.headers.get("x-admin-token");
  if (!ADMIN_TOKEN || !headerToken || headerToken !== ADMIN_TOKEN) return jsonError(401, "Unauthorized");
  return null;
}

function parseSetupTimeMinutes(raw: string | null): number {
  if (raw == null || raw === "") return DEFAULT_SETUP_TIME_MINUTES;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return DEFAULT_SETUP_TIME_MINUTES;
  return Math.max(1, Math.min(120, Math.round(n)));
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard as any;
  try {
    const row = await prisma.featureFlag.findUnique({
      where: { key: FLAG_LANDING_SETUP_TIME_MINUTES },
      select: { value: true },
    });
    const setupTimeMinutes = parseSetupTimeMinutes(row?.value ?? null);
    return NextResponse.json({ ok: true, setupTimeMinutes });
  } catch (e) {
    console.error("[landing-settings] GET error", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard as any;
  try {
    const body = await req.json().catch(() => ({}));
    const raw = body?.setupTimeMinutes;
    const setupTimeMinutes = parseSetupTimeMinutes(
      raw !== undefined && raw !== null ? String(raw) : null
    );
    await prisma.featureFlag.upsert({
      where: { key: FLAG_LANDING_SETUP_TIME_MINUTES },
      create: { key: FLAG_LANDING_SETUP_TIME_MINUTES, value: String(setupTimeMinutes) },
      update: { value: String(setupTimeMinutes) },
    });
    return NextResponse.json({ ok: true, setupTimeMinutes });
  } catch (e) {
    console.error("[landing-settings] PATCH error", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
