"use client";

import { CurrentRateDetailsForm } from "@/components/CurrentRateDetailsForm";
import DashboardHero from "@/components/dashboard/DashboardHero";
import { useRouter } from "next/navigation";

export default function CurrentRatePage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Current"
        highlight="Rate"
        description="Share the plan you’re on today so IntelliWatt can highlight how renewal pricing compares to our recommendations. Upload a bill or enter the details manually—you’ll still get personalized matches either way."
      />

      <section className="bg-brand-white pt-4 pb-8 px-4">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-3xl border border-brand-cyan/25 bg-white p-8 shadow-[0_28px_60px_rgba(16,46,90,0.12)]">
            <CurrentRateDetailsForm
              onContinue={(data) => {
                console.log("Current rate details submitted:", data);
                try {
                  const last = (window.localStorage.getItem("dashboard_compare_last_offer_id_v1") ?? "").trim();
                  if (last) {
                    router.push(`/dashboard/plans/compare/${encodeURIComponent(last)}`);
                    return;
                  }
                } catch {
                  // ignore
                }
                router.push("/dashboard/plans/compare");
              }}
              onSkip={() => {
                console.log("Current rate details skipped; proceed to plan analyzer.");
                router.push("/dashboard/plans");
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
