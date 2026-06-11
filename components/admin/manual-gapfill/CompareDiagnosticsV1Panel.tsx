"use client";

import { Field, FieldGrid, JsonDetails } from "@/components/admin/manual-gapfill/StepSection";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function CompareDiagnosticsV1Panel(args: { compareResult: Record<string, unknown> | null }) {
  const diagnosticsV1 = asRecord(args.compareResult?.diagnosticsV1);
  if (!diagnosticsV1) {
    return (
      <p className="mt-3 text-sm text-slate-600">
        Run compare with diagnostics enabled to render Manual GapFill Compare Diagnostics v1.
      </p>
    );
  }

  const dashboard = asRecord(diagnosticsV1.dashboardSummary) ?? asRecord(args.compareResult?.dashboardSummary);
  const weatherDiagnostics = asRecord(diagnosticsV1.weatherDiagnostics) ?? asRecord(args.compareResult?.weatherDiagnostics);
  const travelDiagnostics = asRecord(diagnosticsV1.travelDiagnostics) ?? asRecord(args.compareResult?.travelDiagnostics);
  const summaryBuckets = asRecord(asRecord(diagnosticsV1.dailyWeatherMissDiagnostics)?.summaryBuckets);
  const validationCurve = asRecord(diagnosticsV1.validationIntervalCurveDiagnostics);
  const worstDays = asRecord(diagnosticsV1.worstDayDiagnostics);

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-brand-navy">Manual GapFill Compare Diagnostics v1 (admin-only)</h3>
        <p className="mt-1 text-xs text-slate-600">
          Diagnostic-only compare enrichment. Does not change simulator output, production WAPE, or Simulation Accuracy
          labels.
        </p>
      </div>

      {dashboard ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Dashboard summary</h4>
          <FieldGrid>
            <Field label="Daily WAPE" value={asNumber(dashboard.dailyWape)} />
            <Field label="Daily bias kWh/day" value={asNumber(dashboard.dailyBiasKwh)} />
            <Field label="Validation-day WAPE" value={asNumber(dashboard.validationDayWape)} />
            <Field label="Validation-day bias kWh/day" value={asNumber(dashboard.validationDayBiasKwh)} />
            <Field label="Hot-day WAPE" value={asNumber(dashboard.hotDayWape)} />
            <Field label="Hot-day bias kWh/day" value={asNumber(dashboard.hotDayBiasKwh)} />
            <Field label="Cold-day WAPE" value={asNumber(dashboard.coldDayWape)} />
            <Field label="Cold-day bias kWh/day" value={asNumber(dashboard.coldDayBiasKwh)} />
            <Field label="Mild-day WAPE" value={asNumber(dashboard.mildDayWape)} />
            <Field label="Mild-day bias kWh/day" value={asNumber(dashboard.mildDayBiasKwh)} />
            <Field label="Travel/vacant WAPE" value={asNumber(dashboard.travelVacantWape)} />
            <Field label="Travel/vacant bias kWh/day" value={asNumber(dashboard.travelVacantBiasKwh)} />
            <Field label="Validation interval curve WAPE" value={asNumber(dashboard.validationIntervalCurveWape)} />
            <Field label="Validation normalized shape error" value={asNumber(dashboard.validationNormalizedShapeError)} />
            <Field label="Peak timing error (min)" value={asNumber(dashboard.peakTimingErrorMinutes)} />
            <Field label="TOD bucket error" value={asNumber(dashboard.todBucketError)} />
            <Field label="Daily allocation flatness score" value={asNumber(dashboard.dailyAllocationFlatnessScore)} />
          </FieldGrid>
        </div>
      ) : null}

      <FieldGrid>
        <Field
          label="Weather diagnostics available"
          value={String(diagnosticsV1.weatherDiagnosticsAvailable ?? false)}
        />
        <Field label="Travel day count" value={asNumber(travelDiagnostics?.travelDayCount)} />
        <Field
          label="Travel days only excluded (not sim-adjusted)"
          value={asNumber(travelDiagnostics?.travelDaysOnlyExcludedNotSimAdjusted)}
        />
        <Field
          label="Validation curve day count"
          value={asNumber(validationCurve?.selectedValidationDayCount)}
        />
        <Field
          label="Included worst-day curve count"
          value={asNumber(validationCurve?.includedWorstDayCount)}
        />
      </FieldGrid>

      {summaryBuckets ? (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Weather bucket summaries</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1">Bucket</th>
                  <th className="px-2 py-1">Days</th>
                  <th className="px-2 py-1">WAPE</th>
                  <th className="px-2 py-1">Bias kWh/day</th>
                  <th className="px-2 py-1">Actual kWh</th>
                  <th className="px-2 py-1">Simulated kWh</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summaryBuckets).map(([key, raw]) => {
                  const bucket = asRecord(raw);
                  return (
                    <tr key={key} className="border-b border-slate-100">
                      <td className="px-2 py-1 font-mono">{key}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.dayCount)}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.wape)}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.biasKwhPerDay)}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.actualTotalKwh)}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.simulatedTotalKwh)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {weatherDiagnostics ? (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Weather sensitivity</summary>
          <FieldGrid>
            <Field
              label="Actual kWh/CDD"
              value={asNumber(weatherDiagnostics.actualKwhPerCoolingDegreeDay)}
            />
            <Field
              label="Simulated kWh/CDD"
              value={asNumber(weatherDiagnostics.simulatedKwhPerCoolingDegreeDay)}
            />
            <Field label="Cooling sensitivity delta" value={asNumber(weatherDiagnostics.coolingSensitivityDelta)} />
            <Field
              label="Actual kWh/HDD"
              value={asNumber(weatherDiagnostics.actualKwhPerHeatingDegreeDay)}
            />
            <Field
              label="Simulated kWh/HDD"
              value={asNumber(weatherDiagnostics.simulatedKwhPerHeatingDegreeDay)}
            />
            <Field label="Heating sensitivity delta" value={asNumber(weatherDiagnostics.heatingSensitivityDelta)} />
            <Field label="Hot-day bias" value={asNumber(weatherDiagnostics.hotDayBias)} />
            <Field label="Cold-day bias" value={asNumber(weatherDiagnostics.coldDayBias)} />
            <Field label="Mild-day bias" value={asNumber(weatherDiagnostics.mildDayBias)} />
          </FieldGrid>
        </details>
      ) : null}

      {travelDiagnostics && Array.isArray(travelDiagnostics.days) && travelDiagnostics.days.length > 0 ? (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Travel/vacant days</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1">Date</th>
                  <th className="px-2 py-1">Actual</th>
                  <th className="px-2 py-1">Simulated</th>
                  <th className="px-2 py-1">Sim travel adj?</th>
                  <th className="px-2 py-1">Excluded</th>
                  <th className="px-2 py-1">Source</th>
                </tr>
              </thead>
              <tbody>
                {(travelDiagnostics.days as unknown[]).map((raw) => {
                  const row = asRecord(raw);
                  const date = asString(row?.date) ?? "—";
                  return (
                    <tr key={date} className="border-b border-slate-100">
                      <td className="px-2 py-1 font-mono">{date}</td>
                      <td className="px-2 py-1">{asNumber(row?.actualKwh)}</td>
                      <td className="px-2 py-1">{asNumber(row?.simulatedKwh)}</td>
                      <td className="px-2 py-1">{String(row?.simUsedTravelAdjustment ?? "unknown")}</td>
                      <td className="px-2 py-1">{String(row?.excludedFromScoring ?? false)}</td>
                      <td className="px-2 py-1">{asString(row?.sourceOfTravel)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {worstDays ? (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Worst-day diagnostics</summary>
          <p className="mt-2 text-xs text-slate-600">
            Top absolute misses:{" "}
            {Array.isArray(worstDays.topAbsoluteDailyMisses)
              ? (worstDays.topAbsoluteDailyMisses as unknown[])
                  .slice(0, 3)
                  .map((raw) => asString(asRecord(raw)?.date))
                  .filter(Boolean)
                  .join(", ")
              : "—"}
          </p>
        </details>
      ) : null}

      <JsonDetails label="Diagnostics v1 JSON" value={diagnosticsV1} />
    </div>
  );
}
