import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { normalizeEmail } from "@/lib/utils/email";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB safety limit

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
          error: "File too large for direct upload. Please contact support for assistance.",
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

    const rawRecord = await usagePrisma.rawGreenButton.create({
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
    });

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

    return NextResponse.json(
      {
        ok: true,
        rawId: rawRecord.id,
        uploadId: uploadRecord.id,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[green-button/upload] failed", error);
    return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 500 });
  }
}