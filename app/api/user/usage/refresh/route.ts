import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { requestUsageRefreshForUserHouse } from "@/lib/usage/userUsageRefresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ensure Node runtime for longer executions
export const maxDuration = 30;

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

  const result = await requestUsageRefreshForUserHouse({
    userId: user.id,
    houseId: requestedHomeId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status: result.error === "home_not_found" ? 404 : 500 }
    );
  }

  return NextResponse.json(result);
}

