export default function AppliancesPage() {
  return (
    <div className="min-h-[calc(100vh-120px)] overflow-x-hidden bg-slate-50/60 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 sm:px-6 lg:px-0">
        <section className="relative overflow-hidden rounded-3xl border border-brand-navy/10 bg-white shadow-[0_28px_80px_rgba(16,46,90,0.08)]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-blue/20 via-transparent to-brand-cyan/25 opacity-80" />
          <div className="relative z-10 space-y-8 p-6 sm:p-10">
            <header className="space-y-4 text-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-cyan">
                Smart Appliance Hub
              </span>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
                  Connect every device and watch IntelliWatt call the plays
                </h1>
                <p className="mx-auto max-w-2xl text-sm leading-relaxed text-brand-slate">
                  Soon you&apos;ll sync washers, dryers, EV chargers, thermostats, and more—so IntelliWatt can pinpoint energy hogs, trigger savings automations, and reward you for staying efficient.
                </p>
              </div>
            </header>

            <div className="space-y-6 rounded-2xl border border-brand-blue/15 bg-white/95 p-6 shadow-sm">
              <div className="rounded-2xl border border-brand-blue/20 bg-brand-blue/5 p-6 text-left">
                <h2 className="text-lg font-semibold text-brand-navy">Coming soon: live device intelligence</h2>
                <p className="mt-3 text-sm text-brand-slate">
                  Pair your smart home tech to unlock real-time usage snapshots, milestone badges, and custom coaching nudges when a device drifts off mission.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-brand-navy">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Automatic detection of high-impact appliances and vampire loads</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Goal tracking for laundry, cooking, HVAC, EV charging, and more</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Jackpot bonus missions when you tame the top three energy offenders</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-brand-navy/20 bg-brand-navy/5 p-6 text-center">
                <p className="text-sm text-brand-navy">
                  Want to be first in line? Keep your smart device credentials handy—Bluetooth, Wi-Fi, and cloud integrations are rolling out tier by tier with early access invitations.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
} 