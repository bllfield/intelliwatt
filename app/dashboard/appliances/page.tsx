import DashboardHero from '@/components/dashboard/DashboardHero';

export default function AppliancesPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Smart"
        highlight="Appliances"
        description="Soon you’ll sync washers, dryers, EV chargers, thermostats, and more—so IntelliWatt can pinpoint energy hogs, trigger savings automations, and reward you for staying efficient."
      />

      <section className="bg-brand-white pt-4 pb-8 px-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
          <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-8 text-brand-cyan shadow-[0_30px_60px_rgba(10,20,60,0.45)]">
            <h2 className="text-2xl font-semibold text-brand-cyan">Coming Soon: Live Device Intelligence</h2>
            <p className="mt-4 text-brand-cyan/80 leading-relaxed">
              Pair your smart home tech to unlock real-time usage snapshots, milestone badges, and coaching nudges when any device drifts off mission.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-brand-cyan/75">
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Automatic detection of high-impact appliances and vampire loads.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Goal tracking for laundry, cooking, HVAC, EV charging, and more.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Jackpot bonus missions when you tame the top three energy offenders.</span>
              </li>
            </ul>
          </div>

          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-8 text-center text-brand-cyan shadow-[0_24px_50px_rgba(10,20,60,0.4)]">
            <p className="text-sm text-brand-cyan/75">
              Want to be first in line? Keep your smart device credentials handy—Bluetooth, Wi-Fi, and cloud integrations are rolling out tier by tier with early access invitations.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}