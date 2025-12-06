import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { EntryStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { refreshUserEntryStatuses } from "@/lib/hitthejackwatt/entryLifecycle";
import { normalizeEmail } from "@/lib/utils/email";

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
        parseStatus: "pending",
        parseMessage: null,
      },
    });

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
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[green-button/upload] failed", error);
    return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 500 });
  }
}