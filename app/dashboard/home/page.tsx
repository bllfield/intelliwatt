'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function HomePage() {
  const [hasCompleted, setHasCompleted] = useState(false);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('intelliwatt_home_details_complete') : null;
    if (stored === 'true') {
      setHasCompleted(true);
    }
  }, []);

  const handleComplete = async () => {
    // Award 1 entry when home details are completed
    // This will be called when user actually completes the form
    try {
      await fetch('/api/user/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'home_details_complete', amount: 1 }),
      });
      window.dispatchEvent(new CustomEvent('entriesUpdated'));
      setHasCompleted(true);
      if (typeof window !== 'undefined') {
        localStorage.setItem('intelliwatt_home_details_complete', 'true');
      }
    } catch (error) {
      console.error('Error awarding entries:', error);
    }
  };

  return (
    <div className="min-h-screen bg-brand-white">
      {/* Hero Section */}
      <section className="relative bg-brand-navy py-16 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-brand-white mb-4">
            Home <span className="text-brand-blue">Details</span>
          </h1>
          {!hasCompleted && (
            <div className="inline-block bg-[#39FF14]/20 border border-[#39FF14]/40 px-4 py-2 rounded-full mb-6">
              <span className="text-[#39FF14] font-semibold">
                🎁 Complete this form to earn 1 jackpot entry!
              </span>
            </div>
          )}
          {hasCompleted && (
            <div className="inline-block bg-[#BF00FF]/20 border border-[#BF00FF]/40 px-4 py-2 rounded-full mb-6">
              <span className="text-[#BF00FF] font-semibold">
                ✓ You earned 1 jackpot entry for completing home details!
              </span>
            </div>
          )}
          <p className="text-xl text-brand-white mb-8 max-w-2xl mx-auto">
            Help us understand your home to provide better energy plan recommendations.
          </p>
        </div>
      </section>

      {/* Form Section */}
      <section className="py-16 px-4 bg-brand-white">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg">
            <div className="text-center">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-brand-blue">🏠</span>
              </div>
              <h2 className="text-2xl font-bold text-brand-navy mb-4">
                Home Information Form
              </h2>
              <p className="text-brand-navy mb-6">
                This form is coming soon. You'll be able to enter details about your home to get more accurate recommendations.
              </p>
              
              {!hasCompleted && (
                <div className="bg-brand-navy/5 p-6 rounded-xl border border-brand-navy/20 mb-6">
                  <p className="text-sm text-brand-navy mb-4">
                    <span style={{ color: '#39FF14' }} className="font-semibold">
                      Complete the following to earn your home profile entry:
                    </span>
                  </p>
                  <ul className="text-left text-sm text-brand-navy space-y-2 max-w-md mx-auto">
                    <li>• Square footage</li>
                    <li>• Home age and structure</li>
                    <li>• Heating and cooling systems</li>
                    <li>• Major appliances</li>
                    <li>• Energy efficiency features</li>
                  </ul>
                </div>
              )}

              <button
                onClick={handleComplete}
                disabled={hasCompleted}
                className="bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {hasCompleted ? 'Already Completed ✓' : 'Mark as Complete (Demo)'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
