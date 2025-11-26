import Link from 'next/link';
import DashboardHero from '@/components/dashboard/DashboardHero';

export default function OptimalEnergyPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Optimal"
        highlight="Energy"
        description="We’re dialing in a concierge that compares every live offer, projected renewal, and hidden fee—then auto-populates a switch plan you can trust."
      />

      <section className="bg-brand-white py-12 px-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
          <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-8 text-brand-cyan shadow-[0_30px_60px_rgba(10,20,60,0.45)]">
            <h2 className="text-2xl font-semibold text-brand-cyan">Coming Soon: Auto-Switch Intelligence</h2>
            <p className="mt-4 text-brand-cyan/80 leading-relaxed">
              The Optimal Energy engine crunches interval data, plan perks, early termination fees, and jackpot bonuses to surface the move that protects your bill without sacrificing comfort.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-brand-cyan/75">
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Side-by-side comparisons of your renewal versus the top market offers.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Automated enrollment packets with provider-ready details.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Jackpot boosts when you switch through IntelliWatt and share results.</span>
              </li>
            </ul>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-3xl border border-brand-cyan/25 bg-brand-navy/80 p-8 text-center text-brand-cyan shadow-[0_24px_50px_rgba(10,20,60,0.4)] sm:flex-row sm:justify-between">
            <p className="text-sm text-brand-cyan/75">
              While we finalize the switching experience, explore the analysis lab to see projected savings based on your current usage profile.
            </p>
            <Link
              href="/dashboard/analysis"
              className="inline-flex items-center rounded-full border border-brand-blue/60 bg-brand-blue/15 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/25"
            >
              Review Energy Analysis
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
