'use client';

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';

function JoinPageContent() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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

  useEffect(() => {
    if (referralCode) {
      window.location.replace(`/?ref=${encodeURIComponent(referralCode)}`);
    }
  }, [referralCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');

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
        setMessage('Welcome to IntelliWatt! Check your email for your magic link to get started.');
        setEmail('');
      } else {
        setMessage(`Error: ${data.error || 'Failed to send magic link'}`);
      }
    } catch (error) {
      setMessage('Error: Failed to send magic link. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-white">
      {/* Hero Section */}
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-brand-white mb-6">
            Join <span className="text-brand-blue">IntelliWatt™</span>
          </h1>
          <p className="text-xl text-brand-white mb-8 max-w-2xl mx-auto leading-relaxed">
            Start saving money on your electricity bills with AI-powered plan optimization.
          </p>
          
          {referralCode && (
            <div className="inline-block bg-brand-blue text-brand-navy px-6 py-2 rounded-full font-semibold mb-8">
              🎁 You were invited by a friend!
            </div>
          )}
        </div>
      </section>

      {/* Sign Up Form */}
      <section className="py-16 px-4 bg-brand-white">
        <div className="max-w-md mx-auto">
          <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-brand-navy mb-2">Get Started</h2>
              <p className="text-brand-navy">Enter your email to create your account</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-brand-navy font-medium mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  className="w-full px-4 py-3 rounded-lg bg-brand-white border-2 border-brand-navy text-brand-navy placeholder-brand-navy/40 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue transition-all duration-300"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-brand-navy text-brand-blue font-bold py-4 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue hover:text-brand-blue transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            {message && (
              <div className={`mt-4 p-4 rounded-lg text-center ${
                message.includes('Error') 
                  ? 'bg-red-500/20 border border-red-500/30 text-red-600' 
                  : 'bg-green-500/20 border border-green-500/30 text-green-600'
              }`}>
                {message}
              </div>
            )}

            <div className="mt-6 text-center">
              <p className="text-brand-navy text-sm">
                Already have an account?{' '}
                <a
                  href="/login"
                  className="text-brand-navy underline transition-colors hover:text-brand-blue relative inline-flex items-center justify-center"
                  style={{
                    textShadow:
                      '0 0 6px rgba(0, 224, 255, 0.65), 0 0 12px rgba(0, 224, 255, 0.45), 0 0 18px rgba(0, 224, 255, 0.25)',
                  }}
                >
                  Sign in here
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
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