import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getIntervalSeries15m } from "@/lib/usage/intervalSeriesRepo";
import { isIntervalSeriesKind } from "@/modules/usageSimulator/kinds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
    if (!user?.id) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const houseId = String(url.searchParams.get("houseId") ?? "").trim();
    const kindRaw = String(url.searchParams.get("kind") ?? "").trim();
    const scenarioIdRaw = String(url.searchParams.get("scenarioId") ?? "").trim();
    const scenarioId = scenarioIdRaw ? scenarioIdRaw : null;

    if (!houseId) {
      return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    }
    if (!isIntervalSeriesKind(kindRaw)) {
      return NextResponse.json({ ok: false, error: "kind_invalid" }, { status: 400 });
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: houseId, userId: user.id, archivedAt: null },
      select: { id: true },
    });
    if (!house) {
      return NextResponse.json({ ok: false, error: "house_not_found" }, { status: 404 });
    }

    const series = await getIntervalSeries15m({
      userId: user.id,
      houseId,
      kind: kindRaw,
      scenarioId,
    });
    if (!series) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      houseId,
      kind: kindRaw,
      scenarioId,
      header: {
        anchorStartUtc: series.header.anchorStartUtc.toISOString(),
        anchorEndUtc: series.header.anchorEndUtc.toISOString(),
        derivationVersion: series.header.derivationVersion,
        buildInputsHash: series.header.buildInputsHash,
        updatedAt: series.header.updatedAt.toISOString(),
      },
      series: {
        intervals15: series.points.map((row) => ({
          tsUtc: row.tsUtc.toISOString(),
          kwh: row.kwh,
        })),
      },
    });
  } catch (error) {
    console.error("[user/interval-series] failed", error);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
