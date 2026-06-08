"use client";

import {
  buildSimulationAccuracyUserDisplay,
  SIMULATION_ACCURACY_ADVANCED_DETAIL,
} from "@/components/usage/simulationAccuracyDisplay";

export function SimulationAccuracySummary(props: {
  wapePercent: number;
  validationDayCount: number;
  holdoutProofOk: boolean;
  showAdvancedDetail?: boolean;
  className?: string;
}) {
  const display = buildSimulationAccuracyUserDisplay({
    wapePercent: props.wapePercent,
    validationDayCount: props.validationDayCount,
    holdoutProofOk: props.holdoutProofOk,
  });

  return (
    <div className={[props.className ?? "", "space-y-1"].join(" ").trim()} aria-live="polite">
      <div className="text-lg font-semibold tabular-nums text-brand-navy">{display.mainMetric}</div>
      <div className="text-xs text-brand-navy/80">{display.subtitle}</div>
      {display.detail ? <div className="text-xs text-brand-navy/70">{display.detail}</div> : null}
      {props.showAdvancedDetail && display.mode === "accuracy" ? (
        <div className="mt-2 space-y-1 text-[0.65rem] text-neutral-500">
          {SIMULATION_ACCURACY_ADVANCED_DETAIL.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
