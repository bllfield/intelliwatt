import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";
import { resolveIntervalsLayer } from "@/lib/usage/resolveIntervalsLayer";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import { ensureUsageShapeProfileForUserHouse } from "@/modules/usageShapeProfile/autoBuild";
import { createSimCorrelationId } from "@/modules/usageSimulator/simObservability";
import { attachFailureContract, correlationHeaders } from "@/lib/api/usageSimulationApiContract";
import { buildManualUsageReadDecorations } from "@/modules/manualUsage/pastSimReadResult";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // Past scenario may hit cache; cold path uses canonical builder (can be slow)

async function requireUser() {
  const cookieStore = cookies();
  const rawEmail = cookieStore.get("intelliwatt_user")?.value;
  if (!rawEmail) {
    return {
      ok: false as const,
      status: 401,
      body: attachFailureContract({ ok: false, error: "not_authenticated", message: "Not authenticated" }),
    };
  }
  const userEmail = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (!user) {
    return {
      ok: false as const,
      status: 404,
      body: attachFailureContract({ ok: false, error: "user_not_found", message: "User not found" }),
    };
  }
  return { ok: true as const, user };
}

export async function GET(request: NextRequest) {
  const correlationId = createSimCorrelationId();
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { searchParams } = new URL(request.url);
    const houseId = String(searchParams.get("houseId") ?? "").trim();
    const scenarioIdRaw = searchParams.get("scenarioId");
    const scenarioIdTrimmed = scenarioIdRaw == null ? null : String(scenarioIdRaw).trim();
    // Treat "baseline" (client string) same as null so both dashboard and simulation page use same actual data.
    const scenarioId = scenarioIdTrimmed === "baseline" ? null : scenarioIdTrimmed;

    if (!houseId) {
      return NextResponse.json(
        attachFailureContract({ ok: false, error: "houseId_required", message: "houseId is required." }),
        { status: 400, headers: correlationHeaders(correlationId) }
      );
    }

    // Baseline alias path: scenarioId omitted/null/"baseline" resolves to ACTUAL_USAGE_INTERVALS.
    if (!scenarioId) {
      const house = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: u.user.id, archivedAt: null },
        select: { id: true, esiid: true },
      });
      if (!house) {
        return NextResponse.json(
          {
            ...attachFailureContract({
              ok: false,
              error: "house_not_found",
              message: "House not found for user",
            }),
            code: "HOUSE_NOT_FOUND",
          },
          { status: 403, headers: correlationHeaders(correlationId) }
        );
      }
      const resolved = await resolveIntervalsLayer({
        userId: u.user.id,
        houseId: house.id,
        // Keep baseline "Usage" path on the exact same shared actual-usage layer as /api/user/usage.
        layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
        scenarioId: null,
        esiid: house.esiid ?? null,
      });
      const dataset = resolved?.dataset ?? null;
      const baselineHeaders = new Headers({ "Cache-Control": "private, max-age=30" });
      baselineHeaders.set("X-Correlation-Id", correlationId);
      return NextResponse.json(
        { ok: true, houseId: house.id, scenarioKey: "BASELINE", scenarioId: null, dataset, correlationId },
        { headers: baselineHeaders }
      );
    }

    let out = await getSimulatedUsageForHouseScenario({
      userId: u.user.id,
      houseId,
      scenarioId,
      correlationId,
      readMode: "allow_rebuild",
      projectionMode: "baseline",
      readContext: {
        artifactReadMode: "allow_rebuild",
        projectionMode: "baseline",
        compareSidecarRequest: true,
      },
    });
    const message = String((out as any)?.message ?? "");
    const shouldAutoBuildProfile =
      !out.ok &&
      out.code === "INTERNAL_ERROR" &&
      /usage_shape_profile_required|usage-shape profile|fallback_month_avg/i.test(message);
    if (shouldAutoBuildProfile) {
      const rebuilt = await ensureUsageShapeProfileForUserHouse({
        userId: u.user.id,
        houseId,
        timezone: "America/Chicago",
      });
      if (rebuilt.ok) {
        out = await getSimulatedUsageForHouseScenario({
          userId: u.user.id,
          houseId,
          scenarioId,
          correlationId,
          readMode: "allow_rebuild",
          projectionMode: "baseline",
          readContext: {
            artifactReadMode: "allow_rebuild",
            projectionMode: "baseline",
            compareSidecarRequest: true,
          },
        });
      }
    }
    // Past/Future: never cache so each open uses latest state (e.g. Future always sees latest Past).
    const cacheControl = scenarioId ? "private, no-store" : "private, max-age=30";
    if (out.ok) {
      const datasetAny = (out as any)?.dataset ?? {};
      const {
        compareProjection,
        manualReadModel,
        manualMonthlyReconciliation,
        sharedDiagnostics,
      } = await buildManualUsageReadDecorations({
        userId: u.user.id,
        houseId,
        scenarioId,
        dataset: datasetAny,
        callerType: "user_past",
        correlationId,
        readMode: "allow_rebuild",
      });
      const okHeaders = new Headers({ "Cache-Control": cacheControl });
      okHeaders.set("X-Correlation-Id", correlationId);
      return NextResponse.json(
        {
          ...out,
          compareProjection,
          manualReadModel,
          manualMonthlyReconciliation,
          sharedDiagnostics,
          correlationId,
        },
        { headers: okHeaders }
      });
    }

    const failureBody = {
      ...out,
      correlationId,
      failureCode: out.code,
      failureMessage: out.message,
    };
    if (out.code === "NO_BUILD") return NextResponse.json(failureBody, { status: 404, headers: correlationHeaders(correlationId) });
    if (out.code === "HOUSE_NOT_FOUND") return NextResponse.json(failureBody, { status: 403, headers: correlationHeaders(correlationId) });
    if (out.code === "SCENARIO_NOT_FOUND") return NextResponse.json(failureBody, { status: 404, headers: correlationHeaders(correlationId) });
    if (out.code === "ARTIFACT_MISSING") return NextResponse.json(failureBody, { status: 404, headers: correlationHeaders(correlationId) });
    if (out.code === "COMPARE_TRUTH_INCOMPLETE")
      return NextResponse.json(failureBody, { status: 409, headers: correlationHeaders(correlationId) });
    return NextResponse.json(failureBody, { status: 500, headers: correlationHeaders(correlationId) });
  } catch (e) {
    console.error("[user/usage/simulated/house] failed", e);
    return NextResponse.json(
      {
        ...attachFailureContract({
          ok: false,
          error: "internal_error",
          message: "Internal error",
        }),
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: correlationHeaders(correlationId) }
    );
  }
}
