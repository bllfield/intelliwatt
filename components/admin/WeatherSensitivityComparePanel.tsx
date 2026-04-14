"use client";

import type {
  WeatherEfficiencyDerivedInput,
  WeatherSensitivityScore,
} from "@/modules/weatherSensitivity/shared";
import { WeatherSensitivityAdminDiagnostics } from "@/components/admin/WeatherSensitivityAdminDiagnostics";

function formatDelta(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function deltaRow(label: string, actualValue: number, manualValue: number) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-mono text-xs text-brand-navy/70">{label}</span>
      <span className="text-sm font-semibold text-brand-navy">
        {manualValue} vs {actualValue} ({formatDelta(manualValue - actualValue)})
      </span>
    </div>
  );
}

export function WeatherSensitivityComparePanel(props: {
  actualScore: WeatherSensitivityScore | null;
  actualDerivedInput: WeatherEfficiencyDerivedInput | null;
  actualUnavailableMessage?: string | null;
  manualScore: WeatherSensitivityScore | null;
  manualDerivedInput: WeatherEfficiencyDerivedInput | null;
  manualUnavailableMessage?: string | null;
}) {
  const hasBothScores = Boolean(props.actualScore && props.manualScore);

  return (
    <section className="space-y-4 rounded-2xl border border-brand-blue/15 bg-white p-5 shadow-sm">
      <div>
        <div className="text-base font-semibold text-brand-navy">Actual vs Manual-Monthly Weather Compare</div>
        <div className="mt-1 text-sm text-brand-navy/70">
          Compare source-house interval weather truth against the current manual-monthly weather contract so you can
          tighten the monthly inputs toward the interval-backed result.
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <WeatherSensitivityAdminDiagnostics
          score={props.actualScore}
          derivedInput={props.actualDerivedInput}
          unavailableMessage={props.actualUnavailableMessage}
          title="Source Interval Weather"
        />
        <WeatherSensitivityAdminDiagnostics
          score={props.manualScore}
          derivedInput={props.manualDerivedInput}
          unavailableMessage={props.manualUnavailableMessage}
          title="Manual-Monthly Weather"
        />
      </div>

      {hasBothScores ? (
        <details className="rounded-xl border border-brand-blue/10 bg-brand-blue/5">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-brand-navy">
            Tuning deltas
          </summary>
          <div className="space-y-2 border-t border-brand-blue/10 px-4 py-4">
            {deltaRow(
              "weatherEfficiencyScore0to100",
              props.actualScore!.weatherEfficiencyScore0to100,
              props.manualScore!.weatherEfficiencyScore0to100
            )}
            {deltaRow(
              "coolingSensitivityScore0to100",
              props.actualScore!.coolingSensitivityScore0to100,
              props.manualScore!.coolingSensitivityScore0to100
            )}
            {deltaRow(
              "heatingSensitivityScore0to100",
              props.actualScore!.heatingSensitivityScore0to100,
              props.manualScore!.heatingSensitivityScore0to100
            )}
            {deltaRow(
              "confidenceScore0to100",
              props.actualScore!.confidenceScore0to100,
              props.manualScore!.confidenceScore0to100
            )}
            {deltaRow(
              "shoulderBaselineKwhPerDay",
              props.actualScore!.shoulderBaselineKwhPerDay,
              props.manualScore!.shoulderBaselineKwhPerDay
            )}
            {deltaRow(
              "coolingSlopeKwhPerCDD",
              props.actualScore!.coolingSlopeKwhPerCDD,
              props.manualScore!.coolingSlopeKwhPerCDD
            )}
            {deltaRow(
              "heatingSlopeKwhPerHDD",
              props.actualScore!.heatingSlopeKwhPerHDD,
              props.manualScore!.heatingSlopeKwhPerHDD
            )}
          </div>
        </details>
      ) : null}
    </section>
  );
}
