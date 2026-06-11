import { NextRequest, NextResponse } from "next/server";
import { resolveOnePathSimOwnerUserId } from "@/app/api/admin/tools/one-path-sim/_helpers";
import { gateManualGapfillAdmin } from "@/app/api/admin/tools/manual-gapfill/_helpers";
import {
  loadModelIntelligenceHousesByEmail,
  resolveModelIntelligenceLabContext,
} from "@/modules/modelIntelligence/labContextResolver";
import { resolveModelIntelligenceModeAvailability } from "@/modules/modelIntelligence/modeAvailability";
import { prepareModelIntelligenceDispatchStep } from "@/modules/modelIntelligence/orchestrationPrepare";
import { buildModelIntelligenceSequencePreview } from "@/modules/modelIntelligence/runPlanBuilder";
import type {
  ModelIntelligenceManualGapfillOptions,
  ModelIntelligenceOnePathOptions,
  ModelIntelligenceOrchestrationFlags,
  ModelIntelligenceRunMode,
  ModelIntelligenceSelectedRuns,
} from "@/modules/modelIntelligence/types";
import { MODEL_INTELLIGENCE_RUN_MODES } from "@/modules/modelIntelligence/types";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseSelectedRuns(body: Record<string, unknown>): Partial<Record<ModelIntelligenceRunMode, boolean>> {
  const raw = asRecord(body.selectedRuns);
  return {
    SMT_INTERVAL_TRUTH: raw.SMT_INTERVAL_TRUTH === true,
    GREEN_BUTTON_TRUTH: raw.GREEN_BUTTON_TRUTH === true,
    MONTHLY_MASKED: raw.MONTHLY_MASKED === true,
    ANNUAL_MASKED: raw.ANNUAL_MASKED === true,
    NEW_BUILD: raw.NEW_BUILD === true,
  };
}

function parseOnePathOptions(body: Record<string, unknown>): ModelIntelligenceOnePathOptions {
  const raw = asRecord(body.onePathOptions);
  const validationOnlyDateKeysLocal = Array.isArray(raw.validationOnlyDateKeysLocal)
    ? raw.validationOnlyDateKeysLocal.map((value) => String(value).slice(0, 10)).filter(Boolean)
    : [];
  const weatherPreference = asString(raw.weatherPreference);
  return {
    weatherPreference:
      weatherPreference === "NONE" ||
      weatherPreference === "LAST_YEAR_WEATHER" ||
      weatherPreference === "LONG_TERM_AVERAGE"
        ? weatherPreference
        : "LAST_YEAR_WEATHER",
    validationSelectionMode:
      raw.validationSelectionMode === "fixed_count" || raw.validationSelectionMode === "explicit_dates"
        ? raw.validationSelectionMode
        : "policy_default",
    validationDayCount: asNumber(raw.validationDayCount, 14),
    validationOnlyDateKeysLocal,
    persistRequested: asBoolean(raw.persistRequested, false),
    runReason: asString(raw.runReason) ?? "model_intelligence_lab_preview",
    includeDebugDiagnostics: asBoolean(raw.includeDebugDiagnostics, false),
    includeSimRunAudit: asBoolean(raw.includeSimRunAudit, false),
    includePosthocTopMissIntervalCurves: asBoolean(raw.includePosthocTopMissIntervalCurves, false),
    actualContextHouseIdOverride: asString(raw.actualContextHouseIdOverride),
  };
}

function parseManualGapfillOptions(body: Record<string, unknown>): ModelIntelligenceManualGapfillOptions {
  const raw = asRecord(body.manualGapfillOptions);
  const mode = asString(raw.manualGapfillMode);
  return {
    includeDiagnostics: asBoolean(raw.includeDiagnostics, true),
    includeDailyRows: asBoolean(raw.includeDailyRows, true),
    anchorEndDate: asString(raw.anchorEndDate) ?? "",
    persistSeedToggle: asBoolean(raw.persistSeedToggle, false),
    manualGapfillMode:
      mode === "ANNUAL_FROM_SOURCE_INTERVALS" ? "ANNUAL_FROM_SOURCE_INTERVALS" : "MONTHLY_FROM_SOURCE_INTERVALS",
    includeIntervalCurveDiagnostics: asBoolean(raw.includeIntervalCurveDiagnostics, true),
    includeTopMissCurves: asBoolean(raw.includeTopMissCurves, false),
  };
}

function parseFlags(body: Record<string, unknown>): ModelIntelligenceOrchestrationFlags {
  const raw = asRecord(body.flags);
  return {
    runCompareDiagnostics: asBoolean(raw.runCompareDiagnostics, true),
    buildCohortSnapshot: asBoolean(raw.buildCohortSnapshot, false),
    updateTuningQueue: asBoolean(raw.updateTuningQueue, false),
    includeAiExportBundle: asBoolean(raw.includeAiExportBundle, false),
  };
}

export async function POST(request: NextRequest) {
  const denied = gateManualGapfillAdmin(request);
  if (denied) return denied;

  const body = asRecord(await request.json().catch(() => ({})));
  const action = asString(body.action) ?? "load_houses";

  if (action === "load_houses") {
    const email = asString(body.email);
    if (!email) {
      return NextResponse.json({ ok: false, error: "email_required", message: "Email is required." }, { status: 400 });
    }
    const lookup = await loadModelIntelligenceHousesByEmail(email);
    if (!lookup.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: lookup.error,
          message: lookup.error === "user_not_found" ? "No user found for that email." : "Email is required.",
        },
        { status: lookup.error === "user_not_found" ? 404 : 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      action,
      email: lookup.email,
      userId: lookup.userId,
      houses: lookup.houses,
    });
  }

  if (action === "load_context") {
    const email = asString(body.email);
    const houseId = asString(body.houseId);
    if (!email || !houseId) {
      return NextResponse.json(
        { ok: false, error: "identity_required", message: "Email and houseId are required." },
        { status: 400 }
      );
    }
    const resolved = await resolveModelIntelligenceLabContext({
      email,
      houseId,
      esiid: asString(body.esiid),
    });
    if (!resolved.ok) {
      return NextResponse.json(resolved, { status: resolved.error === "user_not_found" ? 404 : 400 });
    }
    return NextResponse.json({
      ok: true,
      action,
      context: resolved.context,
      houses: resolved.houses,
      modeAvailability: resolveModelIntelligenceModeAvailability(resolved.context),
    });
  }

  if (action === "preview_sequence") {
    const email = asString(body.email);
    const houseId = asString(body.houseId);
    if (!email || !houseId) {
      return NextResponse.json(
        { ok: false, error: "identity_required", message: "Email and houseId are required." },
        { status: 400 }
      );
    }
    const resolved = await resolveModelIntelligenceLabContext({
      email,
      houseId,
      esiid: asString(body.esiid),
    });
    if (!resolved.ok) {
      return NextResponse.json(resolved, { status: resolved.error === "user_not_found" ? 404 : 400 });
    }

    const context = resolved.context;
    const onePathOptions = parseOnePathOptions(body);
    if (onePathOptions.actualContextHouseIdOverride) {
      context.actualContextHouseId = onePathOptions.actualContextHouseIdOverride;
    }

    const preview = buildModelIntelligenceSequencePreview({
      context,
      selectedRuns: parseSelectedRuns(body),
      onePathOptions,
      manualGapfillOptions: parseManualGapfillOptions(body),
      flags: parseFlags(body),
    });

    return NextResponse.json({
      ok: true,
      action,
      context,
      preview,
      options: {
        onePathOptions,
        manualGapfillOptions: parseManualGapfillOptions(body),
        flags: parseFlags(body),
      },
    });
  }

  if (action === "prepare_dispatch_step") {
    const email = asString(body.email);
    const houseId = asString(body.houseId);
    const runModeRaw = asString(body.runMode);
    if (!email || !houseId || !runModeRaw) {
      return NextResponse.json(
        { ok: false, error: "identity_required", message: "Email, houseId, and runMode are required." },
        { status: 400 }
      );
    }
    if (!MODEL_INTELLIGENCE_RUN_MODES.includes(runModeRaw as ModelIntelligenceRunMode)) {
      return NextResponse.json(
        { ok: false, error: "unsupported_run_mode", message: `Unsupported run mode: ${runModeRaw}` },
        { status: 400 }
      );
    }
    const runMode = runModeRaw as ModelIntelligenceRunMode;
    const resolved = await resolveModelIntelligenceLabContext({
      email,
      houseId,
      esiid: asString(body.esiid),
    });
    if (!resolved.ok) {
      return NextResponse.json(resolved, { status: resolved.error === "user_not_found" ? 404 : 400 });
    }

    const context = resolved.context;
    const onePathOptions = parseOnePathOptions(body);
    if (onePathOptions.actualContextHouseIdOverride) {
      context.actualContextHouseId = onePathOptions.actualContextHouseIdOverride;
    }
    const manualGapfillOptions = parseManualGapfillOptions(body);
    const flags = parseFlags(body);
    const preview = buildModelIntelligenceSequencePreview({
      context,
      selectedRuns: parseSelectedRuns(body),
      onePathOptions,
      manualGapfillOptions,
      flags,
    });
    const ownerUserId = await resolveOnePathSimOwnerUserId(request);
    const prepared = await prepareModelIntelligenceDispatchStep({
      context,
      preview,
      runMode,
      onePathOptions,
      manualGapfillOptions,
      ownerUserId,
    });
    if (!prepared.ok) {
      return NextResponse.json(prepared, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      action,
      stepId: prepared.stepId,
      runMode: prepared.runMode,
      onePathRunRequest: prepared.onePathRunRequest,
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "unsupported_action",
      message: `Unsupported action: ${action}`,
      supportedActions: ["load_houses", "load_context", "preview_sequence", "prepare_dispatch_step"],
    },
    { status: 400 }
  );
}
