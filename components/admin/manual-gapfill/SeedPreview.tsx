import { Field, FieldGrid } from "@/components/admin/manual-gapfill/StepSection";
import type { ManualGapfillSeedPreview } from "@/lib/admin/manualGapfillClient";

function formatKwh(value: number | null | undefined): string {
  return value == null ? "—" : String(value);
}

export function SeedPreview(props: { preview: ManualGapfillSeedPreview | null; mode: string }) {
  const { preview, mode } = props;
  if (!preview) return null;

  const monthlyTotals = preview.monthlyTotalsKwhByMonth
    ? Object.entries(preview.monthlyTotalsKwhByMonth).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div>
        <h3 className="text-sm font-semibold text-brand-navy">Seed preview (from MG-3 response)</h3>
        <p className="mt-1 text-xs text-slate-600">
          Resolved anchor: <span className="font-mono">{preview.anchorEndDate ?? "—"}</span>
        </p>
        <p className="text-xs text-slate-600">Statement ranges generated from resolved anchor.</p>
      </div>

      <FieldGrid>
        <Field label="Manual usage mode" value={preview.manualUsageMode} />
        <Field label="Resolved anchorEndDate" value={preview.anchorEndDate} />
        <Field label="Total kWh" value={formatKwh(preview.totalKwh)} />
        <Field label="Bill period count" value={preview.billPeriodCount} />
        <Field label="Annual total kWh" value={formatKwh(preview.annualTotalKwh)} />
        <Field label="normalizedPayloadHash" value={preview.normalizedPayloadHash} />
        <Field label="billPeriodHash" value={preview.billPeriodHash} />
        <Field label="validationResultHash" value={preview.validationResultHash} />
      </FieldGrid>

      {mode === "MONTHLY_FROM_SOURCE_INTERVALS" && preview.statementRanges.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Statement ranges</h4>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-300">
                  <th className="px-2 py-1">#</th>
                  <th className="px-2 py-1">startDate</th>
                  <th className="px-2 py-1">endDate</th>
                  <th className="px-2 py-1">kWh total</th>
                  <th className="px-2 py-1">status / warning</th>
                </tr>
              </thead>
              <tbody>
                {preview.statementRanges.map((row, index) => (
                  <tr key={`${row.startDate}-${row.endDate}-${index}`} className="border-b border-slate-100">
                    <td className="px-2 py-1">{index + 1}</td>
                    <td className="px-2 py-1 font-mono">{row.startDate}</td>
                    <td className="px-2 py-1 font-mono">{row.endDate}</td>
                    <td className="px-2 py-1">{row.kwhTotal == null ? "—" : row.kwhTotal}</td>
                    <td className="px-2 py-1">{row.statusOrWarning ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {monthlyTotals.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Monthly totals (monthlyTotalsKwhByMonth)</h4>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-300">
                  <th className="px-2 py-1">Month</th>
                  <th className="px-2 py-1">kWh</th>
                </tr>
              </thead>
              <tbody>
                {monthlyTotals.map(([month, kwh]) => (
                  <tr key={month} className="border-b border-slate-100">
                    <td className="px-2 py-1 font-mono">{month}</td>
                    <td className="px-2 py-1">{kwh}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
