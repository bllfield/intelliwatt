'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ReferralData {
  referralLink: string;
  token: string;
  vanityCode: string;
  message: string;
}

interface ReferralStats {
  totalReferrals: number;
  totalEntries: number;
}

export default function ReferralsPage() {
  const [referralData, setReferralData] = useState<ReferralData | null>(null);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch referral link
        const linkResponse = await fetch('/api/user/referral-link');
        if (linkResponse.ok) {
          const linkData = await linkResponse.json();
          setReferralData(linkData);
        }
        setStats({ totalReferrals: 0, totalEntries: 0 });
      } catch (error) {
        console.error('Error fetching referral data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleCopyLink = async () => {
    if (referralData?.referralLink) {
      try {
        await navigator.clipboard.writeText(referralData.referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    }
  };

  const handleCopyCode = async () => {
    if (referralData?.vanityCode) {
      try {
        await navigator.clipboard.writeText(referralData.vanityCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-white flex items-center justify-center">
        <div className="animate-pulse text-brand-navy">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-white">
      {/* Hero Section */}
      <section className="relative bg-brand-navy py-16 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-brand-white mb-4">
            Refer <span className="text-brand-blue">Friends</span>
          </h1>
          <div className="inline-block bg-[#39FF14]/20 border border-[#39FF14]/40 px-4 py-2 rounded-full mb-6">
            <span className="text-[#39FF14] font-semibold">
              🎁 Earn 5 jackpot entries for each friend who signs up!
            </span>
          </div>
          <p className="text-xl text-brand-white mb-8 max-w-2xl mx-auto">
            Share your referral link and unlock unlimited bonus entries through successful referrals.
          </p>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-8 px-4 bg-brand-white">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="bg-brand-navy p-6 rounded-xl text-center border border-brand-blue/20">
              <div className="text-3xl font-bold mb-2" style={{ color: '#39FF14' }}>
                {stats?.totalReferrals ?? 0}
              </div>
              <div className="text-brand-blue">Friends Referred</div>
            </div>
            <div className="bg-brand-navy p-6 rounded-xl text-center border border-brand-blue/20">
              <div className="text-3xl font-bold mb-2" style={{ color: '#39FF14' }}>
                {stats?.totalEntries ?? 0}
              </div>
              <div className="text-brand-blue">Total Entries</div>
            </div>
          </div>
        </div>
      </section>

      {/* Referral Link Section */}
      <section className="py-16 px-4 bg-brand-white">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-brand-blue">👥</span>
              </div>
              <h2 className="text-3xl font-bold text-brand-navy mb-4">
                Your Referral Link
              </h2>
              <p className="text-brand-navy mb-6">
                Share this link with friends and family to earn entries when they sign up!
              </p>
            </div>

            {/* Referral Link */}
            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-brand-navy font-semibold mb-2">
                  Shareable Link
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={referralData?.referralLink || ''}
                    readOnly
                    className="flex-1 px-4 py-3 rounded-lg bg-brand-navy/5 border-2 border-brand-navy text-brand-navy"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 whitespace-nowrap"
                  >
                    {copied ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              </div>

              {/* Vanity Code */}
              <div>
                <label className="block text-brand-navy font-semibold mb-2">
                  Vanity Code (for offline sharing)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={referralData?.vanityCode || ''}
                    readOnly
                    className="flex-1 px-4 py-3 rounded-lg bg-brand-navy/5 border-2 border-brand-navy text-brand-navy text-center font-mono text-xl"
                  />
                  <button
                    onClick={handleCopyCode}
                    className="bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 whitespace-nowrap"
                  >
                    {copied ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
              </div>
            </div>

            {/* How It Works */}
            <div className="bg-brand-navy/5 p-6 rounded-xl border border-brand-navy/20">
              <h3 className="text-lg font-bold text-brand-navy mb-4">
                <span style={{ color: '#39FF14' }}>How Referrals Work:</span>
              </h3>
              <ul className="text-left text-sm text-brand-navy space-y-2">
                <li className="flex items-start space-x-2">
                  <span style={{ color: '#BF00FF' }} className="text-lg">✓</span>
                  <span>Share your link or code with friends</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span style={{ color: '#BF00FF' }} className="text-lg">✓</span>
                  <span>They sign up using your link</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span style={{ color: '#BF00FF' }} className="text-lg">✓</span>
                  <span>You earn <strong style={{ color: '#39FF14' }}>5 entries</strong> per successful referral</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span style={{ color: '#BF00FF' }} className="text-lg">✓</span>
                  <span>Unlimited bonus entries from referrals!</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
