/**
 * Manual Fact Card Loader (legacy page).
 * The full loader also lives on /admin/efl/fact-cards.
 */
"use client";

import { ManualFactCardLoader } from "@/components/admin/ManualFactCardLoader";

export default function ManualFactCardLoaderPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 py-8 px-4">
      <div className="rounded-lg border border-brand-blue/20 bg-brand-white p-4 text-sm">
        <div className="font-medium text-brand-navy">New unified Fact Card ops page</div>
        <div className="text-xs text-brand-navy/70 mt-1">
          For batch parsing + review queue + templates + manual loader with URL/upload/text in one place, use{" "}
          <a className="underline" href="/admin/efl/fact-cards">
            /admin/efl/fact-cards
          </a>
          .
        </div>
      </div>
      <ManualFactCardLoader />
    </div>
  );
}


