import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { hasSmtIntervalsInCanonicalWindow } from "@/lib/usage/actualDatasetForHouse";
import { ensureSmtCoverageForHouse } from "@/lib/usage/ensureSmtCoverage";
import { clearGreenButtonUsageForHouse } from "@/lib/usage/greenButtonHouseCleanup";
import { getOnePathLabTestHomeLink } from "@/modules/usageSimulator/labTestHome";
import {
  resolveUserUsageSessionKey,
  USER_USAGE_SESSION_COOKIE,
} from "@/lib/usage/userUsageSessionKey";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ensure Node runtime for longer executions
/** User refresh runs ensure + bounded pull; keep under Vercel cap (vercel.json also sets 60). */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  if (!sessionEmail) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const normalizedEmail = normalizeEmail(sessionEmail);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestedHomeId =
    typeof body?.homeId === "string" && body.homeId.trim().length > 0
      ? body.homeId.trim()
      : null;

  if (!requestedHomeId) {
    return NextResponse.json(
      { ok: false, error: "home_id_required", message: "homeId is required to refresh usage." },
      { status: 400 }
    );
  }

  const sessionKey = resolveUserUsageSessionKey({
    userId: user.id,
    request: req,
    cookieValue: cookieStore.get(USER_USAGE_SESSION_COOKIE)?.value ?? null,
  });

  const ensure = await ensureSmtCoverageForHouse({
    userId: user.id,
    houseId: requestedHomeId,
    profile: "user_session",
    sessionKey,
    force: true,
  });

  if (ensure.skippedReason === "no_esiid") {
    return NextResponse.json(
      { ok: false, error: "home_not_found", message: "Home is missing an ESIID for SMT refresh." },
      { status: 404 }
    );
  }

  const refreshResult = ensure.refreshResult;
  if (refreshResult && refreshResult.ok === false) {
    return NextResponse.json(
      {
        ok: false,
        error: refreshResult.error,
        ...(refreshResult.message ? { message: refreshResult.message } : {}),
        ensure,
      },
      { status: refreshResult.error === "home_not_found" ? 404 : 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    homes: refreshResult?.ok ? refreshResult.homes : [],
    backfill: refreshResult?.ok ? refreshResult.backfill : [],
    ensure,
    greenButtonCleared,
  });
}
