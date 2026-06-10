import { Field, FieldGrid } from "@/components/admin/manual-gapfill/StepSection";
import type { ManualGapfillReadbackSummary } from "@/lib/admin/manualGapfillClient";

export function BillMatchReconciliationPanel(props: { readback: ManualGapfillReadbackSummary | null }) {
  const { readback } = props;
  if (!readback) return null;

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <h3 className="text-sm font-semibold text-brand-navy">Bill Match / Reconciliation</h3>
      <FieldGrid>
        <Field label="billMatchStatus" value={readback.billMatchStatus} />
        <Field label="eligiblePeriodCount" value={readback.eligiblePeriodCount} />
        <Field label="reconciledPeriodCount" value={readback.reconciledPeriodCount} />
        <Field label="intervalShape" value={readback.intervalShape} />
        <Field label="baseload15MinKwh" value={readback.baseload15MinKwh} />
        <Field label="Lab simulated total kWh" value={readback.totalKwh} />
        <Field label="coverageStart" value={readback.coverageStart} />
        <Field label="coverageEnd" value={readback.coverageEnd} />
      </FieldGrid>
      <p className="text-xs text-slate-600">
        Detailed source actual vs lab simulated period rows are shown in Step 5 Compare.
      </p>
    </div>
  );
}
