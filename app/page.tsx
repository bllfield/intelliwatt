"use client";

import React, { useEffect, useMemo, useState, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import IntelliwattBotHero from '@/components/dashboard/IntelliwattBotHero';

function LandingPageContent() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [publicStats, setPublicStats] = useState<any>(null);
  const searchParams = useSearchParams();
  const from = searchParams?.get('from');
  const source = searchParams?.get('source');
  const showJackpotBanner = from === 'htjw' || source === 'jackpot';

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/public/stats', { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && json?.ok === true) {
          setPublicStats(json);
        }
      } catch {
        // best-effort only
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const testimonials = [
    {
      name: 'Jessica L.',
      initials: 'JL',
      location: 'Fort Worth, TX',
      quote:
        "I didn't realize I was overpaying by $75/month. The site helped me switch in minutes. No calls, no hassle — just cheaper power. And now I'm entered every month for free money!",
    },
    {
      name: 'Marcus R.',
      initials: 'MR',
      location: 'Dallas, TX',
      quote:
        "I referred my sister and 3 friends, and each one unlocked another entry for me. If I win this jackpot, I'm taking my family on a weekend getaway.",
    },
    {
      name: 'Sandra M.',
      initials: 'SM',
      location: 'Arlington, TX',
      quote:
        "I switched to a plan that's 4¢ cheaper per kWh and I didn't have to pay anything. I like that this isn't some scammy sales site. It's legit.",
    },
    {
      name: 'Michelle T.',
      initials: 'MT',
      location: 'San Antonio, TX',
      quote:
        "As a single mom with three kids, every dollar counts. HitTheJackWatt™ found me a plan that's saving me over $600 a year. That's a month of groceries for us!",
    },
    {
      name: 'Robert K.',
      initials: 'RK',
      location: 'Austin, TX',
      quote:
        "I'm skeptical of most 'free' things, but this was actually free and saved me money. No spam calls, no high-pressure sales, just good information and a better rate.",
    },
    {
      name: 'Tyler J.',
      initials: 'TJ',
      location: 'Frisco, TX',
      quote:
        "The energy insights were eye-opening. I had no idea my gaming PC was costing me that much to run! Made some easy adjustments and now I'm saving about 15% on my bill.",
    },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setSubmitted(true);
        setShowSuccessPopup(true);
        // Auto-hide popup after 15 seconds
        setTimeout(() => setShowSuccessPopup(false), 15000);
      } else {
        alert(data.error || 'Failed to send magic link. Please try again.');
      }
    } catch (error) {
      alert('Failed to send magic link. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-white">
      {/* Success Popup */}
        {showSuccessPopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-2xl rounded-3xl border border-brand-blue/40 bg-brand-navy px-8 py-10 text-brand-cyan shadow-[0_30px_90px_rgba(9,16,34,0.7)]">
              <div className="grid gap-4 md:grid-cols-2 md:items-center">
                <div className="text-center md:text-left">
                  <div className="mx-auto md:mx-0 mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-brand-blue/50 bg-brand-blue/10">
                    <svg className="h-8 w-8 text-[#39FF14]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold uppercase tracking-[0.2em] text-brand-cyan/70">Magic Link Sent!</h2>
                  <p className="mt-4 text-base leading-relaxed text-brand-white/90">
                    We emailed a secure magic link to <span className="font-semibold text-[#39FF14]">{email}</span>. Keep this window open and follow the steps below:
                  </p>
                  <ul className="mt-4 space-y-2 rounded-2xl border border-brand-blue/40 bg-brand-blue/10 px-5 py-4 text-left text-sm text-brand-cyan/80">
                    <li>
                      <span className="font-semibold text-brand-cyan">1.</span> Look for an email titled{" "}
                      <span className="font-semibold text-brand-white">"Your IntelliWatt Magic Link"</span>.
                    </li>
                    <li>
                      <span className="font-semibold text-brand-cyan">2.</span> Check spam, junk, or promotions folders if it isn’t in your main inbox.
                    </li>
                    <li>
                      <span className="font-semibold text-brand-cyan">3.</span> Tap the link within <span className="font-semibold text-brand-white">15 minutes</span> to open your HitTheJackWatt™ dashboard powered by IntelliWatt.
                    </li>
                  </ul>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-brand-blue/40 bg-brand-blue/10 p-4 text-left text-sm text-brand-cyan/80">
                    <p className="text-xs uppercase tracking-[0.3em] text-brand-cyan/60 mb-2">HitTheJackWatt Jackpot</p>
                    <p className="text-sm text-brand-white/90">
                      Earn <span className="text-[#39FF14] font-semibold">1 entry</span> when you authorize Smart Meter Texas or connect with Green Button. It grows the community jackpot.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[#BF00FF]/50 bg-[#BF00FF]/10 p-4 text-left text-sm text-[#FFD5F5]/90">
                    <p className="text-xs uppercase tracking-[0.3em] text-[#FF3BCE]/80 mb-2">HitTheJackWatt Referrals</p>
                    <p>
                      Earn <span className="font-semibold text-white">unlimited entries</span> for every friend or family member you refer who connects usage.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSuccessPopup(false)}
                    className="w-full rounded-full border border-brand-blue/60 bg-brand-blue/10 px-8 py-3 text-sm font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:bg-brand-blue/20"
                  >
                    Got it!
                  </button>
                  <p className="text-center text-xs uppercase tracking-[0.3em] text-brand-cyan/60">
                    If you didn’t request this email, you can ignore it.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Hero Section */}
      <section className="relative bg-brand-navy pt-10 pb-10 px-4 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-6xl mx-auto">
          <div className="text-center mb-6">
            {/* Logo */}
            <div className="flex justify-center mb-2">
              <div className="relative w-[36rem] h-[10rem] p-0">
                <Image
                  src="/IntelliWatt Logo TM.png"
                  alt="IntelliWatt™ Logo"
                  fill
                  className="object-contain"
                />
              </div>
            </div>
            
            <h1 className="text-4xl md:text-6xl font-bold text-brand-white mb-3">
              Stop <span className="text-brand-blue">Overpaying</span> for Power
            </h1>
            <p className="text-lg md:text-xl leading-relaxed text-brand-white max-w-3xl mx-auto">
              Join IntelliWatt today to unlock free, personalized energy insights and tools that show you exactly how to save.
            </p>
          </div>

          {/* IntelliWattBot below the main hero section */}
          <div className="mb-6">
            <IntelliwattBotHero />
          </div>

          {/* Everything else in the hero goes below IntelliWattBot */}
          <div className="text-center">
            <div className="mb-10 space-y-4 text-brand-white max-w-3xl mx-auto text-left md:text-center">
              <div className="grid gap-3 text-base md:grid-cols-2 md:text-lg">
                <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 border border-white/15">
                  <span className="text-[#39FF14] text-2xl">✔</span>
                  <span>Join for free and connect your energy data in minutes.</span>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 border border-white/15">
                  <span className="text-[#39FF14] text-2xl">✔</span>
                  <span>Get data-backed plan recommendations tailored to your home.</span>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 border border-white/15">
                  <span className="text-[#39FF14] text-2xl">✔</span>
                  <span>Access tools that reveal usage spikes, hidden fees, and savings opportunities.</span>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 border border-white/15">
                  <span className="text-[#39FF14] text-2xl">✔</span>
                  <span>Earn entries in the HitTheJackWatt jackpot every step of the way.</span>
                </div>
              </div>
              <p className="text-lg text-brand-white/80 md:text-xl">
                Start with your email—no credit card required. We’ll send a secure magic link so you can join now and see where you can save.
              </p>
            </div>

            <div className="mb-8 inline-block bg-white/10 text-white px-4 py-1.5 rounded-full font-semibold border border-white/20">
              💸 100% Free — No fees, ever
            </div>

            <div className="max-w-md mx-auto">
              {!submitted ? (
                <div className="rounded-3xl border border-brand-blue/40 bg-brand-navy/70 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
                  <p className="text-brand-white text-center font-semibold text-lg mb-5">
                    Join now. Your dashboard, recommendations, and entries are waiting.
                  </p>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <label className="block text-brand-white/80 text-sm font-semibold uppercase tracking-wide">
                      Email address
                    </label>
                    <input
                      type="email"
                      placeholder="Enter the email you check the most"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-6 py-4 rounded-full bg-brand-white text-brand-navy placeholder-brand-navy/60 focus:outline-none focus:ring-2 focus:ring-brand-blue text-lg"
                      required
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-[#39FF14] text-brand-navy font-extrabold py-4 px-8 rounded-full text-lg hover:bg-[#5FFF2A] transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-[0_0_25px_rgba(57,255,20,0.4)] disabled:opacity-50"
                    >
                      {isSubmitting ? 'Sending…' : 'Join IntelliWatt For Free'}
                    </button>
                    <p className="text-xs text-brand-white/70 text-center">
                      No password to remember. We email you a secure link so you can join instantly.
                    </p>
                  </form>
                </div>
              ) : (
            <div className="grid md:grid-cols-2 gap-4 mt-10">
              <div className="rounded-2xl border border-[#39FF14]/50 bg-[#39FF14]/10 p-4 text-center shadow-[0_0_25px_rgba(57,255,20,0.25)]">
                <p className="text-xs uppercase tracking-[0.2em] text-[#39FF14] font-semibold mb-2">HitTheJackWatt Jackpot</p>
                <p className="text-brand-white text-lg font-semibold leading-relaxed">
                  Earn <span className="text-[#39FF14]">1 HitTheJackWatt entry</span> when you authorize Smart Meter Texas or connect with Green Button.
                </p>
              </div>
              <div className="rounded-2xl border border-[#BF00FF]/50 bg-[#BF00FF]/10 p-4 text-center shadow-[0_0_25px_rgba(191,0,255,0.25)]">
                <p className="text-xs uppercase tracking-[0.2em] text-[#FF3BCE] font-semibold mb-2">HitTheJackWatt Referrals</p>
                <p className="text-brand-white text-lg font-semibold leading-relaxed">
                  Earn <span className="text-[#FF3BCE]">unlimited entries</span> for every friend or family member you refer.
                </p>
              </div>
            </div>
              )}
            </div>
          </div>

            <div className="max-w-3xl mx-auto grid gap-4 md:grid-cols-2 mt-10">
              <div className="rounded-2xl border border-[#39FF14]/50 bg-[#39FF14]/10 p-4 text-center shadow-[0_0_25px_rgba(57,255,20,0.25)]">
                <p className="text-xs uppercase tracking-[0.2em] text-[#39FF14] font-semibold mb-2">HitTheJackWatt Jackpot</p>
                <p className="text-brand-white text-lg font-semibold leading-relaxed">
                  Earn <span className="text-[#39FF14]">1 HitTheJackWatt entry</span> when you authorize Smart Meter Texas or connect with Green Button.
                </p>
              </div>
              <div className="rounded-2xl border border-[#BF00FF]/50 bg-[#BF00FF]/10 p-4 text-center shadow-[0_0_25px_rgba(191,0,255,0.25)]">
                <p className="text-xs uppercase tracking-[0.2em] text-[#FF3BCE] font-semibold mb-2">HitTheJackWatt Referrals</p>
                <p className="text-brand-white text-lg font-semibold leading-relaxed">
                  Earn <span className="text-[#FF3BCE]">unlimited entries</span> for every friend or family member you refer.
                </p>
              </div>
            </div>

            {/* Email Entry Form */}
            <div className="max-w-xl mx-auto">
              {!submitted ? (
                <div className="rounded-3xl border border-brand-blue/40 bg-brand-navy/70 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
                  <p className="text-brand-white text-center font-semibold text-lg mb-5">
                    Join now. Your dashboard, recommendations, and entries are waiting.
                  </p>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <label className="block text-brand-white/80 text-sm font-semibold uppercase tracking-wide">
                      Email address
                    </label>
                    <input
                      type="email"
                      placeholder="Enter the email you check the most"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-6 py-4 rounded-full bg-brand-white text-brand-navy placeholder-brand-navy/60 focus:outline-none focus:ring-2 focus:ring-brand-blue text-lg"
                      required
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-[#39FF14] text-brand-navy font-extrabold py-4 px-8 rounded-full text-lg hover:bg-[#5FFF2A] transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-[0_0_25px_rgba(57,255,20,0.4)] disabled:opacity-50"
                    >
                      {isSubmitting ? 'Sending…' : 'Join IntelliWatt For Free'}
                    </button>
                    <p className="text-xs text-brand-white/70 text-center">
                      No password to remember. We email you a secure link so you can join instantly.
                    </p>
                  </form>
                </div>
              ) : (
                <div className="bg-brand-white p-6 rounded-2xl text-brand-navy text-center shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                  <h3 className="text-xl font-bold mb-2">Check Your Email!</h3>
                  <p>We just sent you a magic link. Open it within 15 minutes to finish joining IntelliWatt.</p>
                </div>
              )}
            </div>
          
          {/* Hero Stats */}
          {(() => {
            const SETUP_MINUTES = 5;
            const avgSavings = typeof publicStats?.avgSavingsDollars === 'number' && Number.isFinite(publicStats.avgSavingsDollars) ? publicStats.avgSavingsDollars : null;
            const savingsPerHr = avgSavings != null && SETUP_MINUTES > 0 ? (avgSavings / SETUP_MINUTES) * 60 : null;
            return (
          <div className="grid gap-8 mb-16 md:grid-cols-2 lg:grid-cols-4">
            <div className="text-center">
              <div className="text-4xl font-bold text-brand-blue mb-2">
                {avgSavings != null ? currency.format(Math.round(avgSavings)) : '—'}
              </div>
              <div className="text-brand-white">Average savings (running average from real users)</div>
              <div className="mt-1 text-xs text-brand-white/70">Based on completed comparisons · ETF excluded</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-brand-blue mb-2">
                {typeof publicStats?.totalSwitchedSavingsDollars === 'number' && Number.isFinite(publicStats.totalSwitchedSavingsDollars)
                  ? currency.format(Math.round(publicStats.totalSwitchedSavingsDollars))
                  : '—'}
              </div>
              <div className="text-brand-white">Total savings (switched users)</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-brand-blue mb-2">{SETUP_MINUTES} minutes</div>
              <div className="text-brand-white">Setup Time</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-brand-blue mb-2">
                {savingsPerHr != null ? currency.format(Math.round(savingsPerHr)) : '—'}
              </div>
              <div className="text-brand-white">$/hr of work</div>
              <div className="mt-1 text-xs text-brand-white/70">Average savings ÷ setup time, as hourly equivalent</div>
            </div>
          </div>
            );
          })()}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 px-4 bg-brand-navy">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-brand-white mb-6">
              How It <span className="text-brand-blue">Works</span>
            </h2>
            <p className="text-xl text-brand-white max-w-4xl mx-auto leading-relaxed">
              Connect your smart meter and let our AI find the perfect energy plan for your unique usage patterns.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-12">
            {/* Step 1 */}
            <div className="text-center group">
              <div className="w-20 h-20 bg-brand-blue rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <span className="text-brand-navy font-bold text-2xl">1</span>
              </div>
              <h3 className="text-2xl font-semibold text-brand-white mb-4">Link Your Power Usage</h3>
              <p className="text-brand-white text-lg leading-relaxed">Connect your smart meter or upload your bills securely</p>
            </div>
            
            {/* Step 2 */}
            <div className="text-center group">
              <div className="w-20 h-20 bg-brand-blue rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <span className="text-brand-navy font-bold text-2xl">2</span>
              </div>
              <h3 className="text-2xl font-semibold text-brand-white mb-4">We Run the Numbers</h3>
              <p className="text-brand-white text-lg leading-relaxed">Our AI analyzes your unique usage patterns and preferences</p>
            </div>
            
            {/* Step 3 */}
            <div className="text-center group">
              <div className="w-20 h-20 bg-brand-blue rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <span className="text-brand-navy font-bold text-2xl">3</span>
              </div>
              <h3 className="text-2xl font-semibold text-brand-white mb-4">Start Saving Money</h3>
              <p className="text-brand-white text-lg leading-relaxed">Get personalized recommendations and easy plan enrollment</p>
            </div>
          </div>
        </div>
      </section>



      {/* Why Join IntelliWatt Section */}
      <section className="py-24 px-4 bg-brand-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-brand-navy mb-4">
              Why Join <span className="text-brand-blue">IntelliWatt™</span>?
            </h2>
            <p className="text-lg text-brand-navy/80 max-w-3xl mx-auto leading-relaxed">
              Unlock personalized savings insights, jackpot entries, and AI-powered recommendations that stay in sync with your
              home’s real energy usage.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {[
              { icon: '🎯', text: 'Completely free to join—no purchases or commitments required.' },
              {
                icon: '💸',
                text: 'Earn entries for connecting Smart Meter Texas, uploading usage, and completing your profile.',
              },
              { icon: '🔁', text: 'Keep profile entries active by refreshing your usage data at least every 12 months.' },
              {
                icon: '💰',
                text: 'Monthly jackpot grows by $5 whenever a member switches to a commissionable plan through IntelliWatt™.',
              },
              { icon: '🏆', text: 'One verified winner is selected every month and paid via digital wallet or check.' },
              { icon: '🏠', text: 'View insights into how your home uses energy and where waste might be hiding.' },
              {
                icon: '⚡',
                text: 'Secure Smart Meter Texas integration lets IntelliWatt™ pull usage data automatically.',
              },
              { icon: '📈', text: 'Track usage trends over time and receive data-backed recommendations.' },
              { icon: '👥', text: 'Earn a referral entry for every friend who connects SMT or uploads usage—no referral cap.' },
              {
                icon: '🗣️',
                text: 'Eligible customers can submit testimonials for an additional entry that never expires.',
              },
              { icon: '📊', text: 'Personalized savings reports highlight best-fit plans, appliances, and upgrades.' },
              { icon: '🚫', text: 'No pressure, ever—IntelliWatt™ only recommends what saves you the most.' },
              { icon: '🔒', text: 'Usage data is protected with secure handling and never sold to third parties.' },
              { icon: '📱', text: 'Optimized for mobile so you can check entries and insights from any device.' },
              { icon: '🧠', text: 'Powered by AI that blends usage, weather, and efficiency data for smarter guidance.' },
              { icon: '🎉', text: 'Stay eligible without spending money—AMOE postcard entries are always available.' },
            ].map((benefit) => (
              <div
                key={benefit.text}
                className="flex items-start gap-4 rounded-2xl border border-brand-blue/30 bg-brand-navy p-6 shadow-[0_15px_40px_rgba(15,23,42,0.3)] transition hover:border-brand-blue/60"
              >
                <span
                  aria-hidden
                  className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-brand-blue/20 text-lg text-[#00E0FF] shadow-[0_10px_25px_rgba(0,224,255,0.45)]"
                >
                  {benefit.icon}
                </span>
                <p className="text-brand-white/90 leading-relaxed">{benefit.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why IntelliWatt Section */}
      <section className="py-24 px-4 bg-brand-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-brand-navy mb-6">
              Why <span className="text-brand-blue">IntelliWatt™</span> Works Better
            </h2>
            <p className="text-xl text-brand-navy max-w-4xl mx-auto leading-relaxed">
              We don't just show you prices — we calculate what your home actually needs using advanced AI algorithms.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8 mb-16">
            <div className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_30px_80px_rgba(0,0,0,0.45)] text-center transition-all duration-300 group hover:border-brand-blue/80">
              <div className="w-16 h-16 bg-brand-navy/60 border border-brand-blue/50 rounded-2xl flex items-center justify-center mb-4 mx-auto shadow-[0_0_30px_rgba(0,224,255,0.65)] group-hover:shadow-[0_0_40px_rgba(0,224,255,0.85)] transition-all duration-300">
                <svg className="w-8 h-8 text-[#00E0FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-[#00E0FF] mb-3">Real Smart Meter Data</h3>
              <p className="text-brand-white/90">Uses actual usage data — no estimates or averages</p>
            </div>

            <div className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_30px_80px_rgba(0,0,0,0.45)] text-center transition-all duration-300 group hover:border-brand-blue/80">
              <div className="w-16 h-16 bg-brand-navy/60 border border-brand-blue/50 rounded-2xl flex items-center justify-center mb-4 mx-auto shadow-[0_0_30px_rgba(0,224,255,0.65)] group-hover:shadow-[0_0_40px_rgba(0,224,255,0.85)] transition-all duration-300">
                <svg
                  className="w-9 h-9 text-[#00E0FF]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 5V3m0 18v-2m7-7h2M3 12h2m13.364-6.364l1.414-1.414M5.222 18.778l1.414-1.414m0-10.728L5.222 4.222M18.778 18.778l-1.414-1.414M12 8a4 4 0 100 8 4 4 0 000-8z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-[#00E0FF] mb-3">Weather &amp; Season Normalization</h3>
              <p className="text-brand-white/90">Accounts for weather, usage timing, and seasonal changes</p>
            </div>

            <div className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_30px_80px_rgba(0,0,0,0.45)] text-center transition-all duration-300 group hover:border-brand-blue/80">
              <div className="w-16 h-16 bg-brand-navy/60 border border-brand-blue/50 rounded-2xl flex items-center justify-center mb-4 mx-auto shadow-[0_0_30px_rgba(0,224,255,0.65)] group-hover:shadow-[0_0_40px_rgba(0,224,255,0.85)] transition-all duration-300">
                <svg className="w-8 h-8 text-[#00E0FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-[#00E0FF] mb-3">Pattern Matching</h3>
              <p className="text-brand-white/90">Matches your home's unique usage pattern to the best-fit plan</p>
            </div>

            <div className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_30px_80px_rgba(0,0,0,0.45)] text-center transition-all duration-300 group hover:border-brand-blue/80">
              <div className="w-16 h-16 bg-brand-navy/60 border border-brand-blue/50 rounded-2xl flex items-center justify-center mb-4 mx-auto shadow-[0_0_30px_rgba(0,224,255,0.65)] group-hover:shadow-[0_0_40px_rgba(0,224,255,0.85)] transition-all duration-300">
                <svg className="w-8 h-8 text-[#00E0FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-[#00E0FF] mb-3">Patent-Pending Engine</h3>
              <p className="text-brand-white/90">
                Advanced switching engine — only available at{' '}
                <span className="font-semibold text-[#00E0FF] drop-shadow-[0_0_12px_rgba(0,224,255,0.8)]">IntelliWatt™</span>
              </p>
            </div>

            <div className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_30px_80px_rgba(0,0,0,0.45)] text-center transition-all duration-300 group hover:border-brand-blue/80 md:col-span-2">
              <div className="w-16 h-16 bg-brand-navy/60 border border-brand-blue/50 rounded-2xl flex items-center justify-center mb-4 mx-auto shadow-[0_0_30px_rgba(0,224,255,0.65)] group-hover:shadow-[0_0_40px_rgba(0,224,255,0.85)] transition-all duration-300">
                <svg className="w-8 h-8 text-[#00E0FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-[#00E0FF] mb-3">Continuous Monitoring</h3>
              <p className="text-brand-white/90">Re-checks automatically so you never overpay again</p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-24 px-4 bg-brand-navy">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-white text-center mb-20">
            What Our <span className="text-brand-blue">Users</span> Say
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8 mb-20">
            {testimonials.map(({ name, initials, location, quote }) => (
              <div
                key={name}
                className="bg-brand-white p-8 rounded-2xl border border-brand-navy shadow-lg transition-transform duration-300 hover:-translate-y-2 hover:shadow-2xl"
              >
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mr-4 shadow-[0_0_18px_rgba(22,55,130,0.35)]">
                    <span className="text-brand-blue font-bold">{initials}</span>
                  </div>
                  <div>
                    <h4 className="text-brand-navy font-semibold">{name}</h4>
                    <p className="text-brand-navy/70 text-sm">{location}</p>
                  </div>
                </div>
                <p className="text-brand-navy italic leading-relaxed">"{quote}"</p>
              </div>
            ))}
          </div>
          
          {/* Trust Indicators */}
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center group">
              <div className="w-20 h-20 bg-brand-blue rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <svg className="w-10 h-10 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-2">100% Free</h3>
              <p className="text-brand-white">No hidden fees or charges</p>
            </div>
            <div className="text-center group">
              <div className="w-20 h-20 bg-brand-blue rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <svg className="w-10 h-10 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-2">Secure Data</h3>
              <p className="text-brand-white">Bank-level encryption</p>
            </div>
            <div className="text-center group">
              <div className="w-20 h-20 bg-brand-blue rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <svg className="w-10 h-10 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-2">AI-Powered</h3>
              <p className="text-brand-white">Advanced algorithms</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-24 px-4 bg-brand-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-navy mb-8">
            Ready to Start <span className="text-brand-blue">Saving</span>?
          </h2>
          <p className="text-xl text-brand-navy mb-12 max-w-3xl mx-auto">
            Join thousands of homeowners who are already saving hundreds on their energy bills with IntelliWatt™.
          </p>
          
          {/* Email Entry Form */}
          <div className="max-w-md mx-auto">
            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  type="email"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-6 py-4 rounded-full bg-brand-white text-brand-navy placeholder-brand-navy/60 focus:outline-none focus:ring-2 focus:ring-brand-blue text-lg border-2 border-brand-navy"
                  required
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-brand-navy text-brand-blue font-bold py-4 px-8 rounded-full text-lg hover:border-brand-blue transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-brand-blue/25 disabled:opacity-50 border-2 border-brand-navy"
                >
                  {isSubmitting ? 'Sending...' : 'Get Access to Dashboard'}
                </button>
              </form>
            ) : (
              <div className="bg-brand-navy p-6 rounded-2xl text-brand-white">
                <h3 className="text-xl font-bold mb-2">Check Your Email!</h3>
                <p>We've sent you a magic link to access your IntelliWatt dashboard.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LandingPageContent />
    </Suspense>
  );
} 