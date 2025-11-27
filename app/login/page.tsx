'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [lastSubmittedEmail, setLastSubmittedEmail] = useState('');
  const [popupTimeoutId, setPopupTimeoutId] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (popupTimeoutId) {
        window.clearTimeout(popupTimeoutId);
      }
    };
  }, [popupTimeoutId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/send-magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        if (popupTimeoutId) {
          window.clearTimeout(popupTimeoutId);
        }
        setLastSubmittedEmail(email);
        setMessage({
          type: 'success',
          text: `Magic link sent! We just emailed ${email}. Click it within 15 minutes to open your dashboard.`,
        });
        setShowSuccessPopup(true);
        const timeout = window.setTimeout(() => setShowSuccessPopup(false), 5000);
        setPopupTimeoutId(timeout);
        setEmail('');
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to send magic link. Please try again.',
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: 'Failed to send magic link. Please try again.',
      });
      setShowSuccessPopup(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-white">
      {showSuccessPopup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-6 w-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-semibold text-brand-navy">Magic Link Sent</h2>
            <p className="text-brand-navy/80">
              We sent a secure login link to <strong>{lastSubmittedEmail}</strong>. Check your inbox (or spam folder) and click it
              within 15 minutes to jump into your dashboard.
            </p>
            <button
              type="button"
              onClick={() => setShowSuccessPopup(false)}
              className="mt-6 inline-flex items-center justify-center rounded-full bg-brand-blue px-6 py-3 font-semibold text-brand-navy transition hover:bg-brand-cyan"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}

      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>

        <div className="relative z-10 max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="flex justify-center mb-8">
              <div className="relative w-28 h-28 md:w-36 md:h-36">
                <Image
                  src="/IntelliWatt Logo TM.png"
                  alt="IntelliWatt Logo"
                  fill
                  className="object-contain"
                />
              </div>
            </div>

            <h1 className="text-4xl md:text-6xl font-bold text-brand-white mb-4">
              User Dashboard Login
            </h1>
            <p className="text-lg md:text-xl text-brand-white/90 max-w-3xl mx-auto leading-relaxed">
              Enter the email you used when you joined IntelliWatt or HitTheJackWatt. We’ll send you a secure magic link that
              opens your dashboard instantly—no password required.
            </p>
          </div>

          <div className="max-w-2xl mx-auto bg-brand-navy/70 border border-brand-blue/30 rounded-2xl p-8 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur">
            <div className="space-y-3 text-brand-white/90 text-base md:text-lg">
              <p className="font-semibold text-brand-white">How the magic link works:</p>
              <ul className="list-disc list-inside space-y-2 marker:text-[#00E0FF]">
                <li>Type the same email you used when you joined IntelliWatt or HitTheJackWatt.</li>
                <li>We email you a one-time magic link that’s valid for 15 minutes.</li>
                <li>Click the link on your phone or computer to jump straight into your dashboard.</li>
              </ul>
              <p className="italic text-brand-white/70">
                Tip: If you don’t see the email within a couple of minutes, check spam, promotions, or search for “IntelliWatt
                magic link.”
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <label className="block text-brand-white font-semibold" htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@email.com"
                required
                className="w-full rounded-full bg-brand-white px-6 py-4 text-brand-navy placeholder-brand-navy/50 focus:outline-none focus:ring-2 focus:ring-brand-blue text-lg transition"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-full bg-brand-blue text-brand-navy font-bold py-4 px-8 text-lg hover:bg-brand-cyan transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-brand-blue/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Sending…' : 'Email Me The Link'}
              </button>
            </form>

            {message ? (
              <div
                className={`mt-6 rounded-xl border px-4 py-4 text-center text-base md:text-lg ${
                  message.type === 'success'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-red-500/40 bg-red-500/10 text-red-200'
                }`}
              >
                {message.text}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}