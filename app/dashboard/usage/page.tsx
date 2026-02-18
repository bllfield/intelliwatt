"use client";

import DashboardHero from "@/components/dashboard/DashboardHero";
import UsageDashboard from "@/components/usage/UsageDashboard";

export default function UsagePage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Energy"
        highlight="Usage"
        description="Review how your household consumes electricity. IntelliWatt automatically favors the most recent data source (SMT or Green Button) so the insights below always reflect fresh usage."
      />

      <section className="bg-brand-white px-4 pb-12 pt-4">
        <div className="mx-auto w-full max-w-6xl">
          <UsageDashboard forcedMode="REAL" allowModeToggle={false} />
        </div>
      </section>
    </div>
  );
}

