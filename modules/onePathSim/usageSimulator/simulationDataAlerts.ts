import "server-only";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";

export type SimulationFailureClassification = {
  reasonCode: string;
  reasonMessage: string;
  missingData: string[];
  userFacingExplanation: string;
  shouldAlert: boolean;
};

function normalizeText(v: unknown): string {
  return String(v ?? "").trim();
}

export function classifySimulationFailure(args: {
  code?: string | null;
  message?: string | null;
  error?: string | null;
}): SimulationFailureClassification {
  const code = normalizeText(args.code).toUpperCase();
  const message = normalizeText(args.message);
  const error = normalizeText(args.error).toUpperCase();
  const haystack = `${code} ${error} ${message}`.toLowerCase();

  if (
    haystack.includes("p2024") ||
    haystack.includes("connection pool") ||
    haystack.includes("timed out fetching a new connection") ||
    haystack.includes("connection limit: 1")
  ) {
    return {
      reasonCode: "PRISMA_POOL_EXHAUSTION",
      reasonMessage: "Simulation failed because the database connection pool was exhausted during recalc.",
      missingData: [],
      userFacingExplanation:
        "The simulation could not finish because the database connection pool was exhausted during recalc. Retry after the current workload clears; admin diagnostics now include the root-cause detail.",
      shouldAlert: true,
    };
  }

  if (haystack.includes("manual_monthly_shared_producer_no_dataset")) {
    return {
      reasonCode: "MANUAL_SHARED_PRODUCER_NO_DATASET",
      reasonMessage: "The shared MANUAL_TOTALS producer failed before it could return a dataset.",
      missingData: [],
      userFacingExplanation:
        "The shared manual-usage producer did not complete successfully. Retry the run; admin diagnostics include the producer failure detail when available.",
      shouldAlert: true,
    };
  }

  if (haystack.includes("usage_shape_profile_required") || haystack.includes("usage-shape profile")) {
    return {
      reasonCode: "MISSING_USAGE_SHAPE_PROFILE",
      reasonMessage: "Simulation could not run because a usage-shape profile was unavailable.",
      missingData: ["usage_shape_profile"],
      userFacingExplanation:
        "We couldn't calculate simulation output because your usage-shape profile is missing. Add more complete interval history or rebuild after profile derivation succeeds.",
      shouldAlert: true,
    };
  }

  if (haystack.includes("actual_weather_required") || haystack.includes("actual-only weather")) {
    return {
      reasonCode: "MISSING_ACTUAL_WEATHER",
      reasonMessage: "Simulation could not run because actual-only weather coverage was unavailable.",
      missingData: ["actual_weather"],
      userFacingExplanation:
        "We couldn't calculate simulation output because actual weather data is missing for part of the modeled window.",
      shouldAlert: true,
    };
  }

  if (haystack.includes("no_actual_data")) {
    return {
      reasonCode: "MISSING_ACTUAL_INTERVALS",
      reasonMessage: "Simulation compare could not run because no actual intervals were available in the selected window.",
      missingData: ["actual_usage_intervals"],
      userFacingExplanation:
        "No actual interval usage was available for the selected dates, so simulation compare could not be scored.",
      shouldAlert: true,
    };
  }

  if (haystack.includes("artifact_scope_mismatch_rebuild_required")) {
    return {
      reasonCode: "ARTIFACT_SCOPE_MISMATCH_REBUILD_REQUIRED",
      reasonMessage: "Saved shared Past artifact scope does not match requested identity inputs.",
      missingData: ["saved_shared_past_artifact"],
      userFacingExplanation:
        "Saved shared Past simulation data does not match the current identity inputs. Re-run compare (or Retry) to rebuild through the shared Past path.",
      shouldAlert: false,
    };
  }

  if (haystack.includes("artifact_stale_rebuild_required")) {
    return {
      reasonCode: "ARTIFACT_STALE_REBUILD_REQUIRED",
      reasonMessage: "Saved shared Past artifact is stale or incomplete for the requested window.",
      missingData: ["saved_shared_past_artifact"],
      userFacingExplanation:
        "Saved shared Past simulation data is stale for this window. Re-run compare (or Retry) to rebuild with current coverage.",
      shouldAlert: false,
    };
  }

  if (haystack.includes("artifact_compare_join_incomplete_rebuild_required")) {
    return {
      reasonCode: "ARTIFACT_COMPARE_JOIN_INCOMPLETE_REBUILD_REQUIRED",
      reasonMessage: "Saved shared Past artifact is missing points required for compare joins.",
      missingData: ["saved_shared_past_artifact"],
      userFacingExplanation:
        "Saved shared Past simulation data is incomplete for the selected test intervals. Re-run compare (or Retry) to rebuild and align the shared artifact.",
      shouldAlert: false,
    };
  }

  if (haystack.includes("artifact_ownership_metadata_missing_rebuild_required")) {
    return {
      reasonCode: "ARTIFACT_OWNERSHIP_METADATA_MISSING_REBUILD_REQUIRED",
      reasonMessage: "Saved shared Past artifact is missing travel/vacant ownership metadata required for Gap-Fill scoring.",
      missingData: ["artifact_excludedDateKeysFingerprint"],
      userFacingExplanation:
        "Saved shared Past simulation data is missing required travel/vacant ownership metadata for scoring. Re-run compare (or Retry) to rebuild the shared artifact.",
      shouldAlert: false,
    };
  }

  if (haystack.includes("artifact_test_window_not_simulated")) {
    return {
      reasonCode: "ARTIFACT_TEST_WINDOW_NOT_SIMULATED",
      reasonMessage: "Selected test dates are missing required shared Past artifact intervals for scoring.",
      missingData: ["simulated_test_intervals"],
      userFacingExplanation:
        "The selected Test Dates are missing required shared Past artifact intervals for scoring. Re-run compare (or Retry) to refresh shared Past artifact output, then retry.",
      shouldAlert: false,
    };
  }

  if (haystack.includes("artifact_missing_rebuild_required") || haystack.includes("artifact_missing")) {
    return {
      reasonCode: "ARTIFACT_MISSING_REBUILD_REQUIRED",
      reasonMessage: "Saved shared Past artifact is missing and must be rebuilt.",
      missingData: ["saved_shared_past_artifact"],
      userFacingExplanation:
        "No saved shared Past simulation data exists for this view yet. Re-run compare (or Retry) to build it through the shared service path.",
      shouldAlert: false,
    };
  }

  if (
    haystack.includes("travel_vacant_parity_proof_failed") ||
    haystack.includes("travel_vacant_parity_mismatch")
  ) {
    return {
      reasonCode: "TRAVEL_VACANT_PARITY_VALIDATION_FAILED",
      reasonMessage:
        "Exact travel/vacant parity validation failed because saved artifact totals and fresh shared simulation totals did not match exactly.",
      missingData: [],
      userFacingExplanation:
        "Exact travel/vacant parity validation failed. Saved artifact totals and fresh shared simulation totals did not match exactly for one or more validated dates.",
      shouldAlert: false,
    };
  }

  return {
    reasonCode: "SIMULATION_RUNTIME_ERROR",
    reasonMessage: message || "Simulation failed for an unknown reason.",
    missingData: [],
    userFacingExplanation:
      "Simulation failed unexpectedly. Please retry; if this keeps happening, support has been alerted.",
    shouldAlert: false,
  };
}

export async function recordSimulationDataAlert(args: {
  source: "GAPFILL_LAB" | "USER_SIMULATION" | "USAGE_DASHBOARD";
  userId?: string | null;
  userEmail?: string | null;
  houseId?: string | null;
  houseLabel?: string | null;
  scenarioId?: string | null;
  reasonCode: string;
  reasonMessage: string;
  missingData: string[];
  context?: Record<string, unknown> | null;
}): Promise<{ ok: true; id: string } | { ok: false }> {
  try {
    const userEmail = normalizeText(args.userEmail);
    let resolvedEmail = userEmail || null;
    if (!resolvedEmail && args.userId) {
      const u = await prisma.user.findUnique({
        where: { id: args.userId },
        select: { email: true },
      });
      resolvedEmail = normalizeText(u?.email) || null;
    }

    const fingerprintPayload = JSON.stringify({
      source: args.source,
      userId: args.userId ?? null,
      houseId: args.houseId ?? null,
      scenarioId: args.scenarioId ?? null,
      reasonCode: args.reasonCode,
      missingData: args.missingData.slice().sort(),
    });
    const fingerprint = createHash("sha256").update(fingerprintPayload).digest("hex");
    const now = new Date();
    const prismaAny = prisma as any;
    const existing = await prismaAny.simulationDataAlert.findUnique({
      where: { fingerprint },
      select: { id: true, seenCount: true, resolvedAt: true },
    });
    if (existing) {
      const updated = await prismaAny.simulationDataAlert.update({
        where: { fingerprint },
        data: {
          source: args.source,
          userId: args.userId ?? null,
          userEmail: resolvedEmail,
          houseId: args.houseId ?? null,
          houseLabel: args.houseLabel ?? null,
          scenarioId: args.scenarioId ?? null,
          reasonCode: args.reasonCode,
          reasonMessage: args.reasonMessage,
          missingDataJson: args.missingData,
          contextJson: args.context ?? null,
          lastSeenAt: now,
          seenCount: Number(existing.seenCount ?? 0) + 1,
          ...(existing.resolvedAt ? { resolvedAt: null } : {}),
        },
      });
      return { ok: true, id: String(updated.id) };
    }

    const created = await prismaAny.simulationDataAlert.create({
      data: {
        fingerprint,
        source: args.source,
        userId: args.userId ?? null,
        userEmail: resolvedEmail,
        houseId: args.houseId ?? null,
        houseLabel: args.houseLabel ?? null,
        scenarioId: args.scenarioId ?? null,
        reasonCode: args.reasonCode,
        reasonMessage: args.reasonMessage,
        missingDataJson: args.missingData,
        contextJson: args.context ?? null,
      },
    });
    return { ok: true, id: String(created.id) };
  } catch (error) {
    console.warn("[simulationDataAlerts] failed to record alert", error);
    return { ok: false };
  }
}

export type SimulationDataAlertRow = {
  id: string;
  source: string;
  userId: string | null;
  userEmail: string | null;
  houseId: string | null;
  houseLabel: string | null;
  scenarioId: string | null;
  reasonCode: string;
  reasonMessage: string;
  missingData: string[];
  context: Record<string, unknown> | null;
  seenCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export async function listOpenSimulationDataAlerts(limit = 100): Promise<SimulationDataAlertRow[]> {
  const prismaAny = prisma as any;
  const rows = await prismaAny.simulationDataAlert.findMany({
    where: { resolvedAt: null },
    orderBy: { lastSeenAt: "desc" },
    take: Math.max(1, Math.min(500, Math.trunc(limit))),
  });
  return (rows ?? []).map((r: any) => ({
    id: String(r.id),
    source: String(r.source ?? ""),
    userId: r.userId ? String(r.userId) : null,
    userEmail: r.userEmail ? String(r.userEmail) : null,
    houseId: r.houseId ? String(r.houseId) : null,
    houseLabel: r.houseLabel ? String(r.houseLabel) : null,
    scenarioId: r.scenarioId ? String(r.scenarioId) : null,
    reasonCode: String(r.reasonCode ?? ""),
    reasonMessage: String(r.reasonMessage ?? ""),
    missingData: Array.isArray(r.missingDataJson) ? r.missingDataJson.map((x: unknown) => String(x)) : [],
    context:
      r.contextJson && typeof r.contextJson === "object" && !Array.isArray(r.contextJson)
        ? (r.contextJson as Record<string, unknown>)
        : null,
    seenCount: Number(r.seenCount ?? 0) || 0,
    firstSeenAt: new Date(r.firstSeenAt).toISOString(),
    lastSeenAt: new Date(r.lastSeenAt).toISOString(),
  }));
}

