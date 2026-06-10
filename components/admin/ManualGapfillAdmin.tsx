"use client";

import { ManualGapfillLabWorkflow } from "@/components/admin/ManualGapfillLabWorkflow";

/** Debug-only wrapper — primary admin workflow is /admin/tools/gapfill-lab Manual GapFill Lab. */
export function ManualGapfillAdmin() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Manual GapFill API Debug</h1>
        <p className="mt-2 text-sm text-slate-600">
          Debug surface for MG-1 through MG-5 route adapters. Primary admin workflow:{" "}
          <a href="/admin/tools/gapfill-lab" className="text-brand-navy underline">
            Manual GapFill Lab
          </a>
          . Legacy EXACT_INTERVALS calibration remains under Advanced Legacy GapFill on that page.
        </p>
      </div>
      <ManualGapfillLabWorkflow showIdentityForm showHeader={false} />
    </div>
  );
}

export default ManualGapfillAdmin;
