import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { normalizeEmail, normalizeEmailSafe } from "@/lib/utils/email";

export const dynamic = "force-dynamic";

function getClientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xr = req.headers.get("x-real-ip")?.trim();
  if (xr) return xr;
  return null;
}

type ImpersonationPayload = {
  v?: number;
  auditId?: string;
  adminEmail?: string;
  targetEmail?: string;
  originalUserEmail?: string | null;
  expiresAt?: string;
};

export async function POST(req: NextRequest) {
  // NOTE: Stopping impersonation should always be possible, even if the feature is disabled.

  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ ok: false, ...gate.body }, { status: gate.status });

  const adminEmailRaw = (req.cookies.get("intelliwatt_admin")?.value ?? "").trim();
  if (!adminEmailRaw) {
    return NextResponse.json({ ok: false, error: "Admin session cookie missing" }, { status: 401 });
  }
  const adminEmail = normalizeEmail(adminEmailRaw);

  const cookie = req.cookies.get("intelliwatt_impersonation")?.value ?? "";
  if (!cookie.trim()) {
    return NextResponse.json({ ok: false, error: "Not currently impersonating" }, { status: 400 });
  }

  let payload: ImpersonationPayload | null = null;
  try {
    payload = JSON.parse(cookie) as ImpersonationPayload;
  } catch {
    payload = null;
  }

  // `normalizeEmail()` throws on empty; cookie payload may be missing/empty.
  const payloadAdmin = normalizeEmailSafe(typeof payload?.adminEmail === "string" ? payload.adminEmail : null);
  if (!payloadAdmin) {
    return NextResponse.json({ ok: false, error: "Invalid impersonation cookie payload" }, { status: 400 });
  }
  if (payloadAdmin !== adminEmail) {
    return NextResponse.json({ ok: false, error: "Impersonation cookie does not match this admin" }, { status: 403 });
  }

  const stopIp = getClientIp(req);
  const stopUserAgent = req.headers.get("user-agent")?.trim() || null;
  const endedAt = new Date();

  const auditId = typeof payload?.auditId === "string" ? payload.auditId.trim() : "";
  if (auditId) {
    try {
      await db.adminImpersonationAudit.update({
        where: { id: auditId },
        data: {
          endedAt,
          stopIp,
          stopUserAgent,
        },
      });
    } catch {
      // ignore missing/invalid audit id
    }
  }

  const originalUserEmail =
    typeof payload?.originalUserEmail === "string" && payload.originalUserEmail.trim()
      ? normalizeEmail(payload.originalUserEmail.trim())
      : null;

  const res = NextResponse.json({ ok: true, restoredUserEmail: originalUserEmail });

  if (originalUserEmail) {
    res.cookies.set({
      name: "intelliwatt_user",
      value: originalUserEmail,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  } else {
    res.cookies.set({
      name: "intelliwatt_user",
      value: "",
      expires: new Date(0),
      path: "/",
    });
  }

  res.cookies.set({
    name: "intelliwatt_impersonation",
    value: "",
    expires: new Date(0),
    path: "/",
  });

  return res;
}

