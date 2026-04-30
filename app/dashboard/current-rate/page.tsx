"use client";

import { CurrentRateDetailsForm } from "@/components/CurrentRateDetailsForm";
import DashboardHero from "@/components/dashboard/DashboardHero";
import { useRouter, useSearchParams } from "next/navigation";

export default function CurrentRatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showCompareRequiredNotice =
    searchParams.get("from") === "compare" && searchParams.get("reason") === "current_plan_required";
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Current"
        highlight="Rate"
        description="Share the plan you’re on today so IntelliWatt can highlight how renewal pricing compares to our recommendations. Upload a bill or enter the details manually—you’ll still get personalized matches either way."
      />

      <section className="bg-brand-white pt-4 pb-8 px-4">
        <div className="mx-auto max-w-5xl">
          {showCompareRequiredNotice ? (
            <div className="mb-4 rounded-2xl border border-brand-cyan/30 bg-brand-cyan/10 px-5 py-4 text-sm text-brand-navy shadow-[0_18px_40px_rgba(16,46,90,0.10)]">
              Enter or confirm your current plan first, then IntelliWatt can take you to the side-by-side compare view.
            </div>
          ) : null}
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
