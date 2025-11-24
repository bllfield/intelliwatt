import Link from 'next/link';

export default function OptimalEnergyPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="max-w-2xl bg-white border-2 border-brand-navy rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-brand-navy mb-4">Optimal Energy</h1>
        <p className="text-brand-navy mb-6">
          Personalized plan optimization is coming soon. We&apos;re building tools to surface the best option based on your real usage data, pricing projections, and household preferences.
        </p>
        <Link
          href="/dashboard/analysis"
          className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300"
        >
          Review Energy Analysis
        </Link>
      </div>
    </div>
  );
}
