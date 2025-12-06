import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { EntryStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { refreshUserEntryStatuses } from "@/lib/hitthejackwatt/entryLifecycle";
import { normalizeEmail } from "@/lib/utils/email";
import { parseGreenButtonBuffer } from "@/lib/usage/greenButtonParser";
import { normalizeGreenButtonReadingsTo15Min } from "@/lib/usage/greenButtonNormalize";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB safety limit
const MANUAL_USAGE_LIFETIME_DAYS = 365;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const normalizedEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const homeIdRaw = formData.get("homeId");
    const utilityNameRaw = formData.get("utilityName");
    const accountNumberRaw = formData.get("accountNumber");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    if (!homeIdRaw || typeof homeIdRaw !== "string" || homeIdRaw.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "Missing homeId" }, { status: 400 });
    }

    const homeId = homeIdRaw.trim();
    const house = await prisma.houseAddress.findFirst({
      where: { id: homeId, userId: user.id, archivedAt: null },
      select: { id: true, utilityName: true },
    });

    if (!house) {
      return NextResponse.json({ ok: false, error: "Home not found" }, { status: 404 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "File exceeds the 10 MB upload limit. Please trim the export and try again.",
        },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    const utilityName =
      typeof utilityNameRaw === "string" && utilityNameRaw.trim().length > 0
        ? utilityNameRaw.trim()
        : house.utilityName ?? null;
    const accountNumber =
      typeof accountNumberRaw === "string" && accountNumberRaw.trim().length > 0
        ? accountNumberRaw.trim()
        : null;
    const mimeType = file.type && file.type.length > 0 ? file.type : "application/xml";

    let rawRecord: { id: string } | null = null;
    try {
      rawRecord = await usagePrisma.rawGreenButton.create({
        data: {
          homeId: house.id,
          userId: user.id,
          utilityName,
          accountNumber,
          filename: file.name,
          mimeType,
          sizeBytes: buffer.length,
          content: buffer,
          sha256,
        },
        select: { id: true },
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const existing = await usagePrisma.rawGreenButton.findUnique({
          where: { sha256 },
          select: { id: true },
        });
        if (!existing) {
          throw error;
        }
        rawRecord = existing;
      } else {
        throw error;
      }
    }

    const uploadRecord = await (prisma as any).greenButtonUpload.create({
      data: {
        houseId: house.id,
        utilityName,
        accountNumber,
        fileName: file.name,
        fileType: mimeType,
        fileSizeBytes: buffer.length,
        storageKey: `usage:raw_green_button:${rawRecord.id}`,
        parseStatus: "processing",
        parseMessage: null,
        dateRangeStart: null,
        dateRangeEnd: null,
        intervalMinutes: null,
      },
    });

    let parsedSummary: Record<string, unknown> | null = null;

    try {
      const parsed = parseGreenButtonBuffer(buffer, file.name);

      if (parsed.errors.length > 0) {
        await (prisma as any).greenButtonUpload.update({
          where: { id: uploadRecord.id },
          data: {
            parseStatus: "error",
            parseMessage: parsed.errors.join("; "),
          },
        });

        return NextResponse.json({ ok: false, error: parsed.errors.join("; ") }, { status: 422 });
      }

      if (parsed.readings.length === 0) {
        await (prisma as any).greenButtonUpload.update({
          where: { id: uploadRecord.id },
          data: {
            parseStatus: "empty",
            parseMessage: "File parsed but no interval data was found.",
          },
        });

        return NextResponse.json({ ok: false, error: "no_readings" }, { status: 422 });
      }

      const normalized = normalizeGreenButtonReadingsTo15Min(parsed.readings);
      if (normalized.length === 0) {
        await (prisma as any).greenButtonUpload.update({
          where: { id: uploadRecord.id },
          data: {
            parseStatus: "empty",
            parseMessage: "Readings were parsed but could not be normalized to 15-minute intervals.",
          },
        });

        return NextResponse.json({ ok: false, error: "normalization_empty" }, { status: 422 });
      }

      const intervalData = normalized.map((interval) => ({
        rawId: rawRecord.id,
        homeId: house.id,
        userId: user.id,
        timestamp: interval.timestamp,
        consumptionKwh: new Prisma.Decimal(interval.consumptionKwh),
        intervalMinutes: interval.intervalMinutes,
      }));

      // Postgres parameter limit (~65k) can be exceeded on year-long files; insert in batches to avoid failure.
      const BATCH_SIZE = 4000;

      await usagePrisma.$transaction(async (tx) => {
        await (tx as any).greenButtonInterval.deleteMany({ where: { rawId: rawRecord.id } });

        for (let i = 0; i < intervalData.length; i += BATCH_SIZE) {
          const slice = intervalData.slice(i, i + BATCH_SIZE);
          if (slice.length === 0) continue;
          await (tx as any).greenButtonInterval.createMany({ data: slice });
        }
      });

      const totalKwh = normalized.reduce((sum, row) => sum + row.consumptionKwh, 0);
      const earliest = normalized[0]?.timestamp ?? null;
      const latest = normalized[normalized.length - 1]?.timestamp ?? null;

      parsedSummary = {
        format: parsed.format,
        totalRawReadings: parsed.metadata.totalReadings,
        normalizedIntervals: normalized.length,
        totalKwh: Number(totalKwh.toFixed(6)),
        warnings: parsed.warnings,
      };

      await (prisma as any).greenButtonUpload.update({
        where: { id: uploadRecord.id },
        data: {
          parseStatus: parsed.warnings.length > 0 ? "complete_with_warnings" : "complete",
          parseMessage: JSON.stringify(parsedSummary),
          dateRangeStart: earliest,
          dateRangeEnd: latest,
          intervalMinutes: 15,
        },
      });
    } catch (parseErr) {
      await (prisma as any).greenButtonUpload.update({
        where: { id: uploadRecord.id },
        data: {
          parseStatus: "error",
          parseMessage: String((parseErr as Error)?.message || parseErr),
        },
      });

      throw parseErr;
    }

    // Award / refresh the usage entry using a ManualUsageUpload placeholder so it expires after 12 months
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MANUAL_USAGE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

    const manualUsage = await (prisma as any).manualUsageUpload.create({
      data: {
        userId: user.id,
        houseId: house.id,
        source: "green_button",
        expiresAt,
        metadata: {
          rawGreenButtonId: rawRecord.id,
          uploadId: uploadRecord.id,
          utilityName,
          accountNumber,
          summary: parsedSummary,
        },
      },
      select: { id: true },
    });

    const existingEntry = await prisma.entry.findFirst({
      where: { userId: user.id, houseId: house.id, type: "smart_meter_connect" },
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
          userId: user.id,
          houseId: house.id,
          type: "smart_meter_connect",
          amount: 1,
          manualUsageId: manualUsage.id,
          status: EntryStatus.ACTIVE,
          lastValidated: now,
        },
      });
    }

    await refreshUserEntryStatuses(user.id);

    return NextResponse.json(
      {
        ok: true,
        rawId: rawRecord.id,
        uploadId: uploadRecord.id,
        entryAwarded: true,
        parseSummary: parsedSummary,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[green-button/upload] failed", error);
    return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 500 });
  }
}