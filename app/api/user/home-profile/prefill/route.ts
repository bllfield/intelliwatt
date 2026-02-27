import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";
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

function asObjectRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function normalizeWattbuyPayload(raw: unknown): Record<string, unknown> | null {
  const obj = asObjectRecord(raw);
  if (!obj) return null;
  if (obj.housing_chars || obj.housingChars) return obj;
  const nested = asObjectRecord(obj.data) ?? asObjectRecord(obj.payloadJson) ?? asObjectRecord(obj.payload);
  if (nested && (nested.housing_chars || nested.housingChars)) return nested;
  return obj;
}

function parseWattbuyBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (["true", "t", "yes", "y", "1"].includes(s)) return true;
  if (["false", "f", "no", "n", "0"].includes(s)) return false;
  return null;
}

function mapHouseTypeToHomeStyle(v: unknown): "brick" | "wood" | "stucco" | "metal" | "manufactured" | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!s) return null;
  if (s.includes("manufactured") || s.includes("mobile")) return "manufactured";
  if (s.includes("brick")) return "brick";
  if (s.includes("stucco")) return "stucco";
  if (s.includes("metal")) return "metal";
  if (s.includes("wood") || s.includes("frame")) return "wood";
  return null;
}

function mapInsulationType(v: unknown): "fiberglass" | "open_cell_spray_foam" | "closed_cell_spray_foam" | "mineral_wool" | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!s) return null;
  if (s.includes("open") && s.includes("cell")) return "open_cell_spray_foam";
  if (s.includes("closed") && s.includes("cell")) return "closed_cell_spray_foam";
  if (s.includes("mineral") || s.includes("rockwool") || s.includes("rock wool")) return "mineral_wool";
  if (s.includes("fiberglass") || s.includes("fibreglass")) return "fiberglass";
  return null;
}

function mapWindowType(v: unknown): "single_pane" | "double_pane" | "triple_pane" | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!s) return null;
  if (s.includes("triple")) return "triple_pane";
  if (s.includes("double")) return "double_pane";
  if (s.includes("single")) return "single_pane";
  return null;
}

function mapFoundationType(v: unknown): "slab" | "crawlspace" | "basement" | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!s) return null;
  if (s.includes("crawl")) return "crawlspace";
  if (s.includes("basement")) return "basement";
  if (s.includes("slab")) return "slab";
  return null;
}

async function loadWattbuyProfileSeed(args: {
  houseId: string;
  esiid: string | null;
  rawWattbuyJson: unknown;
}): Promise<Record<string, unknown> | null> {
  const fromAddress = normalizeWattbuyPayload(args.rawWattbuyJson);
  if (fromAddress) return fromAddress;

  const snapshotWhere: any = {
    endpoint: "ELECTRICITY_INFO",
    OR: [{ houseAddressId: args.houseId }, ...(args.esiid ? [{ esiid: args.esiid }] : [])],
  };

  const fromModule = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot
    .findFirst({
      where: snapshotWhere,
      orderBy: { fetchedAt: "desc" },
      select: { payloadJson: true },
    })
    .catch(() => null);
  const fromModulePayload = normalizeWattbuyPayload(fromModule?.payloadJson ?? null);
  if (fromModulePayload) return fromModulePayload;

  const fromMaster = await (prisma as any).wattBuyApiSnapshot
    .findFirst({
      where: snapshotWhere,
      orderBy: { fetchedAt: "desc" },
      select: { payloadJson: true },
    })
    .catch(() => null);
  return normalizeWattbuyPayload(fromMaster?.payloadJson ?? null);
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
      select: { id: true, esiid: true, rawWattbuyJson: true, tdspSlug: true, utilityName: true, isRenter: true },
    });
    if (!house) return NextResponse.json({ ok: false, error: "House not found" }, { status: 403 });

    // Defensive mapper: WattBuy payload shapes vary; only fill what we can infer.
    const wb =
      (await loadWattbuyProfileSeed({
        houseId,
        esiid: typeof (house as any)?.esiid === "string" ? (house as any).esiid : null,
        rawWattbuyJson: (house as any)?.rawWattbuyJson ?? null,
      })) ?? {};
    const housing = wb?.housing_chars ?? wb?.housingChars ?? null;

    const style = mapHouseTypeToHomeStyle(
      pickString(wb, ["home_style", "homeStyle", "construction", "style"]) ??
        pickString(housing, ["house_type", "houseType", "construction_type", "constructionType"]),
    );
    const insulation = mapInsulationType(
      pickString(wb, ["insulation_type", "insulationType", "insulation"]) ??
        pickString(housing, ["insulation_type", "insulationType", "insulation"]),
    );
    const windowType = mapWindowType(
      pickString(wb, ["window_type", "windowType", "windows"]) ??
        pickString(housing, ["window_type", "windowType", "windows"]),
    );
    const foundation = mapFoundationType(
      pickString(wb, ["foundation", "foundation_type", "foundationType"]) ??
        pickString(housing, ["foundation", "foundation_type", "foundationType"]),
    );

    const squareFeet =
      pickNumber(wb, ["square_feet", "squareFeet", "sqft", "sq_ft", "homeSqFt"]) ??
      pickNumber(housing, ["sq_ft", "square_feet", "sqft"]);
    const stories = pickNumber(wb, ["stories", "numStories"]) ?? pickNumber(housing, ["stories"]);

    const homeAgeTopLevel = pickNumber(wb, ["home_age", "homeAge", "age"]);
    const yearBuilt = pickNumber(housing, ["year_built", "yearBuilt"]);
    const currentYear = new Date().getFullYear();
    const homeAgeFromYearBuilt =
      yearBuilt != null && yearBuilt >= 1700 && yearBuilt <= currentYear ? Math.max(0, currentYear - Math.trunc(yearBuilt)) : null;
    const homeAge = homeAgeTopLevel ?? homeAgeFromYearBuilt;
    const hasPool = parseWattbuyBoolean(
      (housing as any)?.has_pool ?? (housing as any)?.hasPool ?? (wb as any)?.has_pool ?? (wb as any)?.hasPool ?? null,
    );

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
        hasPool: hasPool != null ? { value: hasPool, source: "PREFILL" } : { value: null, source: "UNKNOWN" },
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

