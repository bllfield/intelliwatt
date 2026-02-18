import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { normalizeEmail } from "@/lib/utils/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HomeProfileInput = {
  homeAge: number;
  homeStyle: string;
  squareFeet: number;
  stories: number;
  insulationType: string;
  windowType: string;
  foundation: string;
  ledLights: boolean;
  smartThermostat: boolean;
  summerTemp: number;
  winterTemp: number;
  occupantsWork: number;
  occupantsSchool: number;
  occupantsHomeAllDay: number;
  fuelConfiguration: string;
};

function clampInt(n: unknown, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : Number(n);
  const y = Number.isFinite(x) ? x : lo;
  return Math.max(lo, Math.min(hi, y));
}

function requireNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
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

function validate(input: any): { ok: true; value: HomeProfileInput } | { ok: false; error: string } {
  const homeAge = clampInt(input?.homeAge, 0, 200);
  const squareFeet = clampInt(input?.squareFeet, 100, 50_000);
  const stories = clampInt(input?.stories, 1, 10);
  const summerTemp = clampInt(input?.summerTemp ?? 73, 60, 90);
  const winterTemp = clampInt(input?.winterTemp ?? 70, 50, 80);
  const occupantsWork = clampInt(input?.occupantsWork, 0, 50);
  const occupantsSchool = clampInt(input?.occupantsSchool, 0, 50);
  const occupantsHomeAllDay = clampInt(input?.occupantsHomeAllDay, 0, 50);
  const occupantsTotal = occupantsWork + occupantsSchool + occupantsHomeAllDay;
  if (occupantsTotal <= 0) return { ok: false, error: "occupants_invalid" };

  const homeStyle = requireNonEmptyString(input?.homeStyle);
  const insulationType = requireNonEmptyString(input?.insulationType);
  const windowType = requireNonEmptyString(input?.windowType);
  const foundation = requireNonEmptyString(input?.foundation);
  const fuelConfiguration = requireNonEmptyString(input?.fuelConfiguration);
  if (!homeStyle) return { ok: false, error: "homeStyle_required" };
  if (!insulationType) return { ok: false, error: "insulationType_required" };
  if (!windowType) return { ok: false, error: "windowType_required" };
  if (!foundation) return { ok: false, error: "foundation_required" };
  if (!fuelConfiguration) return { ok: false, error: "fuelConfiguration_required" };

  return {
    ok: true,
    value: {
      homeAge,
      homeStyle,
      squareFeet,
      stories,
      insulationType,
      windowType,
      foundation,
      ledLights: Boolean(input?.ledLights),
      smartThermostat: Boolean(input?.smartThermostat),
      summerTemp,
      winterTemp,
      occupantsWork,
      occupantsSchool,
      occupantsHomeAllDay,
      fuelConfiguration,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const url = new URL(request.url);
    const houseId = await resolveHouseId(u.user.id, url.searchParams.get("houseId"));
    if (!houseId) return NextResponse.json({ ok: false, error: "house_required" }, { status: 400 });

    const rec = await (homeDetailsPrisma as any).homeProfileSimulated
      .findUnique({
        where: { userId_houseId: { userId: u.user.id, houseId } },
      })
      .catch(() => null);

    if (!rec) {
      return NextResponse.json({ ok: true, houseId, profile: null, updatedAt: null });
    }

    return NextResponse.json({
      ok: true,
      houseId,
      profile: {
        homeAge: rec.homeAge,
        homeStyle: rec.homeStyle,
        squareFeet: rec.squareFeet,
        stories: rec.stories,
        insulationType: rec.insulationType,
        windowType: rec.windowType,
        foundation: rec.foundation,
        ledLights: rec.ledLights,
        smartThermostat: rec.smartThermostat,
        summerTemp: rec.summerTemp,
        winterTemp: rec.winterTemp,
        occupantsWork: rec.occupantsWork,
        occupantsSchool: rec.occupantsSchool,
        occupantsHomeAllDay: rec.occupantsHomeAllDay,
        fuelConfiguration: rec.fuelConfiguration,
      } satisfies HomeProfileInput,
      provenance: rec.provenanceJson ?? null,
      prefill: rec.prefillJson ?? null,
      updatedAt: rec.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
    });
  } catch (e) {
    console.error("[user/home-profile] GET failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const body = await request.json().catch(() => ({}));
    const houseId = await resolveHouseId(u.user.id, typeof body?.houseId === "string" ? body.houseId : null);
    if (!houseId) return NextResponse.json({ ok: false, error: "house_required" }, { status: 400 });

    const v = validate(body?.profile ?? body);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

    const provenanceJson = body?.provenance ?? null;
    const prefillJson = body?.prefill ?? null;

    const rec = await (homeDetailsPrisma as any).homeProfileSimulated.upsert({
      where: { userId_houseId: { userId: u.user.id, houseId } },
      create: {
        userId: u.user.id,
        houseId,
        ...v.value,
        provenanceJson,
        prefillJson,
      },
      update: {
        ...v.value,
        provenanceJson,
        prefillJson,
      },
      select: { updatedAt: true },
    });

    return NextResponse.json({ ok: true, houseId, updatedAt: new Date(rec.updatedAt).toISOString() });
  } catch (e) {
    console.error("[user/home-profile] POST failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

