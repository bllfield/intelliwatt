'use client';

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

function JoinPageContent() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const searchParams = useSearchParams();
  const referralCode = searchParams?.get('ref');

  // Set referral cookie when ref parameter is present
  useEffect(() => {
    if (referralCode) {
      const expiryDate = new Date();
      expiryDate.setTime(expiryDate.getTime() + 90 * 24 * 60 * 60 * 1000);
      document.cookie = `intelliwatt_referrer=${referralCode}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax`;
    }
  }, [referralCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/send-magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          email,
          referralCode: referralCode || undefined
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSubmitted(true);
        setShowSuccessPopup(true);
        setTimeout(() => setShowSuccessPopup(false), 5000);
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
      {showSuccessPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Magic Link Sent!</h3>
              <p className="text-sm text-gray-600 mb-4">
                We've sent a magic link to <strong>{email}</strong>. Please check your inbox and click the link to access your dashboard.
              </p>
              <p className="text-xs text-gray-500 mb-4">
                The link will expire in 15 minutes. If you don't see the email, check your spam folder.
              </p>
              <button
                onClick={() => setShowSuccessPopup(false)}
                className="w-full bg-brand-blue text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="flex justify-center mb-8">
              <div className="relative w-[36rem] h-[18rem]">
                <Image
                  src="/IntelliWatt Logo TM.png"
                  alt="IntelliWatt™ Logo"
                  fill
                  className="object-contain"
                />
              </div>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold text-brand-white mb-6">
              Stop <span className="text-brand-blue">Overpaying</span> for Power
            </h1>
            <div className="mb-10 space-y-4 text-brand-white max-w-3xl mx-auto text-left md:text-center">
              <p className="text-xl md:text-2xl leading-relaxed">
                Join IntelliWatt today to unlock free, personalized energy insights and tools that show you exactly how to save.
              </p>
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
          </div>
        </div>
      </section>

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
              { icon: '💸', text: 'Earn entries for connecting Smart Meter Texas, uploading usage, and completing your profile.' },
              { icon: '🔁', text: 'Keep profile entries active by refreshing your usage data at least every 12 months.' },
              { icon: '💰', text: 'Monthly jackpot grows by $5 whenever a member switches to a commissionable plan through IntelliWatt™.' },
              { icon: '🏆', text: 'One verified winner is selected every month and paid via digital wallet or check.' },
              { icon: '🏠', text: 'View insights into how your home uses energy and where waste might be hiding.' },
              { icon: '⚡', text: 'Secure Smart Meter Texas integration lets IntelliWatt™ pull usage data automatically.' },
              { icon: '📈', text: 'Track usage trends over time and receive data-backed recommendations.' },
              { icon: '👥', text: 'Earn a referral entry for every friend who connects SMT or uploads usage—no referral cap.' },
              { icon: '🗣️', text: 'Eligible customers can submit testimonials for an additional entry that never expires.' },
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
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <JoinPageContent />
    </Suspense>
  );
} 