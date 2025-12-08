import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { EntryStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { refreshUserEntryStatuses } from "@/lib/hitthejackwatt/entryLifecycle";
import { qualifyReferralsForUser } from "@/lib/referral/qualify";
import { parseGreenButtonBuffer } from "@/lib/usage/greenButtonParser";
import { normalizeGreenButtonReadingsTo15Min } from "@/lib/usage/greenButtonNormalize";
import { usagePrisma } from "@/lib/db/usageClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ensure Node runtime so Buffer/crypto and larger payloads work
export const maxDuration = 300; // allow long-running parses for large files

const MANUAL_USAGE_LIFETIME_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  let uploadRecordId: string | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
    }
    const utilityName =
      typeof formData.get("utilityName") === "string" ? String(formData.get("utilityName")).trim() : null;
    const accountNumber =
      typeof formData.get("accountNumber") === "string" ? String(formData.get("accountNumber")).trim() : null;
    const houseId =
      typeof formData.get("houseId") === "string" ? String(formData.get("houseId")).trim() : null;
    const userId =
      typeof formData.get("userId") === "string" ? String(formData.get("userId")).trim() : null;

    if (!houseId || !userId) {
      return NextResponse.json(
        { ok: false, error: "missing_house_or_user" },
        { status: 400 },
      );
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: houseId, userId, archivedAt: null },
      select: { id: true, esiid: true },
    });

    if (!house) {
      return NextResponse.json({ ok: false, error: "invalid_house" }, { status: 404 });
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json({ ok: false, error: "empty_file" }, { status: 400 });
    }
    if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
    }

    const buffer = Buffer.from(arrayBuffer);
    const parsed = parseGreenButtonBuffer(buffer, file.name);
    if (parsed.errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: parsed.errors.join("; ") },
        { status: 400 },
      );
    }

    if (parsed.readings.length === 0) {
      return NextResponse.json({ ok: false, error: "no_readings" }, { status: 400 });
    }

    const normalized = normalizeGreenButtonReadingsTo15Min(parsed.readings, {
      maxKwhPerInterval: 10,
    });
    if (normalized.length === 0) {
      return NextResponse.json({ ok: false, error: "normalization_empty" }, { status: 400 });
    }

    const sorted = [...normalized].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const latestTimestamp = sorted[sorted.length - 1]?.timestamp ?? null;
    if (!latestTimestamp) {
      return NextResponse.json({ ok: false, error: "no_recent_readings" }, { status: 400 });
    }

    const cutoff = new Date(latestTimestamp.getTime() - MANUAL_USAGE_LIFETIME_DAYS * DAY_MS);
    const trimmed = sorted.filter((interval) => interval.timestamp >= cutoff);

    if (trimmed.length === 0) {
      return NextResponse.json({ ok: false, error: "no_recent_readings" }, { status: 400 });
    }

    const digest = createHash("sha256").update(buffer).digest("hex");

    let rawRecordId: string | null = null;
    try {
      const created = await usagePrisma.rawGreenButton.create({
        data: {
          homeId: houseId,
          userId,
          content: buffer,
          filename: file.name,
          mimeType: file.type || "text/plain",
          sizeBytes: buffer.length,
          utilityName,
          accountNumber,
          sha256: digest,
          capturedAt: new Date(),
        },
        select: { id: true },
      });
      rawRecordId = created.id;
    } catch (error: any) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        const existing = await usagePrisma.rawGreenButton.findUnique({
          where: { sha256: digest },
          select: { id: true },
        });
        rawRecordId = existing?.id ?? null;
      } else {
        throw error;
      }
    }

    const uploadRecord = await (prisma as any).greenButtonUpload.create({
      data: {
        houseId,
        utilityName,
        accountNumber,
        fileName: file.name,
        fileType: file.type || "text/plain",
        fileSizeBytes: buffer.length,
        storageKey: rawRecordId ? `usage:raw_green_button:${rawRecordId}` : null,
        parseStatus: "processing",
        parseMessage: null,
        dateRangeStart: null,
        dateRangeEnd: null,
        intervalMinutes: null,
      },
      select: { id: true },
    });
    uploadRecordId = uploadRecord.id;

    if (!rawRecordId) {
      return NextResponse.json({ ok: false, error: "raw_persist_failed" }, { status: 500 });
    }

    const houseMeta = houseId
      ? await prisma.houseAddress.findUnique({ where: { id: houseId }, select: { esiid: true } })
      : null;

    const cleanupTasks: Array<Promise<unknown>> = [];
    if (houseId) {
      cleanupTasks.push(
        (usagePrisma as any).greenButtonInterval.deleteMany({ where: { homeId: houseId, rawId: { not: rawRecordId } } }),
      );
      cleanupTasks.push(
        (usagePrisma as any).rawGreenButton.deleteMany({ where: { homeId: houseId, NOT: { id: rawRecordId } } }),
      );
      cleanupTasks.push(
        (prisma as any).greenButtonUpload.deleteMany({ where: { houseId, NOT: { id: uploadRecordId } } }),
      );
    }
    await Promise.all(cleanupTasks);

    const intervalData = trimmed.map((interval) => ({
      rawId: rawRecordId,
      homeId: houseId,
      userId,
      timestamp: interval.timestamp,
      consumptionKwh: new Prisma.Decimal(interval.consumptionKwh),
      intervalMinutes: interval.intervalMinutes,
    }));

    const BATCH_SIZE = 1000;
    for (let i = 0; i < intervalData.length; i += BATCH_SIZE) {
      const slice = intervalData.slice(i, i + BATCH_SIZE);
      if (slice.length === 0) continue;
      await (usagePrisma as any).greenButtonInterval.createMany({ data: slice });
    }

    const totalKwh = trimmed.reduce((sum, row) => sum + row.consumptionKwh, 0);
    const earliest = trimmed[0]?.timestamp ?? null;
    const latest = trimmed[trimmed.length - 1]?.timestamp ?? null;

    if (uploadRecordId) {
      const summary = {
        format: parsed.format,
        totalRawReadings: parsed.metadata.totalReadings,
        normalizedIntervals: trimmed.length,
        totalKwh: Number(totalKwh.toFixed(6)),
        appliedWindowDays: MANUAL_USAGE_LIFETIME_DAYS,
        warnings: parsed.warnings,
      };

      await (prisma as any).greenButtonUpload.update({
        where: { id: uploadRecordId },
        data: {
          parseStatus: parsed.warnings.length > 0 ? "complete_with_warnings" : "complete",
          parseMessage: JSON.stringify(summary),
          dateRangeStart: earliest,
          dateRangeEnd: latest,
          intervalMinutes: 15,
        },
      });
    }

    const now = new Date();
    const coverageEnd = latest ?? latestTimestamp ?? now;
    const expiresAt = new Date(coverageEnd.getTime());
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const manualUsage = await (prisma as any).manualUsageUpload.create({
      data: {
        userId,
        houseId,
        source: "green_button",
        expiresAt,
        metadata: {
          rawGreenButtonId: rawRecordId,
          uploadId: uploadRecordId,
          utilityName,
          accountNumber,
        },
      },
      select: { id: true },
    });

    const existingEntry = await prisma.entry.findFirst({
      where: { userId, houseId, type: "smart_meter_connect" },
      select: { id: true, amount: true },
    });

    if (existingEntry) {
      await prisma.entry.update({
        where: { id: existingEntry.id },
        data: {
          amount: Math.max(existingEntry.amount, 1),
          manualUsageId: manualUsage.id,
          status: EntryStatus.ACTIVE,
          expiresAt: null,
          expirationReason: null,
          lastValidated: now,
        },
      });
    } else {
      await prisma.entry.create({
        data: {
          userId,
          houseId,
          type: "smart_meter_connect",
          amount: 1,
          manualUsageId: manualUsage.id,
          status: EntryStatus.ACTIVE,
          lastValidated: now,
        },
      });
    }

    await refreshUserEntryStatuses(userId);
    await qualifyReferralsForUser(userId);

    return NextResponse.json({
      ok: true,
      rawId: rawRecordId,
      uploadId: uploadRecordId,
      intervalsCreated: trimmed.length,
      totalKwh,
      warnings: parsed.warnings,
      dateRangeStart: earliest,
      dateRangeEnd: latest,
    });
  } catch (error) {
    console.error("[admin/green-button/upload] failed", error);

    if (uploadRecordId) {
      try {
        await (prisma as any).greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "error",
            parseMessage: String((error as Error)?.message || error),
          },
        });
      } catch (err) {
        console.error("[admin/green-button/upload] failed to persist error state", err);
      }
    }

    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 500 });
  }
}

