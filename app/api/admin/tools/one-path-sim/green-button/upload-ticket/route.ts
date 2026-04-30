import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db";
import { resolveOnePathWriteTarget } from "../../_helpers";

const DEFAULT_EXPIRATION_MS = 10 * 60 * 1000;

function base64UrlEncode(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const uploadUrl =
      process.env.GREEN_BUTTON_UPLOAD_URL ?? process.env.NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL ?? null;
    if (!uploadUrl) {
      return NextResponse.json({ ok: false, error: "green_button_upload_unavailable" }, { status: 503 });
    }

    const secret = process.env.GREEN_BUTTON_UPLOAD_SECRET;
    if (!secret) {
      return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedHouseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    const target = await resolveOnePathWriteTarget({ request, requestedHouseId });
    if (!target.ok) return target.response;

    const house = await prisma.houseAddress.findFirst({
      where: {
        id: target.testHomeHouseId,
        userId: target.ownerUserId,
        archivedAt: null,
      },
      select: {
        id: true,
        userId: true,
        utilityName: true,
      },
    });

    if (!house?.id || !house.userId) {
      return NextResponse.json({ ok: false, error: "test_home_not_found" }, { status: 404 });
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + DEFAULT_EXPIRATION_MS);
    const payload = {
      v: 1,
      userId: house.userId,
      houseId: house.id,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    const payloadEncoded = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
    const signature = createHmac("sha256", secret).update(payloadEncoded).digest("hex");

    return NextResponse.json({
      ok: true,
      uploadUrl,
      payload: payloadEncoded,
      signature,
      maxBytes: Number(process.env.GREEN_BUTTON_UPLOAD_MAX_BYTES || 500 * 1024 * 1024),
      expiresAt: payload.expiresAt,
      houseId: house.id,
      utilityName: house.utilityName ?? null,
      admin: true,
    });
  } catch (error) {
    console.error("[one-path/green-button/upload-ticket] failed", error);
    return NextResponse.json({ ok: false, error: "ticket_failed" }, { status: 500 });
  }
}
