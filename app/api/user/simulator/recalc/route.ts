import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { getPastSimRecalcJobForUser } from "@/modules/usageSimulator/simDropletJob";
import { getUserDefaultValidationSelectionMode } from "@/modules/usageSimulator/service";
import { resolveUserValidationPolicy } from "@/modules/usageSimulator/pastSimPolicy";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import {
  attachFailureContract,
  correlationHeaders,
  failureContractFromRecalcErr,
} from "@/lib/api/usageSimulationApiContract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireUser() {
  const cookieStore = cookies();
  const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
  if (!rawEmail) {
    return {
      ok: false as const,
      status: 401,
      body: attachFailureContract({ ok: false, error: "not_authenticated", message: "Not authenticated" }),
    };
  }
  const email = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    return {
      ok: false as const,
      status: 404,
      body: attachFailureContract({ ok: false, error: "user_not_found", message: "User not found" }),
    };
  }
  return { ok: true as const, user };
}

async function requireHouse(userId: string, houseId: string) {
  const h = await prisma.houseAddress.findFirst({
    where: { id: houseId, userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  return h ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const jobId = new URL(request.url).searchParams.get("jobId")?.trim() ?? "";
    if (!jobId) {
      return NextResponse.json(
        attachFailureContract({ ok: false, error: "jobId_required", message: "jobId query parameter is required." }),
        { status: 400 }
      );
    }
    const job = await getPastSimRecalcJobForUser({ jobId, userId: u.user.id });
    if (!job.ok) {
      return NextResponse.json(
        attachFailureContract({ ok: false, error: "job_not_found", message: "No job found for this user." }),
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      executionMode: "droplet_async",
      jobId,
      jobStatus: job.status,
      failureMessage: job.failureMessage,
    });
  } catch (e) {
    console.error("[user/simulator/recalc] GET failed", e);
    return NextResponse.json(
      attachFailureContract({ ok: false, error: "internal_error", message: "Internal server error" }),
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const body = await request.json().catch(() => ({}));
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    const mode = typeof body?.mode === "string" ? (body.mode.trim() as SimulatorMode) : null;
    const scenarioId = typeof body?.scenarioId === "string" ? body.scenarioId.trim() : null;
    const weatherPreferenceRaw = typeof body?.weatherPreference === "string" ? body.weatherPreference.trim() : "";
    const weatherPreference: WeatherPreference | undefined =
      weatherPreferenceRaw === "NONE" || weatherPreferenceRaw === "LAST_YEAR_WEATHER" || weatherPreferenceRaw === "LONG_TERM_AVERAGE"
        ? (weatherPreferenceRaw as WeatherPreference)
        : undefined;
    const userValidationPolicy = resolveUserValidationPolicy({
      defaultSelectionMode: await getUserDefaultValidationSelectionMode(),
      validationDayCount: 21,
    });
    if (!houseId) {
      return NextResponse.json(
        attachFailureContract({ ok: false, error: "houseId_required", message: "houseId is required." }),
        { status: 400 }
      );
    }
    if (mode !== "MANUAL_TOTALS" && mode !== "NEW_BUILD_ESTIMATE" && mode !== "SMT_BASELINE") {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "mode_invalid",
          message: "mode must be MANUAL_TOTALS, NEW_BUILD_ESTIMATE, or SMT_BASELINE.",
        }),
        { status: 400 }
      );
    }

    const house = await requireHouse(u.user.id, houseId);
    if (!house) {
      return NextResponse.json(
        attachFailureContract({ ok: false, error: "house_not_found_for_user", message: "House not found for user" }),
        { status: 403 }
      );
    }
    const dispatched = await dispatchPastSimRecalc({
      userId: u.user.id,
      houseId,
      esiid: house.esiid ?? null,
      mode,
      scenarioId,
      weatherPreference,
      persistPastSimBaseline: true,
      validationDaySelectionMode: userValidationPolicy.selectionMode,
      validationDayCount: userValidationPolicy.validationDayCount,
      runContext: {
        callerLabel: "user_recalc",
        buildPathKind: "recalc",
        persistRequested: true,
      },
    });
    if (dispatched.executionMode === "droplet_async") {
      return NextResponse.json(
        {
          ok: true,
          executionMode: "droplet_async",
          jobId: dispatched.jobId,
          correlationId: dispatched.correlationId,
        },
        { headers: correlationHeaders(dispatched.correlationId) }
      );
    }
    const out = dispatched.result;
    if (!out.ok) {
      const status = out.error === "recalc_timeout" ? 504 : 400;
      const { failureCode, failureMessage } = failureContractFromRecalcErr(out);
      return NextResponse.json(
        {
          ...out,
          executionMode: "inline" as const,
          correlationId: dispatched.correlationId,
          failureCode,
          failureMessage,
        },
        { status, headers: correlationHeaders(dispatched.correlationId) }
      );
    }
    return NextResponse.json(
      {
        ...out,
        executionMode: "inline" as const,
        correlationId: dispatched.correlationId,
      },
      { headers: correlationHeaders(dispatched.correlationId) }
    );
  } catch (e) {
    console.error("[user/simulator/recalc] failed", e);
    return NextResponse.json(
      attachFailureContract({ ok: false, error: "internal_error", message: "Internal server error" }),
      { status: 500 }
    );
  }
}
