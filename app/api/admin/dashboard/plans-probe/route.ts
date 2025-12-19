import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function isRateStructurePresent(v: any): boolean {
  if (v == null) return false;
  // Best-effort: treat Prisma JSON-null-ish objects as absent.
  if (typeof v === "object" && (v as any)?.toJSON?.() === null) return false;
  if (typeof v !== "object") return false;
  try {
    return Object.keys(v).length > 0;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const url = new URL(req.url);
    const isRenter = parseBool(url.searchParams.get("isRenter"), false);
    const template = (url.searchParams.get("template") ?? "all").toLowerCase();
    const maxOffers = clampInt(Number(url.searchParams.get("maxOffers") ?? "200"), 1, 500);
    const includeOffers = parseBool(url.searchParams.get("includeOffers"), false);

    const emailRaw = url.searchParams.get("email");
    const address = url.searchParams.get("address");
    const city = url.searchParams.get("city");
    const state = url.searchParams.get("state");
    const zip = url.searchParams.get("zip");

    let addr = { address: "", city: "", state: "", zip: "" };
    let source: "email" | "explicit" = "explicit";

    if (emailRaw) {
      source = "email";
      const email = String(emailRaw).trim().toLowerCase();
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true },
      });
      if (!user) {
        return NextResponse.json({ ok: false, error: "user_not_found", email }, { status: 404 });
      }

      // Primary (or most recent) home.
      let house = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
        orderBy: { createdAt: "desc" },
        select: { addressLine1: true, addressCity: true, addressState: true, addressZip5: true },
      });
      if (!house) {
        house = await prisma.houseAddress.findFirst({
          where: { userId: user.id, archivedAt: null } as any,
          orderBy: { createdAt: "desc" },
          select: { addressLine1: true, addressCity: true, addressState: true, addressZip5: true },
        });
      }
      if (!house) {
        return NextResponse.json({ ok: false, error: "no_home_for_user", email }, { status: 400 });
      }
      addr = {
        address: String(house.addressLine1 ?? ""),
        city: String(house.addressCity ?? ""),
        state: String(house.addressState ?? ""),
        zip: String(house.addressZip5 ?? ""),
      };
    } else {
      if (!address || !city || !state || !zip) {
        return NextResponse.json(
          {
            ok: false,
            error: "missing_params",
            message: "Provide either ?email=<userEmail> or ?address&city&state&zip",
          },
          { status: 400 },
        );
      }
      addr = {
        address: String(address),
        city: String(city),
        state: String(state),
        zip: String(zip),
      };
    }

    const raw = await wattbuy.offers({ ...addr, isRenter });
    const normalized = normalizeOffers(raw ?? {});
    const offersRaw = Array.isArray(normalized?.offers) ? normalized.offers : [];

    const offerIds = offersRaw.map((o: any) => o?.offer_id).filter(Boolean);
    const maps = await (prisma as any).offerIdRatePlanMap.findMany({
      where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
      select: { offerId: true, ratePlanId: true },
    });
    const mapByOfferId = new Map(
      (maps as Array<{ offerId: string; ratePlanId: string | null }>).map((m) => [
        String(m.offerId),
        m.ratePlanId ? String(m.ratePlanId) : null,
      ]),
    );

    const mappedRatePlanIds = Array.from(
      new Set(
        offerIds
          .map((offerId: string) => mapByOfferId.get(String(offerId)) ?? null)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    const planCalcByRatePlanId = new Map<
      string,
      { planCalcStatus: "COMPUTABLE" | "NOT_COMPUTABLE" | "UNKNOWN"; planCalcReasonCode: string }
    >();

    if (mappedRatePlanIds.length) {
      const rps = await (prisma as any).ratePlan.findMany({
        where: { id: { in: mappedRatePlanIds } },
        select: { id: true, rateStructure: true, planCalcStatus: true, planCalcReasonCode: true },
      });
      for (const rp of rps as any[]) {
        const id = String(rp.id);
        const storedStatus =
          typeof rp?.planCalcStatus === "string" ? (String(rp.planCalcStatus) as any) : null;
        const storedReason =
          typeof rp?.planCalcReasonCode === "string" ? String(rp.planCalcReasonCode) : null;

        if (storedStatus === "COMPUTABLE" || storedStatus === "NOT_COMPUTABLE") {
          planCalcByRatePlanId.set(id, {
            planCalcStatus: storedStatus,
            planCalcReasonCode: storedReason ?? "UNKNOWN",
          });
          continue;
        }

        const rsPresent = isRateStructurePresent(rp.rateStructure);
        const derived = derivePlanCalcRequirementsFromTemplate({
          rateStructure: rsPresent ? rp.rateStructure : null,
        });
        planCalcByRatePlanId.set(id, {
          planCalcStatus: derived.planCalcStatus,
          planCalcReasonCode: derived.planCalcReasonCode,
        });
      }
    }

    const scored = offersRaw.map((o: any) => {
      const offerId = String(o.offer_id ?? "");
      const eflUrl = o?.docs?.efl ?? null;
      const ratePlanId = mapByOfferId.get(offerId) ?? null;
      const calc = ratePlanId ? planCalcByRatePlanId.get(ratePlanId) ?? null : null;
      const statusLabel = (() => {
        if (!ratePlanId) return eflUrl ? "QUEUED" : "UNAVAILABLE";
        if (calc && calc.planCalcStatus === "COMPUTABLE") return "AVAILABLE";
        return "QUEUED";
      })();

      return {
        offerId,
        supplier: o.supplier_name ?? null,
        planName: o.plan_name ?? null,
        termMonths: typeof o.term_months === "number" ? o.term_months : null,
        statusLabel,
        ratePlanId,
        planCalcStatus: calc?.planCalcStatus ?? null,
        planCalcReasonCode: calc?.planCalcReasonCode ?? null,
        eflUrl,
      };
    });

    const filtered =
      template === "available"
        ? scored.filter((r) => r.statusLabel === "AVAILABLE")
        : template === "queued"
          ? scored.filter((r) => r.statusLabel === "QUEUED")
          : template === "unavailable"
            ? scored.filter((r) => r.statusLabel === "UNAVAILABLE")
            : scored;

    const counts = filtered.reduce(
      (acc: any, r) => {
        acc[r.statusLabel] = (acc[r.statusLabel] ?? 0) + 1;
        return acc;
      },
      { AVAILABLE: 0, QUEUED: 0, UNAVAILABLE: 0 },
    );

    const nonComputableTemplates = filtered
      .filter((r) => r.planCalcStatus === "NOT_COMPUTABLE")
      .slice(0, 50);

    return NextResponse.json(
      {
        ok: true,
        input: {
          source,
          email: emailRaw ? String(emailRaw) : null,
          address: source === "explicit" ? addr : undefined,
          isRenter,
          template,
          maxOffers,
        },
        offersCount: offersRaw.length,
        mappedOffersCount: offerIds.filter((id: string) => mapByOfferId.get(id)).length,
        filteredCount: filtered.length,
        counts,
        nonComputableTemplates,
        offers: includeOffers ? filtered.slice(0, maxOffers) : undefined,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


