import { NextRequest, NextResponse } from "next/server";
import { usagePrisma } from "@/lib/db/usageClient";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const take = Math.min(Number(url.searchParams.get("limit") ?? 10) || 10, 50);

    const rawRecords = await usagePrisma.rawGreenButton.findMany({
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        utilityName: true,
        accountNumber: true,
        capturedAt: true,
      },
    });

    const ids = rawRecords.map((record) => record.id);
    const intervalGroups =
      ids.length === 0
        ? []
        : await (usagePrisma as any).greenButtonInterval.groupBy({
            by: ["rawId"],
            where: { rawId: { in: ids } },
            _count: { _all: true },
            _sum: { consumptionKwh: true },
          });

    const intervalsByRawId = new Map<string, { count: number; totalKwh: number }>();
    for (const group of intervalGroups) {
      intervalsByRawId.set(group.rawId, {
        count: group._count._all,
        totalKwh: Number(group._sum.consumptionKwh ?? 0),
      });
    }

    const sampleIntervals =
      ids.length === 0
        ? []
        : await (usagePrisma as any).greenButtonInterval.findMany({
            where: { rawId: { in: ids } },
            orderBy: { timestamp: "asc" },
            take: 50,
            select: {
              id: true,
              rawId: true,
              timestamp: true,
              consumptionKwh: true,
              intervalMinutes: true,
            },
          });

    return NextResponse.json({
      ok: true,
      uploads: rawRecords.map((record) => ({
        ...record,
        intervals: intervalsByRawId.get(record.id) ?? { count: 0, totalKwh: 0 },
      })),
      sampleIntervals,
    });
  } catch (error) {
    console.error("[admin/green-button/records] failed", error);
    return NextResponse.json({ ok: false, error: "fetch_failed" }, { status: 500 });
  }
}

