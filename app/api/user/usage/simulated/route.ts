import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { generateSimulatedCurveFromManual } from "@/modules/simulatedUsage/engine";
import { buildSimulatedUsageDatasetFromBuildInputs, type SimulatorBuildInputsV1 } from "@/modules/usageSimulator/dataset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UsageSeriesPoint = { timestamp: string; kwh: number };

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function toDateKey(tsIso: string): string {
  return tsIso.slice(0, 10);
}

function toMonthKey(tsIso: string): string {
  return tsIso.slice(0, 7);
}

function dayOfWeekUtc(dateKey: string): number {
  // 0=Sun..6=Sat
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  const t = d.getTime();
  if (!Number.isFinite(t)) return 0;
  return d.getUTCDay();
}

function computeFifteenMinuteAverages(intervals: Array<{ timestamp: string; consumption_kwh: number }>) {
  const buckets = new Map<string, { sumKw: number; count: number }>();
  for (let i = 0; i < intervals.length; i++) {
    const ts = intervals[i].timestamp;
    const hhmm = ts.slice(11, 16); // HH:MM in ISO
    const kwh = Number(intervals[i].consumption_kwh) || 0;
    const kw = kwh * 4; // 15-min to kW
    const cur = buckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    cur.sumKw += kw;
    cur.count += 1;
    buckets.set(hhmm, cur);
  }
  return Array.from(buckets.entries())
    .map(([hhmm, v]) => ({ hhmm, avgKw: v.count > 0 ? round2(v.sumKw / v.count) : 0 }))
    .sort((a, b) => (a.hhmm < b.hhmm ? -1 : 1));
}

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = cookies();
    const rawEmail = cookieStore.get("intelliwatt_user")?.value;
    if (!rawEmail) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const userEmail = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const houses = await prisma.houseAddress.findMany({
      where: { userId: user.id, archivedAt: null },
      select: {
        id: true,
        label: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        esiid: true,
      },
    });

    const results: any[] = [];
    for (let i = 0; i < houses.length; i++) {
      const house = houses[i];
      const buildRec = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: { userId_houseId: { userId: user.id, houseId: house.id } },
          select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true },
        })
        .catch(() => null);

      const rec =
        buildRec?.buildInputs
          ? null
          : await (prisma as any).manualUsageInput
              .findUnique({
                where: { userId_houseId: { userId: user.id, houseId: house.id } },
                select: { payload: true },
              })
              .catch(() => null);

      let dataset: any | null = null;
      if (buildRec?.buildInputs) {
        try {
          const buildInputs = buildRec.buildInputs as SimulatorBuildInputsV1;
          dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
          dataset.meta = {
            ...(dataset.meta ?? {}),
            buildInputsHash: String(buildRec.buildInputsHash ?? ""),
            lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
          };
        } catch {
          dataset = null;
        }
      } else if (rec?.payload) {
        try {
          const curve = generateSimulatedCurveFromManual(rec.payload as any);

          // Daily totals
          const dailyMap = new Map<string, number>();
          for (let j = 0; j < curve.intervals.length; j++) {
            const dk = toDateKey(curve.intervals[j].timestamp);
            dailyMap.set(dk, (dailyMap.get(dk) ?? 0) + (Number(curve.intervals[j].consumption_kwh) || 0));
          }
          const daily = Array.from(dailyMap.entries())
            .map(([date, kwh]) => ({ date, kwh: round2(kwh) }))
            .sort((a, b) => (a.date < b.date ? -1 : 1));

          // Monthly totals
          const monthly = curve.monthlyTotals
            .map((m) => ({ month: m.month, kwh: round2(m.kwh) }))
            .sort((a, b) => (a.month < b.month ? -1 : 1));

          // Series (match key shape; we keep intervals15 empty to avoid huge payloads)
          const seriesDaily: UsageSeriesPoint[] = daily.map((d) => ({ timestamp: `${d.date}T00:00:00.000Z`, kwh: d.kwh }));
          const seriesMonthly: UsageSeriesPoint[] = monthly.map((m) => ({ timestamp: `${m.month}-01T00:00:00.000Z`, kwh: m.kwh }));
          const seriesAnnual: UsageSeriesPoint[] = [
            { timestamp: curve.end.slice(0, 4) + "-01-01T00:00:00.000Z", kwh: round2(curve.annualTotalKwh) },
          ];

          // Insights
          const fifteenMinuteAverages = computeFifteenMinuteAverages(curve.intervals);

          let weekdaySum = 0;
          let weekendSum = 0;
          for (let j = 0; j < daily.length; j++) {
            const dow = dayOfWeekUtc(daily[j].date);
            if (dow === 0 || dow === 6) weekendSum += daily[j].kwh;
            else weekdaySum += daily[j].kwh;
          }

          const peakDay =
            daily.length > 0 ? daily.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;

          dataset = {
            summary: {
              source: "SIMULATED",
              intervalsCount: curve.intervals.length,
              totalKwh: round2(curve.annualTotalKwh),
              start: curve.start,
              end: curve.end,
              latest: curve.end,
            },
            series: {
              intervals15: [] as UsageSeriesPoint[],
              hourly: [] as UsageSeriesPoint[],
              daily: seriesDaily,
              monthly: seriesMonthly,
              annual: seriesAnnual,
            },
            daily,
            monthly,
            insights: {
              fifteenMinuteAverages,
              timeOfDayBuckets: [],
              stitchedMonth: null,
              peakDay: peakDay ? { date: peakDay.date, kwh: peakDay.kwh } : null,
              peakHour: null,
              baseload: null,
              weekdayVsWeekend: { weekday: round2(weekdaySum), weekend: round2(weekendSum) },
            },
            totals: {
              importKwh: round2(curve.annualTotalKwh),
              exportKwh: 0,
              netKwh: round2(curve.annualTotalKwh),
            },
            meta: {
              datasetKind: "SIMULATED",
              manualMode: String((rec.payload as any)?.mode ?? ""),
              excludedDays: curve.meta.excludedDays,
              renormalized: curve.meta.renormalized,
            },
          };
        } catch {
          dataset = null;
        }
      }

      results.push({
        houseId: house.id,
        label: house.label || house.addressLine1,
        address: {
          line1: house.addressLine1,
          city: house.addressCity,
          state: house.addressState,
        },
        esiid: house.esiid,
        dataset,
        alternatives: {
          smt: null,
          greenButton: null,
        },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        houses: results,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=30",
        },
      },
    );
  } catch (error) {
    console.error("[user/usage/simulated] failed", error);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

