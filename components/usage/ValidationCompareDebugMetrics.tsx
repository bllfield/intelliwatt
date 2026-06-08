"use client";

export function ValidationCompareDebugMetrics(props: {
  metrics?: Record<string, unknown> | null;
  holdoutProofOk: boolean;
  pastValidationPolicyRevision?: string | null;
  className?: string;
}) {
  const metrics = props.metrics && typeof props.metrics === "object" ? props.metrics : {};
  const wape = Number(metrics.wape ?? 0);
  const mae = Number(metrics.mae ?? 0);
  const rmse = Number(metrics.rmse ?? 0);

  return (
    <div className={[props.className ?? "", "text-xs text-brand-navy/80 font-mono"].join(" ").trim()} aria-live="polite">
      <div>Holdout WAPE: {Number.isFinite(wape) ? wape.toFixed(2) : "—"}%</div>
      <div>MAE: {Number.isFinite(mae) ? mae.toFixed(2) : "—"} kWh/day</div>
      <div>RMSE: {Number.isFinite(rmse) ? rmse.toFixed(2) : "—"} kWh/day</div>
      <div>validationHoldoutProof.ok: {props.holdoutProofOk ? "true" : "false"}</div>
      {props.pastValidationPolicyRevision ? (
        <div>Validation policy: {props.pastValidationPolicyRevision}</div>
      ) : null}
    </div>
  );
}
