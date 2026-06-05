import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import {
  isGreenButtonUploadParseError,
  isGreenButtonUsageIngestionProcessing,
  isGreenButtonUsageIngestionReady,
} from "@/lib/usage/greenButtonUploadStatus";
import { resolveGreenButtonConnectionExpiresAtForUpload } from "@/lib/usage/awardGreenButtonUsageEntry";
import { parseGreenButtonUploadParseSummary } from "@/lib/usage/greenButtonIngestContract";
import { normalizeEmail } from "@/lib/utils/email";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const normalizedEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const homeId = String(url.searchParams.get("homeId") ?? "").trim();
    if (!homeId) {
      return NextResponse.json({ ok: false, error: "home_id_required" }, { status: 400 });
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: homeId, userId: user.id, archivedAt: null },
      select: { id: true },
    });
    if (!house) {
      return NextResponse.json({ ok: false, error: "home_not_found" }, { status: 404 });
    }

    let upload =
      (await (prisma as any).greenButtonUpload.findFirst({
        where: { houseId: house.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          parseStatus: true,
          parseMessage: true,
          dateRangeStart: true,
          dateRangeEnd: true,
          fileName: true,
        },
      })) ?? null;

    const coverage = await (usagePrisma as any).greenButtonInterval
      .aggregate({
        where: { homeId: house.id },
        _min: { timestamp: true },
        _max: { timestamp: true },
        _count: { _all: true },
      })
      .catch(() => null);
    const persistedIntervalCount = Math.max(0, Number(coverage?._count?._all ?? 0) || 0);

    const uploadParseProcessing =
      String(upload?.parseStatus ?? "")
        .toLowerCase()
        .trim() === "processing";
    if (
      !uploadParseProcessing &&
      (!upload?.dateRangeStart || !upload?.dateRangeEnd) &&
      upload &&
      persistedIntervalCount > 0
    ) {
      upload = {
        ...upload,
        dateRangeStart: upload.dateRangeStart ?? coverage?._min?.timestamp ?? null,
        dateRangeEnd: upload.dateRangeEnd ?? coverage?._max?.timestamp ?? null,
        parseStatus: upload.parseStatus ?? "complete",
      };
    }

    const ready = isGreenButtonUsageIngestionReady(upload, persistedIntervalCount);
    const processing = isGreenButtonUsageIngestionProcessing(upload, persistedIntervalCount);
    const errored = isGreenButtonUploadParseError(upload?.parseStatus ?? null);
    const expiresAt = upload
      ? resolveGreenButtonConnectionExpiresAtForUpload({
          createdAt: upload.createdAt,
          parseMessage: upload.parseMessage,
          meterDataEnd: coverage?._max?.timestamp ?? null,
        })
      : null;
    const summary = parseGreenButtonUploadParseSummary(upload?.parseMessage);
    const hasKnownMeterEnd = Boolean(summary?.dataAvailableEndDateKey || coverage?._max?.timestamp);
    const expired = Boolean(
      expiresAt && hasKnownMeterEnd && expiresAt.getTime() < Date.now()
    );

    return NextResponse.json({
      ok: true,
      upload: upload
        ? {
            id: upload.id,
            fileName: upload.fileName,
            parseStatus: upload.parseStatus,
            parseMessage: upload.parseMessage,
            dateRangeStart: upload.dateRangeStart?.toISOString() ?? null,
            dateRangeEnd: upload.dateRangeEnd?.toISOString() ?? null,
            createdAt: upload.createdAt.toISOString(),
            updatedAt: upload.updatedAt.toISOString(),
          }
        : null,
      ready,
      processing,
      persistedIntervalCount,
      errored,
      expired,
      expiresAt: expiresAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("[green-button/status] failed", error);
    return NextResponse.json({ ok: false, error: "status_failed" }, { status: 500 });
  }
}
