"use client";

import type { ManualValidationSummary } from "@/modules/manualUsage/manualValidationSummary";

function fmtKwh(value: number | null): string {
  return value != null && Number.isFinite(value) ? value.toFixed(2) : "\u2014";
}

function fmtSignedKwh(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} kWh`;
}

function titleCaseStatus(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function ManualValidationSummaryPanel(props: {
  summary: ManualValidationSummary;
  showAdminDiagnostics?: boolean;
}) {
  const { billMatchVerification, manualSimulationConfidence, intervalShape } = props.summary;
  const showAdmin = props.showAdminDiagnostics === true;
  const hasExcludedTotals =
    billMatchVerification.excludedPeriodCount > 0 &&
    (billMatchVerification.excludedEnteredTotalKwh != null || billMatchVerification.excludedSimulatedTotalKwh != null);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="text-sm font-semibold text-neutral-900">Bill Match</div>
        <p className="mt-1 text-xs text-neutral-600">
          Hard reconciliation against original statement ranges, not the canonical display window. Pass/fail totals use
          eligible bill periods only.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Status</div>
            <div className="mt-1 text-sm font-semibold text-neutral-900">{titleCaseStatus(billMatchVerification.status)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Period match</div>
            <div className="mt-1 text-sm font-semibold text-neutral-900">
              {billMatchVerification.exactMatchPeriodCount} of {billMatchVerification.eligiblePeriodCount} eligible bill
              periods matched
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Eligible entered total</div>
            <div className="mt-1 text-sm font-semibold text-neutral-900">
              {fmtKwh(billMatchVerification.eligibleEnteredTotalKwh)} kWh
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Eligible simulated total</div>
            <div className="mt-1 text-sm font-semibold text-neutral-900">
              {fmtKwh(billMatchVerification.eligibleSimulatedTotalKwh)} kWh ({fmtSignedKwh(billMatchVerification.eligibleDeltaKwh)})
            </div>
          </div>
        </div>
        {hasExcludedTotals ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">All entered total</div>
              <div className="mt-1 text-sm font-semibold text-neutral-900">{fmtKwh(billMatchVerification.allEnteredTotalKwh)} kWh</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Excluded entered total</div>
              <div className="mt-1 text-sm font-semibold text-neutral-900">
                {fmtKwh(billMatchVerification.excludedEnteredTotalKwh)} kWh
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Excluded simulated total</div>
              <div className="mt-1 text-sm font-semibold text-neutral-900">
                {fmtKwh(billMatchVerification.excludedSimulatedTotalKwh)} kWh
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Tolerance</div>
              <div className="mt-1 text-sm font-semibold text-neutral-900">
                ±{billMatchVerification.toleranceKwh.toFixed(2)} kWh on eligible totals
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-neutral-600">
            All entered bill periods are eligible; eligible totals match the full entered total.
          </p>
        )}
        {billMatchVerification.excludedPeriodCount > 0 ? (
          <p className="mt-3 text-xs text-neutral-600">
            {billMatchVerification.excludedPeriodCount} bill period(s) excluded from pass/fail (travel/vacant or missing input)
            but remain visible in the detail table with their entered and simulated kWh.
          </p>
        ) : null}
        {billMatchVerification.warnings.map((warning) => (
          <p key={warning} className="mt-2 text-xs text-amber-700">
            {warning}
          </p>
        ))}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="text-sm font-semibold text-neutral-900">Simulation Confidence</div>
        <p className="mt-1 text-xs text-neutral-600">
          Separate from Bill Match. This reflects interval-shape and model confidence, not whether your entered bill totals
          were accepted.
        </p>
        <p className="mt-2 text-xs text-neutral-600">{manualSimulationConfidence.userFacingSummary}</p>
        <div className="mt-3 text-sm font-semibold text-neutral-900">{titleCaseStatus(manualSimulationConfidence.status)}</div>
        {showAdmin ? (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-white p-3 text-[11px] text-neutral-700">
            {JSON.stringify(manualSimulationConfidence, null, 2)}
          </pre>
        ) : null}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="text-sm font-semibold text-neutral-900">{intervalShape.label}</div>
        <p className="mt-1 text-xs text-neutral-600">{intervalShape.userFacingSummary}</p>
        <div className="mt-2 text-sm font-semibold text-neutral-900">{titleCaseStatus(intervalShape.accuracyClaim)}</div>
      </div>

      {showAdmin ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-sm font-semibold text-neutral-900">Admin bill match diagnostics</div>
          <div className="mt-2 grid gap-2 text-xs text-neutral-700 md:grid-cols-2 xl:grid-cols-4">
            <div>Source: {billMatchVerification.source}</div>
            <div>Tolerance: ±{billMatchVerification.toleranceKwh.toFixed(2)} kWh</div>
            <div>Eligible: {billMatchVerification.eligiblePeriodCount}</div>
            <div>Excluded: {billMatchVerification.excludedPeriodCount}</div>
            <div>Reconciled: {billMatchVerification.reconciledPeriodCount}</div>
            <div>Exact match: {billMatchVerification.exactMatchPeriodCount}</div>
            <div>Basis: {manualSimulationConfidence.basis}</div>
            <div>Interval claim: {manualSimulationConfidence.intervalAccuracyClaim}</div>
            <div>Actual truth: {manualSimulationConfidence.adminDiagnostics.actualIntervalTruthAvailable ? "yes" : "no"}</div>
            <div>
              Holdout deferred: {manualSimulationConfidence.adminDiagnostics.holdoutConfidenceDeferred ? "yes" : "no"}
            </div>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-neutral-50 p-3 text-[11px] text-neutral-700">
            {JSON.stringify(billMatchVerification, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
