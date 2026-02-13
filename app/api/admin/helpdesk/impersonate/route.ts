import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { normalizeEmail } from "@/lib/utils/email";

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

function isEnabled(): boolean {
  const v = String(process.env.HELPDESK_IMPERSONATION_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

type Body = {
  email?: string;
  reason?: string;
  durationMinutes?: number;
};

export async function POST(req: NextRequest) {
  if (!isEnabled()) {
    return NextResponse.json({ ok: false, error: "Help desk impersonation is disabled" }, { status: 404 });
  }

  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ ok: false, ...gate.body }, { status: gate.status });

  const adminEmail = req.cookies.get("intelliwatt_admin")?.value ?? "";
  if (!adminEmail.trim()) {
    return NextResponse.json({ ok: false, error: "Admin session cookie missing" }, { status: 401 });
  }

  let body: Body | null = null;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = null;
  }

  const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const durationMinutesRaw = Number(body?.durationMinutes ?? 30);

  if (!rawEmail) {
    return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ ok: false, error: "Missing reason" }, { status: 400 });
  }

  const durationMinutes = Math.max(5, Math.min(120, Math.floor(durationMinutesRaw || 30)));
  const targetEmail = normalizeEmail(rawEmail);
  const originalUserEmail = (req.cookies.get("intelliwatt_user")?.value ?? "").trim() || null;
  const startIp = getClientIp(req);
  const startUserAgent = req.headers.get("user-agent")?.trim() || null;

  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  // Ensure user exists (match login behavior).
  const existingUser = await db.user.findUnique({
    where: { email: targetEmail },
    select: { id: true, email: true },
  });
  if (!existingUser) {
    await db.user.create({ data: { email: targetEmail } });
  }

  const audit = await db.adminImpersonationAudit.create({
    data: {
      adminEmail: normalizeEmail(adminEmail),
      targetEmail,
      reason,
      originalUserEmail,
      durationMinutes,
      expiresAt,
      startIp,
      startUserAgent,
    },
    select: { id: true },
  });

  const payload = {
    v: 1,
    auditId: audit.id,
    adminEmail: normalizeEmail(adminEmail),
    targetEmail,
    originalUserEmail,
    expiresAt: expiresAt.toISOString(),
  };

  const res = NextResponse.json({ ok: true, auditId: audit.id, targetEmail, expiresAt: payload.expiresAt });

  res.cookies.set({
    name: "intelliwatt_user",
    value: targetEmail,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: durationMinutes * 60,
  });

  res.cookies.set({
    name: "intelliwatt_impersonation",
    value: JSON.stringify(payload),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: durationMinutes * 60,
  });

  return res;
}

