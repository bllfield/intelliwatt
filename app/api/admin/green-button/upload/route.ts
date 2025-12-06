import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseGreenButtonBuffer } from "@/lib/usage/greenButtonParser";
import { normalizeGreenButtonReadingsTo15Min } from "@/lib/usage/greenButtonNormalize";
import { usagePrisma } from "@/lib/db/usageClient";

export const dynamic = "force-dynamic";

const MANUAL_USAGE_LIFETIME_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
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
      if (houseMeta?.esiid) {
        cleanupTasks.push(prisma.smtInterval.deleteMany({ where: { esiid: houseMeta.esiid } }));
      }
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

    return NextResponse.json({
      ok: true,
      rawId: rawRecordId,
      intervalsCreated: trimmed.length,
      totalKwh,
      warnings: parsed.warnings,
    });
  } catch (error) {
    console.error("[admin/green-button/upload] failed", error);
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 500 });
  }
}

