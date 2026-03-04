import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getActualIntervalsForRange, getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { chooseActualSource } from "@/modules/realUsageAdapter/actual";
import { fetchActualCanonicalMonthlyTotals, fetchActualIntradayShape96 } from "@/modules/realUsageAdapter/actual";
import { generateSimulatedCurve } from "@/modules/simulatedUsage/engine";
import { getGenericWeekdayShape96 } from "@/modules/simulatedUsage/intradayTemplates";
import {
  computeGapFillMetrics,
  dateKeyInTimezone,
  localDateKeysInRange,
} from "@/lib/admin/gapfillLab";

export const dynamic = "force-dynamic";

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

function yearMonthsFromRange(startDate: string, endDate: string): string[] {
  const start = String(startDate).slice(0, 10);
  const end = String(endDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  const seen = new Set<string>();
  const a = new Date(start + "T12:00:00.000Z").getTime();
  const b = new Date(end + "T12:00:00.000Z").getTime();
  let t = Math.min(a, b);
  const last = Math.max(a, b);
  const dayMs = 24 * 60 * 60 * 1000;
  while (t <= last) {
    const ym = new Date(t).toISOString().slice(0, 7);
    seen.add(ym);
    t += dayMs;
  }
  return Array.from(seen).sort();
}

export async function POST(req: NextRequest) {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  }

  let body: {
    email?: string;
    timezone?: string;
    rangesToMask?: Array<{ startDate: string; endDate: string }>;
    houseId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeEmailSafe(body?.email ?? "");
  if (!email) {
    return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });
  }

  const timezone = String(body?.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const rangesToMask = Array.isArray(body?.rangesToMask)
    ? body.rangesToMask
        .map((r: any) => ({
          startDate: String(r?.startDate ?? "").slice(0, 10),
          endDate: String(r?.endDate ?? "").slice(0, 10),
        }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate))
    : [];

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: "user_not_found", message: "No user with that email." }, { status: 404 });
  }

  const houses = await (prisma as any).houseAddress.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, esiid: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, createdAt: true },
  });

  if (!houses?.length) {
    return NextResponse.json({ ok: false, error: "no_houses", message: "User has no houses." }, { status: 404 });
  }

  const houseIdParam = (body?.houseId ?? "").trim();
  let house = houseIdParam
    ? houses.find((h: any) => h.id === houseIdParam)
    : houses[0];
  if (!house) {
    return NextResponse.json({ ok: false, error: "house_not_found", message: "House not found or not owned by user." }, { status: 404 });
  }

  const esiid = house.esiid ? String(house.esiid) : null;
  const source = await chooseActualSource({ houseId: house.id, esiid });
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "no_actual_data", message: "No actual interval data (SMT or Green Button)." },
      { status: 400 }
    );
  }

  const result = await getActualUsageDatasetForHouse(house.id, esiid);
  const summary = result?.dataset?.summary;
  if (!summary?.start || !summary?.end) {
    return NextResponse.json(
      { ok: false, error: "no_actual_data", message: "No actual interval data for baseline window." },
      { status: 400 }
    );
  }

  const startDate = summary.start.slice(0, 10);
  const endDate = summary.end.slice(0, 10);

  if (rangesToMask.length === 0) {
    return NextResponse.json({
      ok: true,
      email: user.email,
      userId: user.id,
      house: {
        id: house.id,
        label: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
      },
      houses: houses.map((h: any) => ({
        id: h.id,
        label: [h.addressLine1, h.addressCity, h.addressState].filter(Boolean).join(", ") || h.id,
      })),
      timezone,
      maskedIntervals: 0,
      message: "Add travel/vacant ranges and click Run Compare to see metrics.",
      metrics: null,
      byMonth: [],
      byHour: [],
      byDayType: [],
      worstDays: [],
      pasteSummary: "",
    });
  }

  const actualIntervals = await getActualIntervalsForRange({
    houseId: house.id,
    esiid,
    startDate,
    endDate,
  });

  if (!actualIntervals?.length) {
    return NextResponse.json(
      { ok: false, error: "no_actual_data", message: "No actual interval data." },
      { status: 400 }
    );
  }

  const canonicalMonths = yearMonthsFromRange(startDate, endDate);
  if (!canonicalMonths.length) {
    return NextResponse.json({ ok: false, error: "invalid_range" }, { status: 400 });
  }

  const maskedLocalDates = new Set<string>();
  for (const r of rangesToMask) {
    for (const d of localDateKeysInRange(r.startDate, r.endDate, timezone)) {
      maskedLocalDates.add(d);
    }
  }

  const maskedActual = actualIntervals.filter((p) => maskedLocalDates.has(dateKeyInTimezone(p.timestamp, timezone)));
  if (maskedActual.length === 0) {
    return NextResponse.json({
      ok: true,
      email: user.email,
      userId: user.id,
      house: { id: house.id, label: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id },
      houses: houses.map((h: any) => ({
        id: h.id,
        label: [h.addressLine1, h.addressCity, h.addressState].filter(Boolean).join(", ") || h.id,
      })),
      timezone,
      maskedIntervals: 0,
      message: "No intervals fall inside the masked ranges; add ranges and try again.",
      metrics: null,
      byMonth: [],
      byHour: [],
      byDayType: [],
      worstDays: [],
      pasteSummary: "",
    });
  }

  const utcExcludeSet = new Set<string>();
  const windowStart = new Date(startDate + "T00:00:00.000Z").getTime();
  const windowEnd = new Date(endDate + "T23:59:59.999Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let t = windowStart; t <= windowEnd; t += dayMs) {
    const utcDateKey = new Date(t).toISOString().slice(0, 10);
    const localKey = dateKeyInTimezone(new Date(t).toISOString(), timezone);
    if (maskedLocalDates.has(localKey)) utcExcludeSet.add(utcDateKey);
  }

  const travelRangesForEngine = Array.from(utcExcludeSet)
    .sort()
    .map((d) => ({ startDate: d, endDate: d }));

  const excludeDateKeys = Array.from(utcExcludeSet);
  const { monthlyKwhByMonth } = await fetchActualCanonicalMonthlyTotals({
    houseId: house.id,
    esiid,
    canonicalMonths,
    excludeDateKeys,
  });

  const { shape96 } = await fetchActualIntradayShape96({
    houseId: house.id,
    esiid,
    canonicalMonths,
    excludeDateKeys,
  });
  const intradayShape96 = shape96 && shape96.length === 96 ? shape96 : getGenericWeekdayShape96();

  const curve = generateSimulatedCurve({
    canonicalMonths,
    monthlyTotalsKwhByMonth: monthlyKwhByMonth,
    intradayShape96,
    travelRanges: travelRangesForEngine,
  });

  const simulatedByTs = new Map<string, number>();
  for (const i of curve.intervals ?? []) {
    const ts = String((i as any)?.timestamp ?? "").trim();
    if (ts) simulatedByTs.set(ts, Number((i as any)?.consumption_kwh) || 0);
  }

  const metrics = computeGapFillMetrics({
    actual: maskedActual,
    simulated: (curve.intervals ?? []).map((i: any) => ({ timestamp: i.timestamp, kwh: Number(i.consumption_kwh) || 0 })),
    simulatedByTs,
  });

  return NextResponse.json({
    ok: true,
    email: user.email,
    userId: user.id,
    house: {
      id: house.id,
      label: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
    },
    houses: houses.map((h: any) => ({
      id: h.id,
      label: [h.addressLine1, h.addressCity, h.addressState].filter(Boolean).join(", ") || h.id,
    })),
    timezone,
    maskedIntervals: maskedActual.length,
    metrics: {
      mae: metrics.mae,
      rmse: metrics.rmse,
      mape: metrics.mape,
      maxAbs: metrics.maxAbs,
    },
    byMonth: metrics.byMonth,
    byHour: metrics.byHour,
    byDayType: metrics.byDayType,
    worstDays: metrics.worstDays,
    pasteSummary: metrics.pasteSummary,
  });
}
