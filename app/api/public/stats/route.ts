import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(a: Date, b: Date): number | null {
  const t0 = a?.getTime?.();
  const t1 = b?.getTime?.();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return Math.ceil((t1 - t0) / DAY_MS);
}

function finiteOrNull(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function GET() {
  try {
    const now = new Date();

    // Latest snapshot per user (prevents multi-home users from overweighting the average).
    const latestByUser = await (db as any).homeSavingsSnapshot.findMany({
      distinct: ["userId"],
      orderBy: [{ computedAt: "desc" }],
      select: {
        userId: true,
        computedAt: true,
        contractEndDate: true,
        savingsNext12MonthsNoEtf: true,
        savingsUntilContractEndNoEtf: true,
      },
    });

    const metricForSnapshot = (s: any): number | null => {
      const contractEnd = s?.contractEndDate ? new Date(s.contractEndDate) : null;
      const due = contractEnd && Number.isFinite(contractEnd.getTime()) ? (daysUntil(now, contractEnd) ?? 999999) <= 14 : false;
      const next12 = finiteOrNull(s?.savingsNext12MonthsNoEtf);
      const toEnd = finiteOrNull(s?.savingsUntilContractEndNoEtf);
      // If contract is due (<=14d), use 12-month savings; otherwise prefer to-contract-end when present.
      return due ? next12 : (toEnd ?? next12);
    };

    const values = latestByUser.map(metricForSnapshot).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const analyzedUsers = values.length;
    const avg = analyzedUsers > 0 ? values.reduce((a, b) => a + b, 0) / analyzedUsers : null;

    // Running total savings for users who switched with IntelliWatt (CommissionRecord exists).
    const switchedUsers = await db.commissionRecord.findMany({
      select: { userId: true },
      distinct: ["userId"],
    });
    const switchedIds = switchedUsers.map((r) => r.userId);
    const latestSwitched = switchedIds.length
      ? await (db as any).homeSavingsSnapshot.findMany({
          where: { userId: { in: switchedIds } },
          distinct: ["userId"],
          orderBy: [{ computedAt: "desc" }],
          select: {
            userId: true,
            computedAt: true,
            contractEndDate: true,
            savingsNext12MonthsNoEtf: true,
            savingsUntilContractEndNoEtf: true,
          },
        })
      : [];
    const switchedValues = latestSwitched
      .map(metricForSnapshot)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    // “Total savings” should not go down due to negative deltas; treat extra-cost cases as 0 for the running total.
    const totalSwitchedSavings = switchedValues.reduce((sum, v) => sum + Math.max(0, v), 0);

    return NextResponse.json({
      ok: true,
      analyzedUsers,
      avgSavingsDollars: avg,
      switchedUsers: switchedValues.length,
      totalSwitchedSavingsDollars: totalSwitchedSavings,
      // Policy metadata for transparency/debugging.
      policy: {
        averageExcludesEtf: true,
        dueWindowDays: 14,
        perUserLatestSnapshot: true,
        totalSavingsClampsNegativeToZero: true,
      },
      computedAt: now.toISOString(),
    });
  } catch (e) {
    console.error("[public_stats] error", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

