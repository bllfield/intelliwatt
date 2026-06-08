export type SimulationAccuracyUserDisplay = {
  mode: "accuracy" | "needs_review";
  title: string;
  mainMetric: string;
  subtitle: string;
  detail: string | null;
  accuracyPercent: number | null;
};

export function readValidationHoldoutProofOk(meta: unknown): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const proof = (meta as { validationHoldoutProof?: unknown }).validationHoldoutProof;
  return Boolean(
    proof && typeof proof === "object" && !Array.isArray(proof) && (proof as { ok?: unknown }).ok === true
  );
}

export function readValidationHoldoutProofOkFromMetrics(metrics: unknown): boolean {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return false;
  const kind = String((metrics as { compareMetricKind?: unknown }).compareMetricKind ?? "").trim();
  if (kind === "holdout_wape") return true;
  if (kind === "reconstruction_check") return false;
  return false;
}

export function resolveSimulationAccuracyPercent(wapePercent: number): number {
  const wape = Number(wapePercent);
  if (!Number.isFinite(wape)) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - wape)));
}

export function buildSimulationAccuracyUserDisplay(args: {
  wapePercent: number;
  validationDayCount: number;
  holdoutProofOk: boolean;
}): SimulationAccuracyUserDisplay {
  const dayCount = Math.max(0, Math.floor(Number(args.validationDayCount) || 0));
  const wape = Number(args.wapePercent);
  const wapeSafe = Number.isFinite(wape) ? wape : 0;

  if (!args.holdoutProofOk) {
    return {
      mode: "needs_review",
      title: "Simulation Check",
      mainMetric: "Needs review",
      subtitle: "Accuracy check is not available because the holdout test did not pass.",
      detail: null,
      accuracyPercent: null,
    };
  }

  const accuracyPercent = resolveSimulationAccuracyPercent(wapeSafe);
  const hiddenDaysLabel =
    dayCount === 1
      ? "1 hidden day the simulator was not allowed to use."
      : `${dayCount} hidden days the simulator was not allowed to use.`;

  return {
    mode: "accuracy",
    title: "Simulation Accuracy",
    mainMetric: `${accuracyPercent}%`,
    subtitle: `Tested against ${hiddenDaysLabel}`,
    detail: `Average miss: ${wapeSafe.toFixed(1)}%`,
    accuracyPercent,
  };
}

export const SIMULATION_ACCURACY_ADVANCED_DETAIL = [
  "Holdout test: the simulator predicts selected real usage days without using those days as examples.",
  "Lower average miss means higher confidence in Past/Future estimates.",
] as const;
