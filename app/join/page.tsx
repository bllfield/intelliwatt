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
      // Set cookie for 90 days
      const expiryDate = new Date();
      expiryDate.setTime(expiryDate.getTime() + 90 * 24 * 60 * 60 * 1000);
      document.cookie = `intelliwatt_referrer=${referralCode}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax`;
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
                <a href="/login" className="text-brand-blue underline hover:text-brand-navy transition-colors">
                  Sign in here
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-16 px-4 bg-brand-navy">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-brand-white text-center mb-12">
            Why Join <span className="text-brand-blue">IntelliWatt™</span>?
          </h2>

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
                className="flex items-start gap-4 bg-brand-navy/60 border border-brand-blue/30 rounded-xl p-6 text-left hover:border-brand-blue transition-colors"
              >
                <span className="text-3xl" aria-hidden>
                  {benefit.icon}
                </span>
                <p className="text-brand-white leading-relaxed">{benefit.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-4 bg-brand-navy border-t border-brand-blue/20">
        <div className="max-w-6xl mx-auto">
          {/* Main Footer Content */}
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            {/* Company Info */}
            <div className="md:col-span-2">
              <div className="flex items-center mb-6">
                <div className="relative w-32 h-16 mr-4">
                  <Image
                    src="/IntelliWatt Logo TM.png"
                    alt="IntelliWatt™ Logo"
                    fill
                    className="object-contain"
                  />
                </div>
              </div>
              <p className="text-brand-white text-lg leading-relaxed mb-6 max-w-md">
                Stop overpaying for power with our AI-powered energy plan optimization. 
                Smart algorithms find the perfect plan for your unique usage patterns.
              </p>
              
              <div className="flex space-x-4">
                <a href="#" className="text-brand-white hover:text-brand-blue transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
                  </svg>
                </a>
                <a href="#" className="text-brand-white hover:text-brand-blue transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/>
                  </svg>
                </a>
                <a href="#" className="text-brand-white hover:text-brand-blue transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </a>
              </div>
            </div>
            
            {/* Quick Links */}
            <div>
              <h3 className="text-brand-white font-semibold mb-4">Quick Links</h3>
              <ul className="space-y-2">
                <li><a href="/how-it-works" className="text-brand-white hover:text-brand-blue transition-colors">How It Works</a></li>
                <li><a href="/faq" className="text-brand-white hover:text-brand-blue transition-colors">FAQ</a></li>
                <li><a href="/privacy" className="text-brand-white hover:text-brand-blue transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="text-brand-white hover:text-brand-blue transition-colors">Terms of Service</a></li>
              </ul>
            </div>
            
            {/* Support */}
            <div>
              <h3 className="text-brand-white font-semibold mb-4">Support</h3>
              <ul className="space-y-2">
                <li><a href="/contact" className="text-brand-white hover:text-brand-blue transition-colors">Contact Us</a></li>
                <li><a href="/help" className="text-brand-white hover:text-brand-blue transition-colors">Help Center</a></li>
                <li><a href="/status" className="text-brand-white hover:text-brand-blue transition-colors">Service Status</a></li>
              </ul>
            </div>
          </div>
          
          {/* Bottom Footer */}
          <div className="border-t border-brand-blue/20 pt-8 text-center">
            <p className="text-brand-white">
              © 2024 IntelliWatt™. All rights reserved. Patent pending.
            </p>
          </div>
        </div>
      </footer>
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