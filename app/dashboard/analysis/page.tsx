import DashboardHero from '@/components/dashboard/DashboardHero';

export default function AnalysisPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        eyebrow="Energy Intelligence Lab"
        title="Energy"
        highlight="Analysis"
        description="Our analytics cockpit is almost ready—expect intuitive charts, anomaly alerts, and action cards that translate raw usage into crystal-clear next steps."
      />

      <section className="bg-brand-white py-12 px-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
          <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-8 text-brand-cyan shadow-[0_30px_60px_rgba(10,20,60,0.45)]">
            <h2 className="text-2xl font-semibold text-brand-cyan">Coming Soon: IntelliWatt Dashboard 2.0</h2>
            <p className="mt-4 text-brand-cyan/80 leading-relaxed">
              Dive into usage streaks, plan performance, and forecasted bills—with proactive nudges that keep you ahead of renewals and jackpot missions.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-brand-cyan/75">
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Usage breakdowns by appliance, time of day, and tariff tier.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Plan scorecards that show real savings versus your current rate.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Alerts for unusual spikes with recommended fixes.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Upcoming solar + battery simulations tailored to your home.</span>
              </li>
            </ul>
          </div>

          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/80 p-8 text-center text-brand-cyan shadow-[0_24px_50px_rgba(10,20,60,0.4)]">
            <p className="text-sm text-brand-cyan/75">
              Keep connecting devices and updating your home profile—the richer your data today, the more insights we unleash when this lab goes live.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}