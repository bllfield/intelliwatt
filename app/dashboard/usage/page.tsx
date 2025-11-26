import DashboardHero from '@/components/dashboard/DashboardHero';

export default function UsagePage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Energy"
        highlight="Usage"
        description="Track your electricity consumption patterns, surface peak intervals, and uncover the fastest ways to cut waste."
      />

      <section className="bg-brand-white pt-4 pb-8 px-4">
        <div className="mx-auto max-w-4xl space-y-8">
          <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-8 text-brand-cyan shadow-[0_30px_60px_rgba(10,20,60,0.45)] text-center">
            <div className="text-5xl mb-4">⚡</div>
            <h2 className="text-2xl font-semibold text-brand-cyan">Coming Soon</h2>
            <p className="mt-4 text-brand-cyan/80 leading-relaxed">
              IntelliWatt is preparing detailed dashboards to help you visualize electricity trends, react to spikes, and
              see how behavioral changes impact your bill in real time.
            </p>
          </div>

          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-8 text-brand-cyan shadow-[0_24px_50px_rgba(10,20,60,0.4)]">
            <h3 className="text-lg font-semibold uppercase tracking-[0.3em] text-brand-cyan/70 text-center mb-6">
              Features on the roadmap
            </h3>
            <ul className="space-y-3 text-sm text-brand-cyan/75">
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Real-time usage monitoring with alerts when consumption spikes above normal.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Historical trends that highlight seasonal shifts and unusual demand.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Peak hour identification so you can shift major loads to cheaper times.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Cost projections that show how plan changes or upgrades impact future bills.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

