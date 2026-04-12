"use client";

import type { ManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";

function fmtKwh(value: number | null): string {
  return value != null && Number.isFinite(value) ? value.toFixed(2) : "\u2014";
}

function formatInputKind(value: string): string {
  switch (value) {
    case "entered_nonzero":
      return "Entered total";
    case "entered_zero":
      return "Entered zero";
    case "missing":
      return "Missing input";
    case "annual_total":
      return "Annual total";
    default:
      return value || "Not shown in this view";
  }
}

function formatParityRule(value: string): string {
  switch (value) {
    case "exact_match_required":
      return "Exact match required";
    case "excluded_travel_overlap":
      return "Excluded: travel overlap";
    case "excluded_missing_input":
      return "Excluded: no entered total";
    case "excluded_filled_later":
      return "Excluded: filled later";
    default:
      return value || "Not shown in this view";
  }
}

function formatStatusLabel(value: string): string {
  switch (value) {
    case "reconciled":
      return "Reconciled";
    case "delta_present":
      return "Delta present";
    case "travel_overlap":
      return "Excluded";
    case "filled_later":
      return "Filled later";
    case "missing_input":
      return "Missing input";
    case "sim_result_unavailable":
      return "Sim result not attached";
    default:
      return value || "Not shown in this view";
  }
}

function formatReasonLabel(value: string | null, status: string): string {
  if (value) return value;
  switch (status) {
    case "reconciled":
      return "Eligible period matched within the active parity rule.";
    case "delta_present":
      return "Eligible period stayed in the exact-match pool but did not reconcile.";
    case "travel_overlap":
      return "Travel overlap keeps this period visible but excluded from exact-match parity.";
    case "filled_later":
      return "This period is visible for context only because it was filled later.";
    case "missing_input":
      return "No entered bill-period total was attached for this period.";
    case "sim_result_unavailable":
      return "Shared Stage 2 output was not attached for this read.";
    default:
      return "Not shown in this view";
  }
}

function rowToneClass(status: string): string {
  switch (status) {
    case "reconciled":
      return "bg-emerald-50/40";
    case "delta_present":
      return "bg-amber-50/50";
    case "travel_overlap":
    case "filled_later":
    case "missing_input":
    case "sim_result_unavailable":
      return "bg-slate-50";
    default:
      return "";
  }
}

export function ManualMonthlyReconciliationPanel(props: {
  reconciliation: ManualMonthlyReconciliation;
  className?: string;
}) {
  const rows = Array.isArray(props.reconciliation?.rows) ? props.reconciliation.rows : [];
  if (rows.length === 0) return null;

  return (
    <div className={props.className}>
      <div className="mt-2 text-xs text-brand-navy/80">
        Eligible exact-match {props.reconciliation.eligibleRangeCount} · Excluded / other {props.reconciliation.ineligibleRangeCount} ·
        Reconciled {props.reconciliation.reconciledRangeCount} · Delta present {props.reconciliation.deltaPresentRangeCount}
      </div>
      <div className="mt-3 overflow-auto">
        <table className="min-w-full text-xs border border-brand-blue/10">
          <thead className="bg-brand-blue/5">
            <tr>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Bill period</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Input kind</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Actual kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Entered kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Stage 1 target kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Past Sim kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Delta</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Parity rule</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Status</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.month}:${row.startDate}:${row.endDate}`} className={rowToneClass(row.status)}>
                <td className="border border-brand-blue/10 px-2 py-1">
                  <div className="font-medium">{row.month}</div>
                  <div className="text-[0.7rem] text-brand-navy/60">
                    {row.startDate} {"->"} {row.endDate}
                  </div>
                </td>
                <td className="border border-brand-blue/10 px-2 py-1">{formatInputKind(row.inputKind)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.actualIntervalTotalKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.enteredStatementTotalKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.stageOneTargetTotalKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.simulatedStatementTotalKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.deltaKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1">{formatParityRule(row.parityRequirement)}</td>
                <td className="border border-brand-blue/10 px-2 py-1">{formatStatusLabel(row.status)}</td>
                <td className="border border-brand-blue/10 px-2 py-1">{formatReasonLabel(row.reason, row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
