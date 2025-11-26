export default function UpgradesPage() {
  return (
    <div className="min-h-[calc(100vh-120px)] overflow-x-hidden bg-slate-50/60 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 sm:px-6 lg:px-0">
        <section className="relative overflow-hidden rounded-3xl border border-brand-navy/10 bg-white shadow-[0_28px_80px_rgba(16,46,90,0.08)]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-blue/20 via-transparent to-brand-cyan/25 opacity-80" />
          <div className="relative z-10 space-y-8 p-6 sm:p-10">
            <header className="space-y-4 text-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-cyan">
                Upgrade Launchpad
              </span>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
                  Turn renovation wishlists into verified savings plans
                </h1>
                <p className="mx-auto max-w-2xl text-sm leading-relaxed text-brand-slate">
                  We&apos;re building an engine that weighs insulation, HVAC, solar, storage, windows, and smart-home upgrades against your actual usage—so you only invest where the math wins.
                </p>
              </div>
            </header>

            <div className="space-y-6 rounded-2xl border border-brand-blue/15 bg-white/95 p-6 shadow-sm">
              <div className="rounded-2xl border border-brand-blue/20 bg-brand-blue/5 p-6 text-left">
                <h2 className="text-lg font-semibold text-brand-navy">Coming soon: renovation ROI scorecards</h2>
                <p className="mt-3 text-sm text-brand-slate">
                  Plug in planned upgrades or let IntelliWatt spot the big wins. We’ll surface cost, rebates, savings, payback windows, and jackpot bonuses for every project that moves the needle.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-brand-navy">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Compare insulation, HVAC, appliance, and window upgrades side-by-side</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Simulate solar + battery combos against current utility rates</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Auto-apply incentives, rebates, and low-cost financing programs</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Unlock seasonal jackpot challenges when you tackle priority projects</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-brand-navy/20 bg-brand-navy/5 p-6 text-center">
                <p className="text-sm text-brand-navy">
                  Keep your wish list handy—the upgrade wizard will arrive with personalized alerts the moment we crunch the final savings models for your home.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
} 