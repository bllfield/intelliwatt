import Link from "next/link";
import { redirect } from "next/navigation";
import { loadUsageEntryContext } from "../context";
import DashboardHero from "@/components/dashboard/DashboardHero";
import SmtAddressCaptureCard from "@/components/smt/SmtAddressCaptureCard";
import SmtManualFallbackCard from "@/components/smt/SmtManualFallbackCard";
import { ManualUsageEntry } from "@/components/manual/ManualUsageEntry";

// User-specific (cookies) so dynamic, but allow router to cache for back/forward.

export default async function UsageEntryManualPage() {
  const context = await loadUsageEntryContext();
  const { user, houseAddress } = context;

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
            <Link href="/dashboard/api" className="inline-flex items-center text-sm font-semibold text-brand-blue underline-offset-4 hover:underline">
              ← Back to Usage Entry hub
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (!user) {
    redirect("/login?redirect=/dashboard/api/manual");
  }

  if (!houseAddress) {
    return (
      <div className="min-h-screen bg-brand-white">
        <DashboardHero
          title="Usage Entry"
          highlight="Manual Usage"
          description="Add the service address you want IntelliWatt to analyze. Once it’s on file, you can enter your manual kWh totals to generate a simulated usage curve."
        />
        <section className="bg-brand-white px-4 pb-12 pt-4">
          <div className="mx-auto w-full max-w-4xl space-y-6">
            <SmtAddressCaptureCard houseAddressId={null} initialAddress={null} />
            <Link
              href="/dashboard/api"
              className="inline-flex items-center text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
            >
              ← Back to Usage Entry hub
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Usage Entry"
        highlight="Manual Usage"
        description="Enter monthly or annual kWh totals to generate a simulated 15-minute interval usage curve for IntelliWatt comparisons."
      />

      <section className="bg-brand-white px-4 pb-12 pt-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <Link
            href="/dashboard/api"
            className="inline-flex items-center text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
          >
            ← Back to Usage Entry hub
          </Link>
          <ManualUsageEntry houseId={houseAddress.id} />
          <SmtManualFallbackCard houseAddressId={houseAddress.id} />
        </div>
      </section>
    </div>
  );
}

