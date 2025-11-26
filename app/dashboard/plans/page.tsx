import Link from "next/link";
import DashboardHero from "@/components/dashboard/DashboardHero";

export default function PlansPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Energy"
        highlight="Plans"
        description="We monitor pricing from multiple providers and stack it against your actual usage data. When your current plan stops delivering, IntelliWatt surfaces better options automatically."
      />

      <section className="bg-brand-white pt-4 pb-8 px-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
          <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-8 text-brand-cyan shadow-[0_30px_60px_rgba(10,20,60,0.45)]">
            <h2 className="text-2xl font-semibold text-brand-cyan">Coming Soon: Live Plan Comparisons</h2>
            <p className="mt-4 text-brand-cyan/80 leading-relaxed">
              IntelliWatt will soon generate side-by-side comparisons of every plan that fits your household, including hidden fees,
              time-of-use perks, and early termination penalties.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-brand-cyan/75">
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Real savings projections based on your Smart Meter Texas usage.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Automatic alerts when renewal pricing spikes above market offers.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Jackpot boosts for switching through IntelliWatt and confirming the results.</span>
              </li>
            </ul>
          </div>

          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/80 p-8 text-center text-brand-cyan shadow-[0_24px_50px_rgba(10,20,60,0.4)]">
            <p className="text-sm text-brand-cyan/75">
              Add your current rate details now so we can flag bill changes early and make your next switch effortless.
            </p>
            <Link
              href="/dashboard/current-rate-details"
              className="mt-5 inline-flex items-center rounded-full border border-brand-blue/60 bg-brand-blue/15 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/25"
            >
              Enter Plan Details
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}