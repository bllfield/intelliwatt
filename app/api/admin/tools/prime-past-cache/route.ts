/**
 * Admin-only: prime the Past simulated dataset cache for a house+scenario.
 * Calls the same path as the user GET (getSimulatedUsageForHouseScenario); on success
 * the dataset is built and saved to cache (INTERVAL_CODEC_V1 / v1_delta_varint) so the
 * next user request is a cache hit.
 *
 * Use when usage was already pulled but the house never had a successful Past load
 * (e.g. request timed out before save). Auth: session cookie (intelliwatt_admin) or x-admin-token header.
 *
 * If the cache is already filled, this still returns 200 (cache hit; no re-save). Running again
 * with the same inputs is a no-op; if build inputs changed, the cache is upserted (replaced).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";
import { buildAndSavePastForGapfillLab } from "@/lib/admin/gapfillLabPrime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

export async function POST(req: NextRequest) {
  try {
    if (!hasAdminSessionCookie(req)) {
      const gate = requireAdmin(req);
      if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
    }

    let body: {
      houseId?: string;
      scenarioId?: string;
      email?: string;
      /** When provided, prime the Gap-Fill Lab cache (gapfill_lab) with db ∪ rangesToMask so Run Compare gets a cache hit. Requires email. */
      rangesToMask?: Array<{ startDate?: string; endDate?: string }>;
      timezone?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const rangesToMask = Array.isArray(body?.rangesToMask)
      ? (body.rangesToMask as Array<{ startDate?: string; endDate?: string }>)
          .map((r) => ({
            startDate: String(r?.startDate ?? "").slice(0, 10),
            endDate: String(r?.endDate ?? "").slice(0, 10),
          }))
          .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate))
      : [];

    if (rangesToMask.length > 0) {
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!email) {
        return NextResponse.json(
          { ok: false, error: "email_required", message: "When priming for Gap-Fill Lab (rangesToMask), email is required." },
          { status: 400 }
        );
      }
      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
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
        select: { id: true },
      });
      if (!houses?.length) {
        return NextResponse.json(
          { ok: false, error: "no_houses", message: "User has no houses." },
          { status: 404 }
        );
      }
      const houseId = houses[0].id;
      const timezone = String(body?.timezone ?? "America/Chicago").trim() || "America/Chicago";
      const result = await buildAndSavePastForGapfillLab({
        userId: user.id,
        houseId,
        rangesToMask,
        timezone,
      });
      if (result.ok) {
        return NextResponse.json({
          ok: true,
          message: "Gap-Fill Lab cache primed with these ranges. Run Compare will use cache and finish in seconds.",
          houseId: result.houseId,
          scenarioId: "gapfill_lab",
        });
      }
      if (result.error === "house_not_found" || result.error === "no_actual_data") {
        return NextResponse.json({ ok: false, error: result.error, message: result.message }, { status: 404 });
      }
      if (result.error === "profile_required") {
        return NextResponse.json({ ok: false, error: result.error, message: result.message }, { status: 400 });
      }
      return NextResponse.json(
        { ok: false, error: result.error, message: result.message },
        { status: 500 }
      );
    }

    let houseId = String(body?.houseId ?? "").trim();
    let scenarioId = String(body?.scenarioId ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();

    if (email) {
      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
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
        select: { id: true },
      });
      if (!houses?.length) {
        return NextResponse.json(
          { ok: false, error: "no_houses", message: "User has no houses." },
          { status: 404 }
        );
      }
      const houseRow = houses[0];
      houseId = houseRow.id;
      const scenario = await (prisma as any).usageSimulatorScenario.findFirst({
        where: {
          userId: user.id,
          houseId: houseRow.id,
          name: "Past (Corrected)",
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!scenario) {
        return NextResponse.json(
          { ok: false, error: "no_past_scenario", message: "No Past (Corrected) scenario for this house. Create it in the simulator first." },
          { status: 404 }
        );
      }
      scenarioId = scenario.id;
    }

    if (!houseId || !scenarioId) {
      return NextResponse.json(
        { ok: false, error: "houseId and scenarioId required", message: "Provide email or both houseId and scenarioId (Past scenario UUID)." },
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
    if (out.code === "INTERNAL_ERROR") {
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
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[prime-past-cache] POST failed", e);
    return NextResponse.json(
      { ok: false, error: "server_error", message: message || "A server error has occurred." },
      { status: 500 }
    );
  }
}
