import Link from 'next/link';

export default function OptimalEnergyPage() {
  return (
    <div className="min-h-[calc(100vh-120px)] overflow-x-hidden bg-slate-50/60 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 sm:px-6 lg:px-0">
        <section className="relative overflow-hidden rounded-3xl border border-brand-navy/10 bg-white shadow-[0_28px_80px_rgba(16,46,90,0.08)]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-blue/20 via-transparent to-brand-cyan/25 opacity-80" />
          <div className="relative z-10 space-y-8 p-6 sm:p-10">
            <header className="space-y-4 text-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-cyan">
                Optimal Energy Engine
              </span>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
                  Let IntelliWatt pick the plan that beats your renewal every time
                </h1>
                <p className="mx-auto max-w-2xl text-sm leading-relaxed text-brand-slate">
                  We&apos;re dialing in a concierge that compares every live offer, projected renewal, and hidden fee—then auto-populates a switch plan you can trust.
                </p>
              </div>
            </header>

            <div className="space-y-6 rounded-2xl border border-brand-blue/15 bg-white/95 p-6 shadow-sm">
              <div className="rounded-2xl border border-brand-blue/20 bg-brand-blue/5 p-6 text-left">
                <h2 className="text-lg font-semibold text-brand-navy">Coming soon: auto-switch intelligence</h2>
                <p className="mt-3 text-sm text-brand-slate">
                  The Optimal Energy engine crunches interval data, plan perks, early termination fees, and jackpot bonuses to surface the move that protects your bill without sacrificing comfort.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-brand-navy">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Side-by-side comparisons of your renewal vs. top market offers</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Automated enrollment packets with provider-ready details</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Jackpot boosts when you switch through IntelliWatt and share results</span>
                  </li>
                </ul>
              </div>

              <div className="flex flex-col items-center gap-4 rounded-2xl border border-brand-navy/20 bg-brand-navy/5 p-6 text-center sm:flex-row sm:justify-between">
                <p className="text-sm text-brand-navy">
                  While we finalize the switching experience, explore the analysis lab to see projected savings based on your current usage profile.
                </p>
                <Link
                  href="/dashboard/analysis"
                  className="inline-flex items-center rounded-full border-2 border-brand-navy bg-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue"
                >
                  Review energy analysis
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
