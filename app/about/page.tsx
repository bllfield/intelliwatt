'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

const RoyalBlueLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="font-semibold"
    style={{ color: '#4169E1', textDecoration: 'underline' }}
  >
    {children}
  </Link>
);

const NeonBlueLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="font-semibold"
    style={{ color: '#00E0FF', textShadow: '0 0 12px rgba(0,224,255,0.7)', textDecoration: 'underline' }}
  >
    {children}
  </Link>
);

const NeonGreenLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="font-semibold"
    style={{ color: '#39FF14', textShadow: '0 0 12px rgba(57,255,20,0.7)', textDecoration: 'underline' }}
  >
    {children}
  </Link>
);

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <section className="relative overflow-hidden bg-brand-navy px-4 py-20">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(0,224,255,0.18),transparent_55%)]" />
        </div>

        <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center text-center">
          <h1 className="text-5xl font-bold text-brand-white md:text-6xl">
            Meet <span className="text-brand-blue">IntelliWatt™</span>
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-brand-white/80 md:text-xl">
            We turn energy confusion into confidence—leveraging your real usage, intuitive tools, and honest guidance so
            you can make the smartest power decisions without the pressure.
          </p>
        </div>
      </section>

      <section className="px-4 py-20">
        <div className="mx-auto max-w-4xl space-y-12 text-brand-navy">
          <div className="rounded-3xl border border-brand-blue/40 bg-brand-navy p-8 text-brand-cyan shadow-[0_24px_70px_rgba(16,46,90,0.45)] sm:p-10">
            <h2 className="text-3xl font-bold text-[#00E0FF]">Why We Exist</h2>
            <div className="mt-6 space-y-4 text-brand-cyan/85 leading-relaxed">
              <p>
                Welcome. If you came to us from <NeonGreenLink href="https://www.hitthejackwatt.com">HitTheJackWatt™</NeonGreenLink>, our friendly
                public-facing gateway, you’re in the right place. What starts as an easy, approachable entry becomes something powerful behind the
                scenes.
              </p>
              <p>
                <NeonBlueLink href="https://www.intelliwatt.com">IntelliWatt™</NeonBlueLink> was built to help homeowners make sense of their energy
                world. We use your real energy usage—whether from smart meter feeds, uploads, or device data—and turn it into clear, honest insight:
                what you’re paying now, where you might save, and what options make sense for your home and budget.
              </p>
              <p>
                We believe energy decisions should be simple to understand, not confusing or pressured. That is why we give you real numbers, honest
                trade-offs, and genuine choices, and then let you decide what is right for you.
              </p>
              <p>
                If you ever choose to act—maybe switch electricity plans, explore solar or batteries, or upgrade your home—that is great. If you want
                help coordinating with trusted partners, that is where <RoyalBlueLink href="https://www.intellipath-solutions.com">Intellipath Solutions LLC</RoyalBlueLink>, the
                parent company behind <NeonBlueLink href="https://www.intelliwatt.com">IntelliWatt</NeonBlueLink>, can step in. There is no sales force
                knocking at your door; only optional support for projects you decide to take on.
              </p>
              <p>
                Our commitment is straightforward: transparency, empowerment, and respect. The more data you share—meter history, home details,
                appliance usage, solar or battery interest—the sharper and more personalized our guidance becomes. We build tools that help you
                understand your options, weigh them honestly, and decide what fits your life.
              </p>
              <p>
                Whether you are casually exploring or serious about savings, we are here to help you see clearly, compare realistically, and choose
                confidently.
              </p>
              <p className="font-semibold" style={{ color: '#39FF14', textShadow: '0 0 12px rgba(57,255,20,0.7)' }}>
                Your energy. Your data. Your choice.
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-brand-blue/20 bg-brand-white/95 p-8 shadow-[0_18px_60px_rgba(16,46,90,0.12)] sm:p-10">
            <h2 className="text-3xl font-bold text-brand-navy">Who We Are</h2>
            <div className="mt-6 space-y-4 text-lg leading-relaxed text-brand-slate">
              <p>
                IntelliWatt™ is built and operated by{' '}
                <RoyalBlueLink href="https://www.intellipath-solutions.com">Intellipath Solutions LLC</RoyalBlueLink>. We are energy nerds,
                technologists, and consumer advocates who want every household to have insider-level access to the best electricity options—without
                the industry jargon or sales pressure.
              </p>
              <p>
                We are relentless about security, data privacy, and doing right by our members. Everything we build must pass a simple test: does it
                earn and keep your trust? If the answer is not a clear yes, it does not ship.
              </p>
              <p>
                Curious about the roadmap or want to partner? Reach us at{' '}
                <a
                  href="mailto:partnerships@intellipath-solutions.com"
                  className="font-semibold text-brand-blue underline decoration-brand-blue/40 hover:text-brand-navy"
                >
                  partnerships@intellipath-solutions.com
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-brand-navy px-4 py-24">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <h2 className="text-4xl font-bold text-brand-white md:text-5xl">
            Ready to experience <span className="text-brand-blue">IntelliWatt™</span>?
          </h2>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-brand-white/80">
            Join the thousands already using our smart recommendations and jackpot rewards to take control of their energy future.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <a
              href="/join"
              className="rounded-full bg-brand-blue px-10 py-4 text-lg font-semibold text-brand-navy transition hover:bg-brand-cyan hover:text-brand-navy"
            >
              Get Started Free
            </a>
            <a
              href="/how-it-works"
              className="rounded-full border-2 border-brand-blue px-10 py-4 text-lg font-semibold text-brand-white transition hover:bg-brand-blue"
            >
              Explore How It Works
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

