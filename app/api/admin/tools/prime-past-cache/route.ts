/**
 * Admin-only: prime the Past simulated dataset cache for a house+scenario.
 * Calls the same path as the user GET (getSimulatedUsageForHouseScenario); on success
 * the dataset is built and saved to cache so the next user request is a cache hit.
 *
 * Use when usage was already pulled but the house never had a successful Past load
 * (e.g. request timed out before save). Requires x-admin-token header.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: { houseId?: string; scenarioId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const houseId = String(body?.houseId ?? "").trim();
  const scenarioId = String(body?.scenarioId ?? "").trim();
  if (!houseId || !scenarioId) {
    return NextResponse.json(
      { ok: false, error: "houseId and scenarioId required", message: "Provide houseId and scenarioId (Past scenario UUID)." },
      { status: 400 }
    );
  }

  const house = await prisma.houseAddress.findFirst({
    where: { id: houseId, archivedAt: null },
    select: { id: true, userId: true },
  });
  if (!house) {
    return NextResponse.json(
      { ok: false, error: "house_not_found", message: "No house found for that houseId." },
      { status: 404 }
    );
  }

  const out = await getSimulatedUsageForHouseScenario({
    userId: house.userId,
    houseId: house.id,
    scenarioId,
  });

  if (out.ok) {
    return NextResponse.json({
      ok: true,
      message: "Past dataset built and written to cache. Next user request for this house+scenario will use cache.",
      houseId: out.houseId,
      scenarioId,
    });
  }

  if (out.code === "NO_BUILD") {
    return NextResponse.json(
      { ok: false, error: "no_build", message: "No baseline build for this house. Run simulator build first." },
      { status: 404 }
    );
  }
  if (out.code === "SCENARIO_NOT_FOUND") {
    return NextResponse.json(
      { ok: false, error: "scenario_not_found", message: "Scenario not found. Use the Past scenario UUID from the simulator." },
      { status: 404 }
    );
  }
  if (out.code === "HOUSE_NOT_FOUND") {
    return NextResponse.json(
      { ok: false, error: "house_not_found", message: "House not found for user." },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "build_failed",
      message: out.message ?? "Past build failed.",
      inputHash: (out as any).inputHash,
      engineVersion: (out as any).engineVersion,
    },
    { status: 500 }
  );
}
