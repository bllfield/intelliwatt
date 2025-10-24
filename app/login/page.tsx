'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

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
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage('Magic link sent! Check your email and click the link to sign in.');
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
            <div className="flex justify-center mb-4">
              <div className="relative w-16 h-16">
                <Image
                  src="/IntelliWatt Logo.png"
                  alt="IntelliWatt™ Logo"
                  fill
                  className="object-contain"
                />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-brand-navy mb-2">Welcome Back</h1>
            <p className="text-brand-navy">Sign in to your IntelliWatt™ account</p>
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
              {isLoading ? 'Sending...' : 'Send Magic Link'}
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
        </div>
      </div>
    </div>
  );
} 