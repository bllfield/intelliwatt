import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getActualIntervalsForRange, getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { chooseActualSource } from "@/modules/realUsageAdapter/actual";
import { fetchActualCanonicalMonthlyTotals, fetchActualIntradayShape96 } from "@/modules/realUsageAdapter/actual";
import { generateSimulatedCurve } from "@/modules/simulatedUsage/engine";
import { getGenericWeekdayShape96 } from "@/modules/simulatedUsage/intradayTemplates";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
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

/** Build Home Profile snapshot for audit (fields as stored; add spec aliases where needed). */
function homeProfileSnapshot(rec: Awaited<ReturnType<typeof getHomeProfileSimulatedByUserHouse>>) {
  if (!rec) return null;
  const o = rec as Record<string, unknown>;
  return {
    homeAge: o.homeAge,
    homeStyle: o.homeStyle,
    squareFeet: o.squareFeet,
    stories: o.stories,
    insulation: o.insulationType,
    insulationType: o.insulationType,
    windows: o.windowType,
    windowType: o.windowType,
    foundation: o.foundation,
    fuelConfiguration: o.fuelConfiguration,
    hvacType: o.hvacType,
    heatingType: o.heatingType,
    thermostatSummerF: o.summerTemp,
    thermostatWinterF: o.winterTemp,
    summerTemp: o.summerTemp,
    winterTemp: o.winterTemp,
    ledLights: o.ledLights,
    smartThermostat: o.smartThermostat,
    pool: {
      hasPool: o.hasPool,
      pumpType: o.poolPumpType,
      pumpHp: o.poolPumpHp,
      summerRunHoursPerDay: o.poolSummerRunHoursPerDay,
      winterRunHoursPerDay: o.poolWinterRunHoursPerDay,
      heaterInstalled: o.hasPoolHeater,
      poolHeaterType: o.poolHeaterType,
    },
    occupants: {
      work: o.occupantsWork,
      school: o.occupantsSchool,
      homeAllDay: o.occupantsHomeAllDay,
      total: Number(o.occupantsWork ?? 0) + Number(o.occupantsSchool ?? 0) + Number(o.occupantsHomeAllDay ?? 0),
    },
  };
}

/** Build Appliance Profile snapshot for audit. */
function applianceProfileSnapshot(rec: Awaited<ReturnType<typeof getApplianceProfileSimulatedByUserHouse>>) {
  if (!rec?.appliancesJson) return null;
  const normalized = normalizeStoredApplianceProfile(rec.appliancesJson as any);
  return {
    version: normalized.version,
    fuelConfiguration: normalized.fuelConfiguration,
    appliances: normalized.appliances,
    applianceCount: normalized.appliances?.length ?? 0,
  };
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

  const [homeProfileRec, applianceProfileRec] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId: user.id, houseId: house.id }),
    getApplianceProfileSimulatedByUserHouse({ userId: user.id, houseId: house.id }),
  ]);
  const homeProfile = homeProfileSnapshot(homeProfileRec);
  const applianceProfile = applianceProfileSnapshot(applianceProfileRec);

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
      homeProfile,
      applianceProfile,
      modelAssumptions: null,
      maskedIntervals: 0,
      message: "Add travel/vacant ranges and click Run Compare to see metrics.",
      metrics: null,
      primaryPercentMetric: null,
      byMonth: [],
      byHour: [],
      byDayType: [],
      worstDays: [],
      diagnostics: null,
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
      homeProfile,
      applianceProfile,
      modelAssumptions: null,
      maskedIntervals: 0,
      message: "No intervals fall inside the masked ranges; add ranges and try again.",
      metrics: null,
      primaryPercentMetric: null,
      byMonth: [],
      byHour: [],
      byDayType: [],
      worstDays: [],
      diagnostics: null,
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

  const shapeSource = shape96 && shape96.length === 96 ? "actual_excluding_masked" : "generic_weekday";
  const modelAssumptions = {
    baseload: {
      used: false,
      method: "monthly_totals_from_actual",
      params: { excludeDateKeys: excludeDateKeys.length },
      valueKwhPer15m: null,
      valueKwhPerDay: null,
    },
    pool: {
      used: false,
      pumpType: homeProfile?.pool?.pumpType ?? null,
      pumpHp: homeProfile?.pool?.pumpHp ?? null,
      assumedKw: null,
      runHoursPerDaySummer: homeProfile?.pool?.summerRunHoursPerDay ?? null,
      runHoursPerDayWinter: homeProfile?.pool?.winterRunHoursPerDay ?? null,
      scheduleRule: "Gap-fill lab does not model pool; monthly totals exclude masked days only.",
    },
    hvac: {
      used: false,
      hvacType: homeProfile?.hvacType ?? null,
      heatingType: homeProfile?.heatingType ?? null,
      setpointSummerF: homeProfile?.thermostatSummerF ?? homeProfile?.summerTemp ?? null,
      setpointWinterF: homeProfile?.thermostatWinterF ?? homeProfile?.winterTemp ?? null,
      weatherUsed: false,
      rule: "Gap-fill lab uses single intraday shape; no HVAC model.",
    },
    occupancy: {
      used: false,
      occupantsWork: homeProfile?.occupants?.work ?? null,
      occupantsSchool: homeProfile?.occupants?.school ?? null,
      occupantsHomeAllDay: homeProfile?.occupants?.homeAllDay ?? null,
      rule: "Gap-fill lab uses monthly totals × shape; no occupancy model.",
    },
    intradayShape: {
      source: shapeSource,
      weekdayWeekendSplit: false,
      smoothing: "none",
    },
    meta: {
      simVersion: "gapfill_v1",
      shapeDerivationVersion: "v1",
      seed: null,
      maskMode: "travel_ranges",
      holdoutN: maskedActual.length,
      configHash: `months=${canonicalMonths.length},shape=${shapeSource}`,
    },
  };

  const hasPool = Boolean(homeProfile?.pool?.hasPool);
  const poolHoursErrorSplit = hasPool
    ? {
        poolHours: { wape: null as number | null, mae: null as number | null },
        nonPoolHours: { wape: null as number | null, mae: null as number | null },
        scheduleRuleUsed: "Pool schedule not implemented in gap-fill lab; used: false.",
      }
    : null;

  const pasteLines = [
    "=== Simulation Audit Report (Gap-Fill Lab) ===",
    `House: ${house.addressLine1 ?? ""} ${house.addressCity ?? ""} ${house.addressState ?? ""}`.trim() || house.id,
    `Masked intervals: ${maskedActual.length} | Timezone: ${timezone}`,
    "",
    "--- Primary metrics ---",
    `WAPE: ${metrics.wape}% | MAE: ${metrics.mae} kWh | RMSE: ${metrics.rmse} | MAPE: ${metrics.mape}% | MaxAbs: ${metrics.maxAbs} kWh`,
    "",
    "--- Assumptions ---",
    `Intraday shape: ${modelAssumptions.intradayShape.source} | Weekday/weekend split: ${modelAssumptions.intradayShape.weekdayWeekendSplit}`,
    `Baseload/Pool/HVAC/Occupancy models: not used (monthly totals × shape only)`,
    "",
    "--- Diagnostics ---",
    `Seasonal: Summer WAPE ${metrics.diagnostics.seasonalSplit.summer.wape}% MAE ${metrics.diagnostics.seasonalSplit.summer.mae} | Winter WAPE ${metrics.diagnostics.seasonalSplit.winter.wape}% MAE ${metrics.diagnostics.seasonalSplit.winter.mae} | Shoulder WAPE ${metrics.diagnostics.seasonalSplit.shoulder.wape}% MAE ${metrics.diagnostics.seasonalSplit.shoulder.mae}`,
    `Worst days: ${metrics.worstDays.slice(0, 5).map((d) => `${d.date}: ${d.absErrorKwh} kWh`).join(" | ")}`,
  ];
  const pasteSummary = pasteLines.join("\n");

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
    homeProfile,
    applianceProfile,
    modelAssumptions,
    maskedIntervals: maskedActual.length,
    metrics: {
      mae: metrics.mae,
      rmse: metrics.rmse,
      mape: metrics.mape,
      wape: metrics.wape,
      maxAbs: metrics.maxAbs,
    },
    primaryPercentMetric: metrics.wape,
    byMonth: metrics.byMonth,
    byHour: metrics.byHour,
    byDayType: metrics.byDayType,
    worstDays: metrics.worstDays,
    diagnostics: {
      dailyTotalsMasked: metrics.diagnostics.dailyTotalsMasked,
      top10Under: metrics.diagnostics.top10Under,
      top10Over: metrics.diagnostics.top10Over,
      hourlyProfileMasked: metrics.diagnostics.hourlyProfileMasked,
      seasonalSplit: metrics.diagnostics.seasonalSplit,
      poolHoursErrorSplit,
    },
    pasteSummary,
  });
}
