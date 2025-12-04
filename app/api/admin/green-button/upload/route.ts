import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { parseGreenButtonBuffer } from "@/lib/usage/greenButtonParser";
import { normalizeGreenButtonReadingsTo15Min } from "@/lib/usage/greenButtonNormalize";
import { usagePrisma } from "@/lib/db/usageClient";

export const dynamic = "force-dynamic";

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

    const normalized = normalizeGreenButtonReadingsTo15Min(parsed.readings);
    if (normalized.length === 0) {
      return NextResponse.json({ ok: false, error: "normalization_empty" }, { status: 400 });
    }

    const digest = createHash("sha256").update(buffer).digest("hex");

    let rawRecordId: string | null = null;
    try {
      const created = await usagePrisma.rawGreenButton.create({
        data: {
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

    await (usagePrisma as any).greenButtonInterval.deleteMany({ where: { rawId: rawRecordId } });

    const intervalData = normalized.map((interval) => ({
      rawId: rawRecordId,
      timestamp: interval.timestamp,
      consumptionKwh: new Prisma.Decimal(interval.consumptionKwh),
      intervalMinutes: interval.intervalMinutes,
    }));

    await (usagePrisma as any).greenButtonInterval.createMany({
      data: intervalData,
    });

    const totalKwh = normalized.reduce((sum, row) => sum + row.consumptionKwh, 0);

    return NextResponse.json({
      ok: true,
      rawId: rawRecordId,
      intervalsCreated: normalized.length,
      totalKwh,
      warnings: parsed.warnings,
    });
  } catch (error) {
    console.error("[admin/green-button/upload] failed", error);
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 500 });
  }
}

