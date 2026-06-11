"use client";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function Field(props: { label: string; value: string | number | boolean | null | undefined }) {
  const display =
    props.value == null || props.value === ""
      ? "—"
      : typeof props.value === "boolean"
        ? props.value
          ? "true"
          : "false"
        : String(props.value);
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{props.label}</div>
      <div className="mt-0.5 font-mono text-xs text-slate-800">{display}</div>
    </div>
  );
}

export function OnePathIntervalDiagnosticsV1Panel(props: {
  diagnostics: Record<string, unknown> | null | undefined;
  includePosthocTopMissIntervalCurves: boolean;
  onIncludePosthocTopMissIntervalCurvesChange: (value: boolean) => void;
  onRerunWithPosthocToggle?: () => void;
}) {
  const diagnostics = asRecord(props.diagnostics);
  if (!diagnostics) return null;

  const available = diagnostics.available === true;
  const guardrails = asRecord(diagnostics.guardrails);
  const dailyCompare = asRecord(diagnostics.dailyCompare);
  const summaryBuckets = asRecord(dailyCompare?.summaryBuckets);
  const weatherMiss = asRecord(diagnostics.weatherMissDiagnostics);
  const validationCurves = asRecord(diagnostics.validationIntervalCurveDiagnostics);
  const todBuckets = asRecord(diagnostics.todBucketDiagnostics);
  const exactMatch = asRecord(diagnostics.exactMatchDiagnostics);
  const worstDays = asRecord(diagnostics.worstDayDiagnostics);

  if (!available) {
    return (
      <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-brand-navy">
          Interval Diagnostic Compare — read-only, does not affect simulation or validation
        </summary>
        <p className="mt-3 text-sm text-slate-600">
          Interval diagnostics are unavailable for this run ({asString(diagnostics.unavailableReason) ?? "non-interval source"}).
        </p>
      </details>
    );
  }

  return (
    <details className="rounded-2xl border border-indigo-200 bg-indigo-50/30 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-brand-navy">
        Interval Diagnostic Compare — read-only, does not affect simulation or validation
      </summary>
      <p className="mt-2 text-xs text-slate-600">
        Admin-only interval compare diagnostics. Does not mutate simulation output, validation-day policy, plan ranking,
        or customer-facing Simulation Accuracy labels.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Source type" value={asString(diagnostics.sourceType)} />
        <Field label="Diagnostic only" value={asBoolean(guardrails?.diagnosticOnly)} />
        <Field label="Simulation mutated" value={asBoolean(guardrails?.simulationMutated)} />
        <Field label="Validation policy mutated" value={asBoolean(guardrails?.validationPolicyMutated)} />
        <Field label="User-facing result mutated" value={asBoolean(guardrails?.userFacingResultMutated)} />
        <Field label="Plan ranking mutated" value={asBoolean(guardrails?.planRankingMutated)} />
        <Field label="All-day WAPE" value={asNumber(asRecord(summaryBuckets?.all_days)?.wape)} />
        <Field label="All-day percent bias" value={asNumber(asRecord(summaryBuckets?.all_days)?.percentBias)} />
        <Field label="Validation-day WAPE" value={asNumber(asRecord(summaryBuckets?.validation_days)?.wape)} />
        <Field label="Weather diagnostics available" value={asBoolean(weatherMiss?.weatherDiagnosticsAvailable)} />
        <Field label="Validation curve days" value={asNumber(validationCurves?.selectedValidationDayCount)} />
        <Field label="Posthoc curve days" value={asNumber(validationCurves?.includedPosthocDayCount)} />
        <Field label="Exact curve match days" value={asNumber(exactMatch?.exactCurveMatchDayCount)} />
        <Field label="Near-exact curve match days" value={asNumber(exactMatch?.nearExactCurveMatchDayCount)} />
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={props.includePosthocTopMissIntervalCurves}
            onChange={(event) => props.onIncludePosthocTopMissIntervalCurvesChange(event.target.checked)}
          />
          <span>
            Include interval curves for top daily misses (posthoc diagnostic, default off). These days are labeled{" "}
            <span className="font-mono text-xs">posthoc_diagnostic</span> and are not used for scoring.
          </span>
        </label>
        {props.onRerunWithPosthocToggle ? (
          <button
            type="button"
            className="mt-2 rounded-lg border border-brand-navy/20 bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy hover:bg-brand-navy/5"
            onClick={() => props.onRerunWithPosthocToggle?.()}
          >
            Re-read run with posthoc interval curves
          </button>
        ) : null}
      </div>

      {summaryBuckets ? (
        <details className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Daily summary buckets</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1">Bucket</th>
                  <th className="px-2 py-1">Days</th>
                  <th className="px-2 py-1">WAPE</th>
                  <th className="px-2 py-1">Bias %</th>
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
                      <td className="px-2 py-1">{asNumber(bucket?.percentBias)}</td>
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

      {Array.isArray(asRecord(todBuckets)?.buckets) ? (
        <details className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-navy">TOD bucket diagnostics (validation days)</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1">Bucket</th>
                  <th className="px-2 py-1">Actual kWh</th>
                  <th className="px-2 py-1">Simulated kWh</th>
                  <th className="px-2 py-1">Delta kWh</th>
                  <th className="px-2 py-1">Share actual</th>
                  <th className="px-2 py-1">Share simulated</th>
                </tr>
              </thead>
              <tbody>
                {(asRecord(todBuckets)?.buckets as unknown[]).map((raw, index) => {
                  const bucket = asRecord(raw);
                  return (
                    <tr key={`${asString(bucket?.bucket) ?? index}`} className="border-b border-slate-100">
                      <td className="px-2 py-1 font-mono">{asString(bucket?.bucket)}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.bucketActualKwh)}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.bucketSimulatedKwh)}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.bucketDeltaKwh)}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.bucketShareActual)}</td>
                      <td className="px-2 py-1">{asNumber(bucket?.bucketShareSimulated)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {worstDays ? (
        <details className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Worst-day diagnostics</summary>
          <div className="mt-3 space-y-3 text-xs">
            {(["topAbsoluteDailyMisses", "topIntervalShapeMisses", "topPeakTimingMisses"] as const).map((key) => {
              const rows = Array.isArray(worstDays[key]) ? (worstDays[key] as unknown[]) : [];
              if (!rows.length) return null;
              return (
                <div key={key}>
                  <div className="font-semibold text-brand-navy">{key}</div>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px]">
                    {JSON.stringify(rows.slice(0, 5), null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </details>
  );
}
