import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";

const DEFAULT_EXPIRATION_MS = 10 * 60 * 1000;

function base64UrlEncode(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function POST(request: Request) {
  try {
    const uploadUrl =
      process.env.GREEN_BUTTON_UPLOAD_URL ?? process.env.NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL ?? null;
    if (!uploadUrl) {
      return NextResponse.json(
        { ok: false, error: "green_button_upload_unavailable" },
        { status: 503 },
      );
    }

    const secret = process.env.GREEN_BUTTON_UPLOAD_SECRET;
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: "server_not_configured" },
        { status: 500 },
      );
    }

    const cookieStore = cookies();
    const sessionEmailRaw = cookieStore.get("intelliwatt_user")?.value ?? null;
    const adminCookie = cookieStore.get("intelliwatt_admin")?.value ?? null;
    const headerAdminToken = request.headers.get("x-admin-token");
    const configuredAdminToken = process.env.ADMIN_TOKEN ?? null;
    const hasAdminHeader =
      Boolean(configuredAdminToken) &&
      Boolean(headerAdminToken) &&
      headerAdminToken === configuredAdminToken;
    const isAdminSession = Boolean(adminCookie) || hasAdminHeader;

    let user: { id: string; email: string } | null = null;
    if (sessionEmailRaw) {
      const normalizedEmail = normalizeEmail(sessionEmailRaw);
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true },
      });
    }

    if (!user && !isAdminSession) {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401 },
      );
    }

    let body: { homeId?: string | null } = {};
    try {
      body = (await request.json()) as { homeId?: string | null };
    } catch {
      // Keep empty body; we'll validate below.
    }

    const homeId = typeof body.homeId === "string" && body.homeId.trim().length > 0 ? body.homeId.trim() : null;
    if (!homeId) {
      return NextResponse.json(
        { ok: false, error: "home_id_required" },
        { status: 400 },
      );
    }

    const house = await prisma.houseAddress.findFirst({
      where: isAdminSession
        ? { id: homeId }
        : {
            id: homeId,
            userId: user!.id,
            archivedAt: null,
          },
      select: {
        id: true,
        userId: true,
        utilityName: true,
        archivedAt: true,
      },
    });

    if (!house) {
      return NextResponse.json(
        { ok: false, error: "home_not_found" },
        { status: 404 },
      );
    }

    if (!house.userId) {
      return NextResponse.json(
        { ok: false, error: "house_missing_owner" },
        { status: 500 },
      );
    }

    if (!isAdminSession && house.archivedAt) {
      return NextResponse.json(
        { ok: false, error: "home_archived" },
        { status: 404 },
      );
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

    const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf8");
    const payloadEncoded = base64UrlEncode(payloadBuffer);
    const signature = createHmac("sha256", secret).update(payloadEncoded).digest("hex");

    return NextResponse.json({
      ok: true,
      uploadUrl,
      payload: payloadEncoded,
      signature,
      maxBytes: Number(process.env.GREEN_BUTTON_UPLOAD_MAX_BYTES || 10 * 1024 * 1024),
      expiresAt: payload.expiresAt,
      houseId: house.id,
      utilityName: house.utilityName ?? null,
      admin: isAdminSession,
    });
  } catch (error) {
    console.error("[green-button/upload-ticket] failed", error);
    return NextResponse.json(
      { ok: false, error: "ticket_failed" },
      { status: 500 },
    );
  }
}

