/**
 * Pure mapping from simulated-house API responses to UI outcome (plan §8).
 * No modeled math — classification only for presentation.
 */

export type ScenarioCurveOutcome =
  | { kind: "success" }
  | { kind: "no_build"; message: string; code?: string }
  | { kind: "timeout"; message: string }
  | { kind: "failed"; message: string; failureCode?: string };

type ScenarioErrBody = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  message?: string;
  failureCode?: string;
  failureMessage?: string;
  error?: string;
};

export function scenarioCurveOutcomeFromFetch(params: {
  httpOk: boolean;
  httpStatus: number;
  json: ScenarioErrBody | null;
  aborted: boolean;
  /** Past vs Future only affects default copy; baseline does not use this path. */
  curveLabel: "Past" | "Future";
}): ScenarioCurveOutcome {
  const { httpOk, httpStatus, json, aborted, curveLabel } = params;
  const defaultNotReady = `Scenario not computed yet. Save changes in this workspace to compute ${curveLabel} simulated usage.`;

  if (aborted) {
    return {
      kind: "timeout",
      message:
        "Loading exceeded the browser wait limit (Past sim can take several minutes on first load). Retry, or wait and refresh after save/recompute finishes.",
    };
  }

  const gatewayTimeout = httpStatus === 504 || httpStatus === 502;
  if (!httpOk && gatewayTimeout) {
    return {
      kind: "timeout",
      message: `${curveLabel} simulated usage timed out before completion. Try again in a moment.`,
    };
  }

  // Error HTTP responses may still carry JSON with { ok: false, code } (e.g. 404 NO_BUILD).
  if (!httpOk && json && json.ok === false) {
    const code = typeof json.code === "string" ? json.code : "";
    const msg =
      typeof json.failureMessage === "string" && json.failureMessage.trim()
        ? json.failureMessage.trim()
        : typeof json.message === "string" && json.message.trim()
          ? json.message.trim()
          : defaultNotReady;
    if (code === "NO_BUILD" || code === "ARTIFACT_MISSING") {
      return { kind: "no_build", message: msg, code };
    }
    const failureCode =
      typeof json.failureCode === "string" && json.failureCode.trim()
        ? json.failureCode.trim()
        : code || undefined;
    return { kind: "failed", message: msg, failureCode };
  }

  if (!httpOk) {
    const msg =
      json && typeof json.failureMessage === "string" && json.failureMessage.trim()
        ? json.failureMessage.trim()
        : json && typeof json.message === "string" && json.message.trim()
          ? json.message.trim()
          : json && typeof json.error === "string" && json.error.trim()
            ? json.error.trim()
            : "Unable to load simulated usage.";
    const failureCode =
      typeof json?.failureCode === "string" && json.failureCode.trim()
        ? json.failureCode.trim()
        : undefined;
    return { kind: "failed", message: msg, failureCode };
  }

  if (!json || json.ok !== true) {
    const code = typeof json?.code === "string" ? json.code : "";
    const msg =
      typeof json?.failureMessage === "string" && json.failureMessage.trim()
        ? json.failureMessage.trim()
        : typeof json?.message === "string" && json.message.trim()
          ? json.message.trim()
          : defaultNotReady;
    if (code === "NO_BUILD" || code === "ARTIFACT_MISSING") {
      return { kind: "no_build", message: msg, code };
    }
    const failureCode =
      typeof json?.failureCode === "string" && json.failureCode.trim()
        ? json.failureCode.trim()
        : code || undefined;
    return { kind: "failed", message: msg, failureCode };
  }

  return { kind: "success" };
}

export function recalcUserMessageFromResponse(params: {
  httpOk: boolean;
  httpStatus: number;
  json: Record<string, unknown> | null;
}): { tone: "success" | "timeout" | "failed"; text: string } {
  const { httpOk, httpStatus, json } = params;
  if (httpOk && json?.ok === true) {
    return { tone: "success", text: "Updated." };
  }
  const timeout =
    httpStatus === 504 ||
    httpStatus === 502 ||
    json?.error === "recalc_timeout" ||
    json?.failureCode === "RECALC_TIMEOUT";
  if (timeout) {
    return {
      tone: "timeout",
      text: "Recalculate timed out. Wait a moment and try again.",
    };
  }
  if (json?.error === "requirements_unmet" && Array.isArray((json as any).missingItems) && (json as any).missingItems.length > 0) {
    return { tone: "failed", text: "Complete the required details below before we can calculate." };
  }
  const msg =
    typeof json?.failureMessage === "string" && (json.failureMessage as string).trim()
      ? String(json.failureMessage)
      : typeof json?.error === "string"
        ? String(json.error)
        : `Recalc failed (${httpStatus})`;
  return { tone: "failed", text: msg };
}
