import type { ReactNode } from 'react';

const benefits = [
  { icon: '🎯', text: 'Completely free to join—no purchases or commitments required.' },
  { icon: '💸', text: 'Earn entries by connecting Smart Meter Texas, uploading usage, and completing your profile details.' },
  { icon: '🔁', text: 'Keep profile entries active by refreshing your usage data at least every 12 months.' },
  { icon: '💰', text: 'Monthly jackpot grows by $5 whenever a member switches to a commissionable plan through IntelliWatt™.' },
  { icon: '🏆', text: 'One verified winner is selected monthly and paid via digital wallet or check.' },
  { icon: '🏠', text: 'See where your home uses energy and uncover opportunities to reduce waste.' },
  { icon: '⚡', text: 'Secure Smart Meter Texas integration lets IntelliWatt™ pull usage data automatically with your permission.' },
  { icon: '📈', text: 'Track usage trends over time and receive tailored recommendations.' },
  { icon: '👥', text: 'Earn an entry for every friend who shares their usage—referrals have no cap and never expire.' },
  { icon: '🗣️', text: 'Eligible customers can submit testimonials for an additional entry that never expires.' },
  { icon: '📊', text: 'Personalized savings reports highlight best-fit plans, appliances, and upgrades.' },
  { icon: '🚫', text: 'No pressure—recommendations always focus on what saves you the most.' },
  { icon: '🔒', text: 'Usage data is safeguarded with secure handling and is never sold to third parties.' },
  { icon: '📱', text: 'Optimized for mobile so you can check entries and insights from any device.' },
  { icon: '🧠', text: 'Powered by AI that blends usage, weather, and efficiency data for smarter guidance.' },
  { icon: '🎉', text: 'Prefer mail-in? The AMOE postcard option keeps entries available without sharing usage.' },
] as const satisfies Array<{ icon: string; text: string }>;

const Section = ({ children }: { children: ReactNode }) => (
  <section className="py-16 px-4 bg-white">
    <div className="max-w-5xl mx-auto">{children}</div>
  </section>
);

export default function BenefitsPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_55%)]" />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-brand-white mb-6">
            Why Join <span className="text-brand-blue">HitTheJackWatt™</span>?
          </h1>
          <p className="text-xl text-brand-white/90 max-w-3xl mx-auto leading-relaxed">
            HitTheJackWatt™ rewards smart energy decisions—no pressure, no sales, just savings and prizes that grow with the community.
          </p>
        </div>
      </section>

      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          {benefits.map((benefit) => (
            <div
              key={benefit.text}
              className="flex items-start gap-4 rounded-2xl border border-brand-blue/30 bg-brand-navy p-6 shadow-[0_15px_40px_rgba(15,23,42,0.3)] transition hover:border-brand-blue/60"
            >
              <span
                aria-hidden
                className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-brand-blue/20 text-lg text-brand-blue shadow-[0_10px_20px_rgba(59,130,246,0.35)]"
              >
                {benefit.icon}
              </span>
              <p className="text-brand-blue/90 leading-relaxed">{benefit.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="rounded-2xl border border-brand-blue/20 bg-brand-blue/5 px-8 py-10 text-center shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
          <p className="text-lg md:text-xl text-brand-navy font-semibold mb-4">
            The earlier you join, the better your odds—keep your usage current so profile entries stay active.
          </p>
          <a
            href="/join"
            className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-6 py-3 text-sm font-semibold uppercase tracking-wide text-brand-blue hover:border-brand-blue hover:text-brand-blue transition"
          >
            Join IntelliWatt™
            <span aria-hidden>→</span>
          </a>
        </div>
      </Section>

      <Section>
        <div className="rounded-2xl border border-brand-navy/15 bg-white px-8 py-10 shadow-[0_24px_60px_rgba(15,23,42,0.08)] text-center">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">Ready to Start Winning?</h2>
          <p className="text-brand-navy/80 mb-6">
            Sign up now to get your first entry and start maximizing your chances to win.
          </p>
          <a
            href="/join"
            className="inline-flex items-center gap-2 rounded-full border border-brand-navy px-6 py-3 text-sm font-semibold uppercase tracking-wide text-brand-navy hover:border-brand-blue hover:text-brand-blue transition"
          >
            Sign Up Now
            <span aria-hidden>→</span>
          </a>
        </div>
      </Section>
    </div>
  );
}

