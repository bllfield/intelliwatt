'use client';

import { useState } from 'react';

export default function ExternalMagicLinkTest() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/external/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'hitthejackwatt' }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage('Magic link sent! Check your email and click the link to access your dashboard.');
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
    <div className="min-h-screen bg-brand-white flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-brand-navy mb-2">External Magic Link Test</h1>
            <p className="text-brand-navy">Test the HitTheJackWatt → IntelliWatt integration</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-brand-navy mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-brand-navy rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue"
                placeholder="Enter your email address"
                required
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !email}
              className="w-full bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue hover:text-brand-blue hover:bg-brand-navy transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Sending...' : 'Send Magic Link'}
            </button>
          </form>

          {message && (
            <div className={`mt-6 p-4 rounded-md ${message.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {message}
            </div>
          )}

          <div className="mt-8 text-center">
            <p className="text-sm text-brand-navy">
              This simulates the HitTheJackWatt website sending users to IntelliWatt
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
