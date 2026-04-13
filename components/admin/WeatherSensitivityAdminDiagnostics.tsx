"use client";

import type {
  WeatherEfficiencyDerivedInput,
  WeatherSensitivityScore,
} from "@/modules/weatherSensitivity/shared";
import { WeatherSensitivityCard } from "@/components/usage/WeatherSensitivityCard";

function metricRow(label: string, value: unknown) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-mono text-xs text-brand-navy/70">{label}</span>
      <span className="text-sm font-semibold text-brand-navy">{String(value ?? "—")}</span>
    </div>
  );
}

export function WeatherSensitivityAdminDiagnostics(props: {
  score: WeatherSensitivityScore | null;
  derivedInput: WeatherEfficiencyDerivedInput | null;
}) {
  if (!props.score) return null;

  return (
    <section className="space-y-4 rounded-2xl border border-brand-blue/15 bg-white p-5 shadow-sm">
      <WeatherSensitivityCard score={props.score} presentation="admin" title="Weather Efficiency Score" />

      <details className="rounded-xl border border-brand-blue/10 bg-brand-blue/5">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-brand-navy">
          Raw weather sensitivity diagnostics
        </summary>
        <div className="space-y-2 border-t border-brand-blue/10 px-4 py-4">
          {metricRow("scoringMode", props.score.scoringMode)}
          {metricRow("coolingSlopeKwhPerCDD", props.score.coolingSlopeKwhPerCDD)}
          {metricRow("heatingSlopeKwhPerHDD", props.score.heatingSlopeKwhPerHDD)}
          {metricRow("coolingResponseRatio", props.score.coolingResponseRatio)}
          {metricRow("heatingResponseRatio", props.score.heatingResponseRatio)}
          {metricRow("shoulderBaselineKwhPerDay", props.score.shoulderBaselineKwhPerDay)}
          {metricRow("eligibleActualDayCount", props.score.eligibleActualDayCount ?? "—")}
          {metricRow("eligibleBillPeriodCount", props.score.eligibleBillPeriodCount ?? "—")}
          {metricRow("excludedSimulatedDayCount", props.score.excludedSimulatedDayCount)}
          {metricRow("excludedTravelDayCount", props.score.excludedTravelDayCount ?? props.score.excludedTravelBillPeriodCount ?? "—")}
          {metricRow("excludedIncompleteMeterDayCount", props.score.excludedIncompleteMeterDayCount)}
          {metricRow("requiredInputAdjustmentsApplied", props.score.requiredInputAdjustmentsApplied.join(", "))}
          {metricRow("derived input attached", props.derivedInput?.derivedInputAttached ?? false)}
          {metricRow("simulation active", props.derivedInput?.simulationActive ?? false)}
          {metricRow("scoreVersion", props.score.scoreVersion)}
        </div>
      </details>
    </section>
  );
}
