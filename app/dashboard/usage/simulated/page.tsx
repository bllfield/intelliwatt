import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardHero from "@/components/dashboard/DashboardHero";
import SmtAddressCaptureCard from "@/components/smt/SmtAddressCaptureCard";
import { loadUsageEntryContext } from "../../api/context";
import { UsageSimulatorClient } from "@/components/usage/UsageSimulatorClient";

export default async function UsageSimulatorPage() {
  const context = await loadUsageEntryContext();
  const { user, houseAddress } = context;

  if (context.loadError) {
    return (
      <div className="min-h-screen bg-brand-white">
        <DashboardHero
          title="Usage"
          highlight="Simulator"
          description="We’re having trouble loading your dashboard right now. Please wait a moment and refresh."
        />
        <section className="bg-brand-white px-4 pb-12 pt-4">
          <div className="mx-auto w-full max-w-5xl space-y-4">
            <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800">
              Temporarily unavailable: {context.loadError}
            </div>
            <Link
              href="/dashboard"
              className="inline-flex items-center text-sm font-semibold text-brand-navy underline-offset-4 hover:underline"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (!user) {
    redirect("/login?redirect=/dashboard/usage/simulated");
  }

  if (!houseAddress) {
    return (
      <div className="min-h-screen bg-brand-white">
        <DashboardHero
          title="Usage"
          highlight="Simulator"
          description="Add the service address you want IntelliWatt to analyze. Once it’s on file, you can use the simulator to enter manual usage, fill in home details, and model scenarios."
        />
        <section className="bg-brand-white px-4 pb-12 pt-4">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            <SmtAddressCaptureCard houseAddressId={null} initialAddress={null} />
            <Link
              href="/dashboard"
              className="inline-flex items-center text-sm font-semibold text-brand-navy underline-offset-4 hover:underline"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Usage"
        highlight="Simulator"
        description="Use manual totals, new-build estimates, or an SMT baseline to build and reshape a full 12‑month simulated curve."
      />

      <section className="bg-brand-white px-4 pb-12 pt-4">
        <div className="mx-auto w-full max-w-6xl">
          <UsageSimulatorClient houseId={houseAddress.id} />
        </div>
      </section>
    </div>
  );
}

