export const dynamic = "force-dynamic";

import React from "react";

export default async function EflManualReviewPage() {
  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">EFL Fact Card — Manual Review Queue</h1>
        <p className="text-sm text-gray-500">
          This module is reserved for Electricity Facts Labels that the AI extractor flags as{" "}
          <span className="font-semibold">requires manual review</span>. Future ingestion steps
          will surface those flagged Fact Cards here so you can inspect the extracted{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">PlanRules</code> alongside
          their EFL identity metadata.
        </p>
      </header>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-2">Queue Status</h2>
        <p className="text-sm text-gray-600">
          The validation layer is live and correctly marks ambiguous or incomplete Fact Cards as
          requiring manual review. Persistence and the actual review queue UI will be wired in a
          subsequent step; for now this page acts as the dedicated home for that workflow and is
          linked from the main Admin Tools section.
        </p>
      </section>
    </div>
  );
}


