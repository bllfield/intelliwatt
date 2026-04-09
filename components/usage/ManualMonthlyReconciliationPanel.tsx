"use client";

import type { ManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";

function fmtKwh(value: number | null): string {
  return value != null && Number.isFinite(value) ? value.toFixed(2) : "\u2014";
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
        Eligible {props.reconciliation.eligibleRangeCount} · Ineligible {props.reconciliation.ineligibleRangeCount} · Reconciled{" "}
        {props.reconciliation.reconciledRangeCount} · Delta present {props.reconciliation.deltaPresentRangeCount}
      </div>
      <div className="mt-3 overflow-auto">
        <table className="min-w-full text-xs border border-brand-blue/10">
          <thead className="bg-brand-blue/5">
            <tr>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Range</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Input kind</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Actual kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Entered kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Stage 1 kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Past Sim kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Delta</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Status</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.month}:${row.startDate}:${row.endDate}`}>
                <td className="border border-brand-blue/10 px-2 py-1">
                  <div className="font-medium">{row.month}</div>
                  <div className="text-[0.7rem] text-brand-navy/60">
                    {row.startDate} - {row.endDate}
                  </div>
                </td>
                <td className="border border-brand-blue/10 px-2 py-1">{row.inputKind}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.actualIntervalTotalKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.enteredStatementTotalKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.stageOneTargetTotalKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.simulatedStatementTotalKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1 text-right">{fmtKwh(row.deltaKwh)}</td>
                <td className="border border-brand-blue/10 px-2 py-1">{row.status}</td>
                <td className="border border-brand-blue/10 px-2 py-1">{row.reason ?? "\u2014"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
