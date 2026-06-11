import { extractModelIntelligenceOnePathRunReadback, listOrchestrationDispatchSteps } from "@/modules/modelIntelligence/onePathDispatchPlan";
import type {
  ModelIntelligenceManualGapfillOptions,
  ModelIntelligenceOnePathOptions,
  ModelIntelligenceOrchestrationFlags,
  ModelIntelligenceOrchestrationRun,
  ModelIntelligenceOrchestrationStepResult,
  ModelIntelligenceRunMode,
  ModelIntelligenceSelectedRuns,
  ModelIntelligenceSequencePreview,
} from "@/modules/modelIntelligence/types";
import {
  fetchModelIntelligenceSequencePreview,
} from "@/lib/admin/modelIntelligenceClient";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function postJson<T>(body: Record<string, unknown>): Promise<ApiResult<T>> {
  const res = await fetch("/api/admin/tools/model-intelligence-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    const message =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      `Request failed (${res.status})`;
    return { ok: false, error: message, status: res.status };
  }
  return { ok: true, data: json as T };
}

export async function fetchPrepareModelIntelligenceDispatchStep(args: {
  email: string;
  houseId: string;
  esiid?: string | null;
  runMode: ModelIntelligenceRunMode;
  selectedRuns: ModelIntelligenceSelectedRuns;
  onePathOptions: ModelIntelligenceOnePathOptions;
  manualGapfillOptions: ModelIntelligenceManualGapfillOptions;
  flags: ModelIntelligenceOrchestrationFlags;
}) {
  return postJson<{
    stepId: string;
    runMode: ModelIntelligenceRunMode;
    onePathRunRequest: Record<string, unknown>;
  }>({
    action: "prepare_dispatch_step",
    email: args.email,
    houseId: args.houseId,
    ...(args.esiid ? { esiid: args.esiid } : {}),
    runMode: args.runMode,
    selectedRuns: args.selectedRuns,
    onePathOptions: args.onePathOptions,
    manualGapfillOptions: args.manualGapfillOptions,
    flags: args.flags,
  });
}

export async function runOnePathOrchestrationRequest(request: Record<string, unknown>) {
  const res = await fetch("/api/admin/tools/one-path-sim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(request),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    const message =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      `One Path run failed (${res.status})`;
    return { ok: false as const, error: String(json.error ?? "one_path_run_failed"), message, response: json };
  }
  return { ok: true as const, response: json, readback: extractModelIntelligenceOnePathRunReadback(json, request) };
}

export async function runModelIntelligenceOrchestration(args: {
  email: string;
  houseId: string;
  esiid?: string | null;
  preview: ModelIntelligenceSequencePreview | null;
  selectedRuns: ModelIntelligenceSelectedRuns;
  onePathOptions: ModelIntelligenceOnePathOptions;
  manualGapfillOptions: ModelIntelligenceManualGapfillOptions;
  flags: ModelIntelligenceOrchestrationFlags;
  signal?: AbortSignal;
  onUpdate?: (run: ModelIntelligenceOrchestrationRun) => void;
}): Promise<
  | { ok: true; preview: ModelIntelligenceSequencePreview; run: ModelIntelligenceOrchestrationRun }
  | { ok: false; error: string; preview: ModelIntelligenceSequencePreview | null; run: ModelIntelligenceOrchestrationRun | null }
> {
  let preview = args.preview;
  if (!preview) {
    const previewResult = await fetchModelIntelligenceSequencePreview({
      email: args.email,
      houseId: args.houseId,
      esiid: args.esiid,
      selectedRuns: args.selectedRuns,
      onePathOptions: args.onePathOptions,
      manualGapfillOptions: args.manualGapfillOptions,
      flags: args.flags,
    });
    if (!previewResult.ok) {
      return { ok: false, error: previewResult.error, preview: null, run: null };
    }
    preview = previewResult.data.preview;
  }

  const dispatchSteps = listOrchestrationDispatchSteps(preview);
  if (dispatchSteps.length === 0) {
    return {
      ok: false,
      error: "No runnable One Path dispatch steps in the current preview.",
      preview,
      run: null,
    };
  }

  const startedAt = new Date().toISOString();
  const run: ModelIntelligenceOrchestrationRun = {
    runVersion: "model_intelligence_orchestration_v1",
    phase: "phase_2_client_orchestration",
    startedAt,
    finishedAt: null,
    status: "running",
    stepResults: [],
    guardrails: {
      onePathOnlySimulation: true,
      clientDrivenSequentialSteps: true,
      noParallelSimulation: true,
      maskedRunsLabHomeOnly: true,
    },
  };
  args.onUpdate?.(run);

  for (const step of dispatchSteps) {
    if (args.signal?.aborted) {
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      run.stepResults.push({
        stepId: step.stepId,
        runMode: step.runMode!,
        kind: "dispatch_one_path_sim",
        status: "cancelled",
        unavailableReason: null,
        error: "orchestration_cancelled",
        message: "Orchestration cancelled before this step started.",
        onePathRunRequest: null,
        readback: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      args.onUpdate?.(run);
      break;
    }

    const stepStartedAt = new Date().toISOString();
    const prepared = await fetchPrepareModelIntelligenceDispatchStep({
      email: args.email,
      houseId: args.houseId,
      esiid: args.esiid,
      runMode: step.runMode!,
      selectedRuns: args.selectedRuns,
      onePathOptions: args.onePathOptions,
      manualGapfillOptions: args.manualGapfillOptions,
      flags: args.flags,
    });
    if (!prepared.ok) {
      run.status = "failed";
      run.finishedAt = new Date().toISOString();
      run.stepResults.push({
        stepId: step.stepId,
        runMode: step.runMode!,
        kind: "dispatch_one_path_sim",
        status: "failed",
        unavailableReason: null,
        error: "prepare_dispatch_failed",
        message: prepared.error,
        onePathRunRequest: null,
        readback: null,
        startedAt: stepStartedAt,
        finishedAt: run.finishedAt,
      });
      args.onUpdate?.(run);
      return { ok: false, error: prepared.error, preview, run };
    }

    const onePathResult = await runOnePathOrchestrationRequest(prepared.data.onePathRunRequest);
    if (!onePathResult.ok) {
      run.status = "failed";
      run.finishedAt = new Date().toISOString();
      run.stepResults.push({
        stepId: prepared.data.stepId,
        runMode: prepared.data.runMode,
        kind: "dispatch_one_path_sim",
        status: "failed",
        unavailableReason: null,
        error: onePathResult.error,
        message: onePathResult.message,
        onePathRunRequest: prepared.data.onePathRunRequest,
        readback: null,
        startedAt: stepStartedAt,
        finishedAt: run.finishedAt,
      });
      args.onUpdate?.(run);
      return { ok: false, error: onePathResult.message, preview, run };
    }

    run.stepResults.push({
      stepId: prepared.data.stepId,
      runMode: prepared.data.runMode,
      kind: "dispatch_one_path_sim",
      status: "completed",
      unavailableReason: null,
      error: null,
      message: null,
      onePathRunRequest: prepared.data.onePathRunRequest,
      readback: onePathResult.readback,
      startedAt: stepStartedAt,
      finishedAt: new Date().toISOString(),
    });
    args.onUpdate?.(run);
  }

  if (run.status === "running") {
    run.status = "completed";
    run.finishedAt = new Date().toISOString();
    args.onUpdate?.(run);
  }

  return { ok: run.status === "completed", error: run.status === "completed" ? "" : "Orchestration did not complete.", preview, run };
}
