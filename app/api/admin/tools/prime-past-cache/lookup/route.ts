/**
 * GET ?email=... — returns houseId and scenarioId (Past) for the user's first house.
 * Used to prefill the prime-past-cache form. Requires x-admin-token.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";

const WORKSPACE_PAST_NAME = "Past (Corrected)";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const email = String(req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "email_required", message: "Provide email query parameter." },
      { status: 400 }
    );
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "user_not_found", message: "No user with that email." },
      { status: 404 }
    );
  }

  const houses = await (prisma as any).houseAddress.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, addressLine1: true, addressCity: true, addressState: true },
  });
  if (!houses?.length) {
    return NextResponse.json(
      { ok: false, error: "no_houses", message: "User has no houses." },
      { status: 404 }
    );
  }

  const house = houses[0];
  const scenario = await (prisma as any).usageSimulatorScenario.findFirst({
    where: {
      userId: user.id,
      houseId: house.id,
      name: WORKSPACE_PAST_NAME,
      archivedAt: null,
    },
    select: { id: true },
  });

  const houseLabel = [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id;

  return NextResponse.json({
    ok: true,
    email: user.email,
    houseId: house.id,
    scenarioId: scenario?.id ?? null,
    houseLabel,
    message: scenario ? undefined : "No Past (Corrected) scenario for this house. Create it in the simulator first.",
  });
}
