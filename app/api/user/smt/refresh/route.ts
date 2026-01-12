import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getRollingBackfillRange, requestSmtBackfillForAuthorization } from "@/lib/smt/agreements";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const rawEmail = cookieStore.get("intelliwatt_user")?.value;

    if (!rawEmail) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const email = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const prismaAny = prisma as any;

    const auths = await prismaAny.smtAuthorization.findMany({
      where: {
        userId: user.id,
        archivedAt: null,
        smtStatus: "ACTIVE",
      },
      select: {
        id: true,
        esiid: true,
        meterNumber: true,
        smtBackfillRequestedAt: true,
      },
    });

    if (!auths || auths.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No active SMT authorizations" },
        { status: 404 },
      );
    }

    const { startDate, endDate } = getRollingBackfillRange(12);

    const results: Array<{ id: string; ok: boolean; message?: string }> = [];

    for (const auth of auths) {
      if (auth.smtBackfillRequestedAt) {
        results.push({
          id: auth.id,
          ok: true,
          message: "backfill_skipped:already_requested",
        });
        continue;
      }
      const res = await requestSmtBackfillForAuthorization({
        authorizationId: auth.id,
        esiid: auth.esiid,
        meterNumber: auth.meterNumber,
        startDate,
        endDate,
      });

      if (res.ok) {
        await prismaAny.smtAuthorization.update({
          where: { id: auth.id },
          data: {
            smtBackfillRequestedAt: new Date(),
          },
        });
      }

      results.push({ id: auth.id, ok: res.ok, message: res.message });
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("[user/smt/refresh] failed to request SMT backfill", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
