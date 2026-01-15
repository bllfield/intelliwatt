import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/auth/requireAdmin";
import { getRollingBackfillRange, requestSmtBackfillForAuthorization } from "@/lib/smt/agreements";

export const dynamic = "force-dynamic";

type Body = {
  esiid?: string;
  authorizationId?: string;
  // If true (default), request backfill immediately after resetting flags.
  request?: boolean;
};

function cleanEsiid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "").trim();
  return digits.length >= 17 ? digits : null;
}

export async function POST(req: NextRequest) {
  const unauthorized = guardAdmin(req);
  if (unauthorized) return unauthorized;

  const body = (await req.json().catch(() => null)) as Body | null;
  const authorizationId = typeof body?.authorizationId === "string" ? body.authorizationId.trim() : "";
  const esiid = cleanEsiid(body?.esiid);
  const doRequest = body?.request === false ? false : true;

  if (!authorizationId && !esiid) {
    return NextResponse.json(
      { ok: false, error: "authorizationId_or_esiid_required" },
      { status: 400 },
    );
  }

  const prismaAny = prisma as any;

  const auth =
    authorizationId
      ? await prismaAny.smtAuthorization.findUnique({
          where: { id: authorizationId },
          select: {
            id: true,
            esiid: true,
            meterNumber: true,
            smtStatus: true,
            emailConfirmationStatus: true,
            smtBackfillRequestedAt: true,
            smtBackfillCompletedAt: true,
            archivedAt: true,
            createdAt: true,
          },
        })
      : await prismaAny.smtAuthorization.findFirst({
          where: {
            archivedAt: null,
            esiid,
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            esiid: true,
            meterNumber: true,
            smtStatus: true,
            emailConfirmationStatus: true,
            smtBackfillRequestedAt: true,
            smtBackfillCompletedAt: true,
            archivedAt: true,
            createdAt: true,
          },
        });

  if (!auth || auth.archivedAt) {
    return NextResponse.json(
      { ok: false, error: "authorization_not_found" },
      { status: 404 },
    );
  }

  const before = {
    id: String(auth.id),
    esiid: String(auth.esiid ?? ""),
    smtStatus: auth.smtStatus ?? null,
    emailConfirmationStatus: auth.emailConfirmationStatus ?? null,
    smtBackfillRequestedAt: auth.smtBackfillRequestedAt ? new Date(auth.smtBackfillRequestedAt).toISOString() : null,
    smtBackfillCompletedAt: auth.smtBackfillCompletedAt ? new Date(auth.smtBackfillCompletedAt).toISOString() : null,
  };

  await prismaAny.smtAuthorization.update({
    where: { id: auth.id },
    data: {
      smtBackfillRequestedAt: null,
      smtBackfillCompletedAt: null,
    },
  });

  let requestResult: any = null;
  if (doRequest) {
    const statusNorm = String(auth.smtStatus ?? "").trim().toLowerCase();
    const isActive = statusNorm === "active" || statusNorm === "already_active";

    if (!isActive) {
      requestResult = { ok: false, message: "backfill_skipped:not_active", smtStatus: auth.smtStatus ?? null };
    } else {
      const range = getRollingBackfillRange(12);
      const res = await requestSmtBackfillForAuthorization({
        authorizationId: auth.id,
        esiid: auth.esiid,
        meterNumber: auth.meterNumber ?? null,
        startDate: range.startDate,
        endDate: range.endDate,
      });
      requestResult = res;
      if (res.ok) {
        await prismaAny.smtAuthorization.update({
          where: { id: auth.id },
          data: { smtBackfillRequestedAt: new Date() },
        });
      }
    }
  }

  const afterAuth = await prismaAny.smtAuthorization.findUnique({
    where: { id: auth.id },
    select: { smtBackfillRequestedAt: true, smtBackfillCompletedAt: true },
  });

  const after = {
    smtBackfillRequestedAt: afterAuth?.smtBackfillRequestedAt
      ? new Date(afterAuth.smtBackfillRequestedAt).toISOString()
      : null,
    smtBackfillCompletedAt: afterAuth?.smtBackfillCompletedAt
      ? new Date(afterAuth.smtBackfillCompletedAt).toISOString()
      : null,
  };

  return NextResponse.json({
    ok: true,
    before,
    after,
    request: requestResult,
  });
}

