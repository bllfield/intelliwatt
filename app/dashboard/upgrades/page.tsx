import DashboardHero from '@/components/dashboard/DashboardHero';

export default function UpgradesPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        eyebrow="Upgrade Launchpad"
        title="Home"
        highlight="Upgrades"
        description="We’re building an engine that weighs insulation, HVAC, solar, storage, windows, and smart-home upgrades against your actual usage—so you only invest where the math wins."
      />

      <section className="bg-brand-white py-12 px-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
          <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-8 text-brand-cyan shadow-[0_30px_60px_rgba(10,20,60,0.45)]">
            <h2 className="text-2xl font-semibold text-brand-cyan">Coming Soon: Renovation ROI Scorecards</h2>
            <p className="mt-4 text-brand-cyan/80 leading-relaxed">
              Plug in planned upgrades or let IntelliWatt spot the big wins. We’ll surface cost, rebates, savings, payback windows,
              and jackpot bonuses for every project that moves the needle.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-brand-cyan/75">
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Compare insulation, HVAC, appliance, and window upgrades side-by-side.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Simulate solar + battery combos against current utility rates.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Auto-apply incentives, rebates, and low-cost financing programs.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Unlock seasonal jackpot challenges when you tackle priority projects.</span>
              </li>
            </ul>
          </div>

          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/80 p-8 text-center text-brand-cyan shadow-[0_24px_50px_rgba(10,20,60,0.4)]">
            <p className="text-sm text-brand-cyan/75">
              Keep your wish list handy—the upgrade wizard will arrive with personalized alerts the moment we crunch the final savings models for your home.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}