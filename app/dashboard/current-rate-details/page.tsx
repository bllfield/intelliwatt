import { CurrentRateDetailsForm } from '@/components/CurrentRateDetailsForm';

export default function CurrentRateDetailsPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_55%)]" />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-brand-white mb-6">
            Current Rate <span className="text-brand-blue">Details</span>
          </h1>
          <p className="text-xl text-brand-white/90 max-w-3xl mx-auto leading-relaxed">
            Share your current electricity plan so IntelliWatt™ can highlight how costs shift when the contract renews.
            Completing this step earns one{' '}
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-blue underline decoration-transparent transition hover:decoration-brand-blue"
            >
              HitTheJackWatt™
            </a>{' '}
            entry.
          </p>
        </div>
      </section>

      <section className="py-16 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <CurrentRateDetailsForm />
        </div>
      </section>
    </div>
  );
}
