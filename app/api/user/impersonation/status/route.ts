import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ImpersonationPayload = {
  v?: number;
  auditId?: string;
  adminEmail?: string;
  targetEmail?: string;
  originalUserEmail?: string | null;
  expiresAt?: string;
};

export async function GET(req: NextRequest) {
  const raw = req.cookies.get("intelliwatt_impersonation")?.value ?? "";
  if (!raw.trim()) {
    return NextResponse.json({ ok: true, impersonating: false });
  }

  let payload: ImpersonationPayload | null = null;
  try {
    payload = JSON.parse(raw) as ImpersonationPayload;
  } catch {
    payload = null;
  }

  const expiresAtIso = typeof payload?.expiresAt === "string" ? payload.expiresAt : null;
  const expiresAt = expiresAtIso ? new Date(expiresAtIso) : null;
  const isExpired = expiresAt ? Number.isFinite(expiresAt.getTime()) && Date.now() > expiresAt.getTime() : false;

  if (!payload || isExpired) {
    // Best-effort clear if malformed or expired.
    const res = NextResponse.json({ ok: true, impersonating: false });
    res.cookies.set({ name: "intelliwatt_impersonation", value: "", expires: new Date(0), path: "/" });
    return res;
  }

  return NextResponse.json({
    ok: true,
    impersonating: true,
    auditId: typeof payload.auditId === "string" ? payload.auditId : null,
    adminEmail: typeof payload.adminEmail === "string" ? payload.adminEmail : null,
    targetEmail: typeof payload.targetEmail === "string" ? payload.targetEmail : null,
    expiresAt: expiresAtIso,
  });
}

