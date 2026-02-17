import { Suspense } from "react";
import ImpersonateClient from "./ImpersonateClient";

export const dynamic = "force-dynamic";

export default function HelpdeskImpersonatePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="text-brand-navy/70">Loading…</div>
        </div>
      }
    >
      <ImpersonateClient />
    </Suspense>
  );
}

