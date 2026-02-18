import { Suspense } from "react";
import { CommissionsClient } from "./CommissionsClient";

export const dynamic = "force-dynamic";

export default function AdminCommissionsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="text-sm text-brand-navy/70">Loading…</div>
        </div>
      }
    >
      <CommissionsClient />
    </Suspense>
  );
}

