import Link from "next/link";
import { redirect } from "next/navigation";
import { loadUsageEntryContext } from "../context";
import DashboardHero from "@/components/dashboard/DashboardHero";

// User-specific (cookies) so dynamic, but allow router to cache for back/forward.

export default async function UsageEntryManualPage() {
  const context = await loadUsageEntryContext();
  const { user } = context;

  if (context.loadError) {
    return (
      <div className="min-h-screen bg-brand-white">
        <DashboardHero
          title="Usage Entry"
          highlight="Manual Usage"
          description="We’re having trouble loading your dashboard right now. Please wait a moment and refresh."
        />
        <section className="bg-brand-white px-4 pb-12 pt-4">
          <div className="mx-auto w-full max-w-4xl space-y-4">
            <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800">
              Temporarily unavailable: {context.loadError}
            </div>
            <Link href="/dashboard/api" className="inline-flex items-center text-sm font-semibold text-brand-navy underline-offset-4 hover:underline">
              ← Back to Usage Entry hub
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (!user) {
    redirect("/login?redirect=/dashboard/usage/simulated");
  }

  // Manual totals entry is simulator-only now.
  redirect("/dashboard/usage/simulated?intent=MANUAL#start-here");
}

