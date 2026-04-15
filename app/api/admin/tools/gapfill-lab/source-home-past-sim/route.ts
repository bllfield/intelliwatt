import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { attachFailureContract } from "@/lib/api/usageSimulationApiContract";
import { createSimCorrelationId, logSimPipelineEvent } from "@/modules/usageSimulator/simObservability";
import { buildSourceHomePastSimSnapshot } from "@/app/api/admin/tools/gapfill-lab/sourceHomePastSimSnapshot";
import { getTravelRangesFromDb } from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

function gateGapfillLabAdmin(req: NextRequest): NextResponse | null {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) {
      const raw = gate.body as { error?: string };
      const errMsg = typeof raw?.error === "string" ? raw.error : "Admin gate denied";
      const errKey =
        errMsg === "Unauthorized"
          ? "admin_unauthorized"
          : errMsg === "ADMIN_TOKEN not configured"
            ? "admin_token_not_configured"
            : "admin_gate_denied";
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: errKey,
          message: errMsg,
        }),
        { status: gate.status }
      );
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const gate = gateGapfillLabAdmin(request);
  if (gate) return gate;

  const body = await request.json().catch(() => ({}));
  const email = normalizeEmailSafe(body?.email);
  const sourceHouseId = typeof body?.sourceHouseId === "string" ? body.sourceHouseId.trim() : "";
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "America/Chicago";
  const weatherKind = typeof body?.weatherKind === "string" ? body.weatherKind.trim() : "LAST_YEAR_ACTUAL_WEATHER";
  const includeDiagnostics = body?.includeDiagnostics === true;
  void body?.diagnosticsOnly;

  if (!email) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "email_required",
        message: "email is required.",
      }),
      { status: 400 }
    );
  }
  if (!sourceHouseId) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "source_house_not_found",
        message: "Selected source house was not found for this user.",
      }),
      { status: 404 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user?.id) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "user_not_found",
        message: "User not found for email.",
      }),
      { status: 404 }
    );
  }

  const selectedSourceHouse = await (prisma as any).houseAddress.findFirst({
    where: { id: sourceHouseId, userId: user.id, archivedAt: null },
    select: { id: true, userId: true, esiid: true },
  });
  if (!selectedSourceHouse?.id) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "source_house_not_found",
        message: "Selected source house was not found for this user.",
      }),
      { status: 404 }
    );
  }

  const sourcePastCorrelationId = createSimCorrelationId();
  logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_started", {
    correlationId: sourcePastCorrelationId,
    source: "gapfill_lab",
    action: "run_source_home_past_sim_snapshot",
    userId: user.id,
    sourceHouseId: selectedSourceHouse.id,
    timezone,
    weatherKind,
  });
  let snapshot:
    | Awaited<ReturnType<typeof buildSourceHomePastSimSnapshot>>
    | null = null;
  try {
    snapshot = await buildSourceHomePastSimSnapshot({
      userId: user.id,
      sourceHouse: {
        id: selectedSourceHouse.id,
        esiid: selectedSourceHouse.esiid ? String(selectedSourceHouse.esiid) : null,
      },
      correlationId: sourcePastCorrelationId,
      includeDiagnostics,
      getTravelRangesFromDb,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_failed", {
      correlationId: sourcePastCorrelationId,
      source: "gapfill_lab",
      action: "run_source_home_past_sim_snapshot",
      userId: user.id,
      sourceHouseId: selectedSourceHouse.id,
      phase: "pre_dispatch_failed",
      error: message,
    });
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "source_home_past_sim_snapshot_failed",
        message,
        correlationId: sourcePastCorrelationId,
      }),
      { status: 500 }
    );
  }

  if (!snapshot.ok) {
    logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_failed", {
      correlationId: sourcePastCorrelationId,
      source: "gapfill_lab",
      action: "run_source_home_past_sim_snapshot",
      userId: user.id,
      sourceHouseId: selectedSourceHouse.id,
      phase: snapshot.error === "no_past_scenario" ? "past_scenario_missing" : "snapshot_read_failed",
      error: snapshot.error,
      message: snapshot.message,
    });
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: snapshot.error,
        message: snapshot.message,
        correlationId: sourcePastCorrelationId,
      }),
      { status: snapshot.error === "no_past_scenario" ? 400 : 500 }
    );
  }

  logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_completed", {
    correlationId: sourcePastCorrelationId,
    source: "gapfill_lab",
    action: "run_source_home_past_sim_snapshot",
    userId: user.id,
    sourceHouseId: selectedSourceHouse.id,
    scenarioId: snapshot.scenarioId,
    readExecutionMode: "not_run",
    baselineReadOk: snapshot.pastSimSnapshot?.reads?.baselineProjection?.ok ?? null,
    diagnosticsIncluded: includeDiagnostics,
    buildInputsHash: (snapshot.pastSimSnapshot as any)?.build?.buildInputsHash ?? null,
  });

  return NextResponse.json({
    ok: true,
    action: "run_source_home_past_sim_snapshot",
    sourceHouseId: snapshot.sourceHouseId,
    scenarioId: snapshot.scenarioId,
    correlationId: sourcePastCorrelationId,
    validationPolicyOwner: snapshot.validationPolicyOwner,
    pastSimSnapshot: snapshot.pastSimSnapshot,
  });
}
