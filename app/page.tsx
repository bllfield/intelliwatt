"use client";

import React, { useState, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function LandingPageContent() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const searchParams = useSearchParams();
  const from = searchParams?.get('from');
  const source = searchParams?.get('source');
  const showJackpotBanner = from === 'htjw' || source === 'jackpot';

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
        // Auto-hide popup after 5 seconds
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
      {/* Success Popup */}
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

      {/* Hero Section */}
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-6xl mx-auto">
          <div className="text-center mb-16">
            {/* Logo */}
            <div className="flex justify-center mb-8">
              <div className="relative w-48 h-24">
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
            <p className="text-xl md:text-2xl text-brand-white mb-4 max-w-4xl mx-auto leading-relaxed">
              AI-powered energy plan optimization that uses your actual usage data to find the perfect plan for your home, FREE of charge.
            </p>
            <div className="mb-8 inline-block bg-white/10 text-white px-4 py-1.5 rounded-full font-semibold border border-white/20">
              💸 100% Free — No fees, ever
            </div>
            
            {/* Email Entry Form */}
            <div className="max-w-md mx-auto">
              {/* Entries CTA block above email (Visit Dashboard only) */}
              <div className="bg-brand-navy/60 border border-brand-blue/20 rounded-2xl p-4 mb-6 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-[#BF00FF] text-lg">✓</span>
                  <span className="text-brand-white font-semibold">Visit Dashboard - Submit Email Below</span>
                </div>
                <div className="text-brand-white/90 text-sm">
                  Access your dashboard for the first time to create your account
                  <span className="ml-2" style={{ color: '#39FF14' }}>1 jackpot entry available</span>
                </div>
              </div>
              {!submitted ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <input
                    type="email"
                    placeholder="Enter your email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-6 py-4 rounded-full bg-brand-white text-brand-navy placeholder-brand-navy/60 focus:outline-none focus:ring-2 focus:ring-brand-blue text-lg"
                    required
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-brand-blue text-brand-navy font-bold py-4 px-8 rounded-full text-lg hover:bg-brand-cyan transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-brand-blue/25 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Sending...' : 'Get Access to Dashboard'}
                  </button>
                </form>
              ) : (
                <div className="bg-brand-white p-6 rounded-2xl text-brand-navy">
                  <h3 className="text-xl font-bold mb-2">Check Your Email!</h3>
                  <p>We've sent you a magic link to access your IntelliWatt dashboard.</p>
                </div>
              )}

              {/* Secondary CTA pill below the button */}
              <div className="bg-brand-navy/60 border border-brand-blue/20 rounded-2xl p-4 mt-6 text-center">
                <div className="text-brand-white/90 text-sm">
                  <span className="font-semibold">Authorize Smart Meter Texas</span>
                  <span className="ml-2" style={{ color: '#39FF14' }}>10 jackpot entries available</span>
                </div>
                <div className="mt-3 text-brand-white/90 text-sm">
                  <span className="font-semibold">Refer a Friend</span>
                  <span className="ml-2">Each friend who signs up earns you</span>
                  <span className="ml-2" style={{ color: '#39FF14' }}>5 jackpot entries</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Hero Stats */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="text-center">
              <div className="text-4xl font-bold text-brand-blue mb-2">$847</div>
              <div className="text-brand-white">Average Annual Savings</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-brand-blue mb-2">94%</div>
              <div className="text-brand-white">Accuracy Rate</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-brand-blue mb-2">2min</div>
              <div className="text-brand-white">Setup Time</div>
            </div>
          </div>
        </div>
      </section>

      {/* IntelliWatt Bot Section */}
      <section className="py-24 px-4 bg-brand-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Bot Animation */}
            <div className="text-center md:text-left">
              {/* Bot Quote */}
              <div className="mb-8 p-6 bg-brand-navy rounded-2xl shadow-lg">
                <p className="text-brand-white text-lg italic mb-2">
                  "I analyze your energy usage patterns and find the perfect plan for your unique needs. 
                  No more guesswork — just smart, data-driven recommendations!"
                </p>
                <p className="text-brand-blue font-semibold">— IntelliWatt Bot</p>
              </div>
              
              <div className="relative w-80 h-80 mx-auto md:mx-0 mb-8">
                <Image
                  src="/Intelliwatt Bot Final Gif.gif"
                  alt="IntelliWatt Bot"
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
            </div>
            
            {/* Bot Content */}
            <div className="text-center md:text-left">
              <h2 className="text-4xl md:text-5xl font-bold text-brand-navy mb-6">
                Meet Your <span className="text-brand-blue">AI Energy Assistant</span> — IntelliWatt Bot
              </h2>
              <p className="text-xl text-brand-navy mb-8 leading-relaxed">
                Our intelligent bot analyzes your energy usage patterns and finds the perfect plan for your unique needs. 
                No more guesswork — just smart, data-driven recommendations.
              </p>
              
              <div className="space-y-4 mb-8">
                <div className="flex items-center text-brand-navy">
                  <div className="w-8 h-8 bg-brand-navy rounded-full flex items-center justify-center mr-4">
                    <span className="text-brand-blue font-bold">✓</span>
                  </div>
                  <span className="text-lg">24/7 energy monitoring</span>
                </div>
                <div className="flex items-center text-brand-navy">
                  <div className="w-8 h-8 bg-brand-navy rounded-full flex items-center justify-center mr-4">
                    <span className="text-brand-blue font-bold">✓</span>
                  </div>
                  <span className="text-lg">Automatic plan switching</span>
                </div>
                <div className="flex items-center text-brand-navy">
                  <div className="w-8 h-8 bg-brand-navy rounded-full flex items-center justify-center mr-4">
                    <span className="text-brand-blue font-bold">✓</span>
                  </div>
                  <span className="text-lg">Real-time savings alerts</span>
                </div>
              </div>
            </div>
          </div>
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
            <div className="bg-brand-white p-8 rounded-2xl border border-brand-navy hover:border-brand-blue transition-all duration-300 group shadow-lg">
              <div className="w-12 h-12 bg-brand-navy rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-navy mb-3">Real Smart Meter Data</h3>
              <p className="text-brand-navy">Uses actual usage data — no estimates or averages</p>
            </div>
            
            <div className="bg-brand-white p-8 rounded-2xl border border-brand-navy hover:border-brand-blue transition-all duration-300 group shadow-lg">
              <div className="w-12 h-12 bg-brand-navy rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-navy mb-3">Weather & Season Normalization</h3>
              <p className="text-brand-navy">Accounts for weather, usage timing, and seasonal changes</p>
            </div>
            
            <div className="bg-brand-white p-8 rounded-2xl border border-brand-navy hover:border-brand-blue transition-all duration-300 group shadow-lg">
              <div className="w-12 h-12 bg-brand-navy rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-navy mb-3">Pattern Matching</h3>
              <p className="text-brand-navy">Matches your home's unique usage pattern to the best-fit plan</p>
            </div>
            
            <div className="bg-brand-white p-8 rounded-2xl border border-brand-navy hover:border-brand-blue transition-all duration-300 group shadow-lg">
              <div className="w-12 h-12 bg-brand-navy rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-navy mb-3">Patent-Pending Engine</h3>
              <p className="text-brand-navy">Advanced switching engine — only available at IntelliWatt™</p>
            </div>
            
            <div className="bg-brand-white p-8 rounded-2xl border border-brand-navy hover:border-brand-blue transition-all duration-300 group shadow-lg md:col-span-2">
              <div className="w-12 h-12 bg-brand-navy rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-navy mb-3">Continuous Monitoring</h3>
              <p className="text-brand-navy">Re-checks automatically so you never overpay again</p>
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
          
          {/* Testimonials Placeholder */}
          <div className="grid md:grid-cols-3 gap-8 mb-20">
            <div className="bg-brand-white p-8 rounded-2xl border border-brand-navy shadow-lg">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mr-4">
                  <span className="text-brand-blue font-bold">JS</span>
                </div>
                <div>
                  <h4 className="text-brand-navy font-semibold">John Smith</h4>
                  <p className="text-brand-navy text-sm">Homeowner</p>
                </div>
              </div>
              <p className="text-brand-navy italic">"Testimonial 1 coming soon..."</p>
            </div>
            
            <div className="bg-brand-white p-8 rounded-2xl border border-brand-navy shadow-lg">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mr-4">
                  <span className="text-brand-blue font-bold">MJ</span>
                </div>
                <div>
                  <h4 className="text-brand-navy font-semibold">Mary Johnson</h4>
                  <p className="text-brand-navy text-sm">Business Owner</p>
                </div>
              </div>
              <p className="text-brand-navy italic">"Testimonial 2 coming soon..."</p>
            </div>
            
            <div className="bg-brand-white p-8 rounded-2xl border border-brand-navy shadow-lg">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mr-4">
                  <span className="text-brand-blue font-bold">RW</span>
                </div>
                <div>
                  <h4 className="text-brand-navy font-semibold">Robert Wilson</h4>
                  <p className="text-brand-navy text-sm">Property Manager</p>
                </div>
              </div>
              <p className="text-brand-navy italic">"Testimonial 3 coming soon..."</p>
            </div>
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