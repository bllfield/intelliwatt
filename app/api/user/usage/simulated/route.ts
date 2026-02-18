import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getSimulatedUsageForUser } from "@/modules/usageSimulator/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = cookies();
    const rawEmail = cookieStore.get("intelliwatt_user")?.value;
    if (!rawEmail) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const userEmail = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const out = await getSimulatedUsageForUser({ userId: user.id });
    if (!out.ok) return NextResponse.json(out, { status: 500 });

    return NextResponse.json(out, {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (error) {
    console.error("[user/usage/simulated] failed", error);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

