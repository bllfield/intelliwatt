import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PrefillValue<T> = { value: T | null; source: "PREFILL" | "DEFAULT" | "UNKNOWN" };

function asNumber(v: any): number | null {
  const n = typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pickNumber(obj: any, keys: string[]): number | null {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const n = asNumber(obj?.[k]);
    if (n != null) return n;
  }
  return null;
}

function pickString(obj: any, keys: string[]): string | null {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const s = obj?.[k];
    if (typeof s === "string" && s.trim()) return s.trim();
  }
  return null;
}

async function requireUser() {
  const cookieStore = cookies();
  const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
  if (!rawEmail) return { ok: false as const, status: 401, body: { ok: false, error: "Not authenticated" } };
  const email = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { ok: false as const, status: 404, body: { ok: false, error: "User not found" } };
  return { ok: true as const, user };
}

async function resolveHouseId(userId: string, houseIdRaw: string | null): Promise<string | null> {
  const prismaAny = prisma as any;
  if (houseIdRaw && houseIdRaw.trim()) {
    const h = await prismaAny.houseAddress.findFirst({
      where: { id: houseIdRaw.trim(), userId, archivedAt: null },
      select: { id: true },
    });
    return h?.id ?? null;
  }
  const primary =
    (await prismaAny.houseAddress.findFirst({
      where: { userId, archivedAt: null, isPrimary: true },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })) ??
    (await prismaAny.houseAddress.findFirst({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }));
  return primary?.id ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const url = new URL(request.url);
    const houseId = await resolveHouseId(u.user.id, url.searchParams.get("houseId"));
    if (!houseId) return NextResponse.json({ ok: false, error: "house_required" }, { status: 400 });

    const house = await (prisma as any).houseAddress.findFirst({
      where: { id: houseId, userId: u.user.id, archivedAt: null },
      select: { id: true, rawWattbuyJson: true, tdspSlug: true, utilityName: true, isRenter: true },
    });
    if (!house) return NextResponse.json({ ok: false, error: "House not found" }, { status: 403 });

    // Defensive mapper: WattBuy payload shapes vary; only fill what we can infer.
    const wb = (house as any)?.rawWattbuyJson ?? null;
    const style = pickString(wb, ["home_style", "homeStyle", "construction", "style"]);
    const insulation = pickString(wb, ["insulation_type", "insulationType"]);
    const windowType = pickString(wb, ["window_type", "windowType"]);
    const foundation = pickString(wb, ["foundation", "foundation_type", "foundationType"]);

    const squareFeet = pickNumber(wb, ["square_feet", "squareFeet", "sqft", "sq_ft", "homeSqFt"]);
    const stories = pickNumber(wb, ["stories", "numStories"]);
    const homeAge = pickNumber(wb, ["home_age", "homeAge", "age"]);

    // Defaults
    const summerTemp: PrefillValue<number> = { value: 73, source: "DEFAULT" };
    const winterTemp: PrefillValue<number> = { value: 70, source: "DEFAULT" };

    return NextResponse.json({
      ok: true,
      houseId,
      prefill: {
        homeStyle: style ? { value: style, source: "PREFILL" } : ({ value: null, source: "UNKNOWN" } as PrefillValue<string>),
        insulationType: insulation
          ? { value: insulation, source: "PREFILL" }
          : ({ value: null, source: "UNKNOWN" } as PrefillValue<string>),
        windowType: windowType
          ? { value: windowType, source: "PREFILL" }
          : ({ value: null, source: "UNKNOWN" } as PrefillValue<string>),
        foundation: foundation
          ? { value: foundation, source: "PREFILL" }
          : ({ value: null, source: "UNKNOWN" } as PrefillValue<string>),
        squareFeet: squareFeet != null ? { value: Math.trunc(squareFeet), source: "PREFILL" } : { value: null, source: "UNKNOWN" },
        stories: stories != null ? { value: Math.max(1, Math.trunc(stories)), source: "PREFILL" } : { value: null, source: "UNKNOWN" },
        homeAge: homeAge != null ? { value: Math.max(0, Math.trunc(homeAge)), source: "PREFILL" } : { value: null, source: "UNKNOWN" },
        summerTemp,
        winterTemp,
      },
      meta: {
        tdspSlug: (house as any).tdspSlug ?? null,
        utilityName: (house as any).utilityName ?? null,
        isRenter: Boolean((house as any).isRenter),
      },
    });
  } catch (e) {
    console.error("[user/home-profile/prefill] failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

