import type { ManualGapfillMonthlyCompareRow } from "@/lib/admin/manualGapfillClient";

export function MonthlyCompareRowsTable(props: {
  rows: ManualGapfillMonthlyCompareRow[];
  compareScope: string | null;
}) {
  const { rows, compareScope } = props;
  if (!rows.length) return null;

  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm font-semibold text-slate-800">
        Compare source actual vs lab simulated
        {compareScope ? (
          <span className="ml-2 font-normal text-slate-600">({compareScope})</span>
        ) : null}
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-300">
              <th className="px-2 py-1">periodId</th>
              <th className="px-2 py-1">startDate</th>
              <th className="px-2 py-1">endDate</th>
              <th className="px-2 py-1">Source actual kWh</th>
              <th className="px-2 py-1">Lab simulated kWh</th>
              <th className="px-2 py-1">deltaKwh</th>
              <th className="px-2 py-1">percentDelta</th>
              <th className="px-2 py-1">status</th>
              <th className="px-2 py-1">actualSource</th>
              <th className="px-2 py-1">simulatedSource</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.periodId} className="border-b border-slate-100">
                <td className="px-2 py-1 font-mono">{row.periodId}</td>
                <td className="px-2 py-1 font-mono">{row.startDate}</td>
                <td className="px-2 py-1 font-mono">{row.endDate}</td>
                <td className="px-2 py-1">{row.actualKwh ?? "—"}</td>
                <td className="px-2 py-1">{row.simulatedKwh ?? "—"}</td>
                <td className="px-2 py-1">{row.deltaKwh ?? "—"}</td>
                <td className="px-2 py-1">{row.percentDelta ?? "—"}</td>
                <td className="px-2 py-1">{row.status}</td>
                <td className="px-2 py-1">{row.actualSource ?? "—"}</td>
                <td className="px-2 py-1">{row.simulatedSource ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
