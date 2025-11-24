'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import SmartMeterSection from '../../components/SmartMeterSection';
import QuickAddressEntry from '../../components/QuickAddressEntry';

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [userAddress, setUserAddress] = useState<string>('');

  useEffect(() => {
    setMounted(true);

    const savedAddress = typeof window !== 'undefined'
      ? localStorage.getItem('intelliwatt_user_address')
      : null;
    if (savedAddress) {
      setUserAddress(savedAddress);
    }

    const awardDashboardEntry = async () => {
      try {
        await fetch('/api/user/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'dashboard_visit', amount: 1 }),
        });
        window.dispatchEvent(new CustomEvent('entriesUpdated'));
      } catch (error) {
        console.error('Error awarding dashboard entry:', error);
      }
    };

    awardDashboardEntry();
  }, []);

  const handleAddressSubmitted = async (address: string) => {
    setUserAddress(address);

    if (typeof window !== 'undefined') {
      if (!address) {
        localStorage.removeItem('intelliwatt_user_address');
      } else {
        localStorage.setItem('intelliwatt_user_address', address);
      }
    }

    if (!address) {
      return;
    }
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="min-h-screen bg-brand-white flex items-center justify-center">
        <div className="animate-pulse text-brand-navy">Loading...</div>
      </div>
    );
  }
  const annualSavings = 0;
  const accuracyRate = 0;
  const totalEntries = 0;
  const totalReferrals = 0;

  return (
    <div className="min-h-screen bg-brand-white">
      {/* Hero Section */}
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-6xl font-bold text-brand-white mb-6">
              Welcome to <span className="text-brand-blue">IntelliWatt™</span>
            </h1>
            <p className="text-xl text-brand-white mb-4 max-w-4xl mx-auto leading-relaxed">
              Your FREE AI-powered energy optimization dashboard. Track savings, manage your plan, and earn rewards.
            </p>
            {/* Smart Meter + Referral CTA */}
            <div className="mb-8 flex flex-col items-center gap-4 text-center">
              <span className="relative inline-block h-24 w-full max-w-xs sm:h-28 sm:max-w-sm md:h-24 md:w-64">
                <Image
                  src="/Hitthejackwatt-Logo.png"
                  alt="HitTheJackWatt"
                  fill
                  className="object-contain"
                  priority
                />
              </span>
              <div className="inline-flex w-full max-w-xl flex-col items-center gap-2 rounded-2xl border border-[#39FF14]/40 bg-[#39FF14]/10 px-6 py-4 text-center shadow-lg shadow-[#39FF14]/10 ring-1 ring-[#39FF14]/30">
                <span className="text-lg font-extrabold leading-tight text-brand-white md:text-xl">
                  <span style={{ color: '#39FF14' }}>⚡ Connect your smart meter data</span>
                  <span className="mx-1 text-brand-white">for</span>
                  <span style={{ color: '#39FF14' }}>10 jackpot entries!!</span>
                </span>
                <span className="text-sm font-bold leading-tight text-brand-white md:text-base">
                  <span style={{ color: '#BF00FF' }}>👥 Refer a Friend:</span>
                  <span className="mx-1 text-brand-white" />
                  <span style={{ color: '#39FF14' }}>5 jackpot entries per signup!!</span>
                </span>
              </div>
            </div>
            
            {/* Address Entry - Right below hero text - Updated */}
            <div className="max-w-2xl mx-auto mb-8">
              <QuickAddressEntry 
                onAddressSubmitted={handleAddressSubmitted}
                userAddress={userAddress}
              />
            </div>
            
            {/* Beta & Free Banners */}
            <div className="flex flex-col items-center gap-2 mb-8">
              <div className="inline-block bg-brand-blue text-brand-navy px-6 py-2 rounded-full font-semibold">
                🚀 Beta Version - New Features Coming Soon!
              </div>
              <div className="inline-block bg-white/10 text-white px-4 py-1.5 rounded-full font-semibold border border-white/20">
                💸 100% Free — No fees, ever
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* Dashboard Grid - Only show if address is entered */}
      {userAddress && (
        <section className="py-16 px-4 bg-brand-white">
            <div className="max-w-6xl mx-auto">
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 text-center">
                {/* API Connect */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">🔌</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">API Connect</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Connect third-party services and integrations</p>
                  <Link href="/dashboard/api" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    Manage APIs
                  </Link>
                </div>

                {/* Usage */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">📊</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Usage</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">View detailed usage patterns and insights</p>
                  <Link href="/dashboard/usage" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    View Analysis
                  </Link>
                </div>

                {/* Current Rate */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">🧾</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Current Rate</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Upload your bill or enter plan details for +10 entries</p>
                  <Link href="/dashboard/current-rate" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    Add Current Rate
                  </Link>
                </div>

                {/* Plans */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">☀️</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Plans</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Compare plans and find the best rates</p>
                  <Link href="/dashboard/plans" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    Compare Plans
                  </Link>
                </div>

                {/* Home Info */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">🏡</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Home Info</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Keep your address and preferences current</p>
                  <Link href="/dashboard/home" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    Update Home Info
                  </Link>
                </div>

                {/* Appliances */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">🏠</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Appliances</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Track individual appliance usage</p>
                  <Link href="/dashboard/appliances" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    Manage Appliances
                  </Link>
                </div>

                {/* Upgrades */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">🚀</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Upgrades</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Explore premium features</p>
                  <Link href="/dashboard/upgrades" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    View Upgrades
                  </Link>
                </div>

                {/* Analysis */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">📈</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Analysis</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Dive into detailed energy analytics</p>
                  <Link href="/dashboard/analysis" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    Analyze Usage
                  </Link>
                </div>

                {/* Optimal Energy */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">⚡</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Optimal Energy</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">See IntelliWatt’s recommended optimal plan for your home</p>
                  <Link href="/dashboard/optimal" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    View Recommendation
                  </Link>
                </div>

                {/* Entries */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">🎰</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Entries</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Track your jackpot entries and rewards</p>
                  <Link href="/dashboard/entries" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    View Entries
                  </Link>
                </div>

                {/* Referrals */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">👥</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Referrals</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Earn rewards by referring friends</p>
                  <Link href="/dashboard/referrals" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    Invite Friends
                  </Link>
                </div>

                {/* Profile */}
                <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
                  <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                    <span className="text-brand-cyan text-2xl">👤</span>
                  </div>
                  <h3 className="text-2xl font-bold text-brand-navy mb-4">Profile</h3>
                  <p className="text-brand-navy mb-6 mx-auto max-w-xs">Update your contact details and notification preferences</p>
                  <Link href="/dashboard/profile" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                    Manage Profile
                  </Link>
                </div>
              </div>
            </div>
          </section>
      )}


      {/* Call to Action - Show if no address entered */}
      {!userAddress && (
        <section className="py-16 px-4 bg-brand-white">
          <div className="max-w-4xl mx-auto text-center">
            <div className="bg-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg">
              <div className="w-16 h-16 bg-brand-cyan rounded-full flex items-center justify-center mx-auto mb-6 shadow">
                <span className="text-brand-navy text-2xl">⚡</span>
              </div>
              <h2 className="text-3xl font-bold text-brand-navy mb-4">
                Ready to Start <span className="text-brand-blue">Saving</span>?
              </h2>
              <p className="text-lg text-brand-navy mb-8 max-w-2xl mx-auto">
                Enter your service address above to unlock personalized energy plan recommendations and start tracking your savings.
              </p>
              <div className="grid md:grid-cols-3 gap-6 text-center">
                <div className="bg-white p-6 rounded-xl border border-brand-navy shadow-sm">
                  <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mb-4 mx-auto">
                    <span className="text-brand-cyan text-xl">🔍</span>
                  </div>
                  <h3 className="text-xl font-bold text-brand-navy mb-2">Find Best Plans</h3>
                  <p className="text-brand-navy text-sm">Get personalized recommendations based on your usage patterns</p>
                </div>
                <div className="bg-white p-6 rounded-xl border border-brand-navy shadow-sm">
                  <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mb-4 mx-auto">
                    <span className="text-brand-cyan text-xl">📊</span>
                  </div>
                  <h3 className="text-xl font-bold text-brand-navy mb-2">Track Usage</h3>
                  <p className="text-brand-navy text-sm">Monitor your energy consumption and identify savings opportunities</p>
                </div>
                <div className="bg-white p-6 rounded-xl border border-brand-navy shadow-sm">
                  <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mb-4 mx-auto">
                    <span className="text-brand-cyan text-xl">💰</span>
                  </div>
                  <h3 className="text-xl font-bold text-brand-navy mb-2">Save Money</h3>
                  <p className="text-brand-navy text-sm">Optimize your plan selection to reduce your monthly energy bills</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Smart Meter Connection Section - Only show if address is entered */}
      {userAddress && (
        <section className="py-16 px-4 bg-brand-navy">
          <div className="max-w-4xl mx-auto">
            <SmartMeterSection />
          </div>
        </section>
      )}

      <section className="px-4 mt-8">
        <div className="max-w-3xl mx-auto border border-brand-navy/20 rounded-2xl p-8 bg-white shadow-sm text-center">
          <h2 className="text-2xl font-semibold text-brand-navy">
            Smart Meter Texas (SMT)
          </h2>
          <p className="mt-3 text-base text-brand-navy max-w-2xl mx-auto">
            Connect directly to your smart meter so IntelliWatt can automatically pull your real interval and billing data.
          </p>
          <div className="mt-6 flex justify-center">
            <Link
              href="/dashboard/api#smt"
              className="inline-flex items-center px-5 py-3 rounded-xl bg-brand-navy text-brand-blue text-sm font-bold border-2 border-brand-navy hover:border-brand-blue transition-all duration-300"
            >
              Connect SMT
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Section - Only show if address is entered */}
      {userAddress && (
        <section className="py-16 px-4 bg-brand-navy">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-bold text-brand-white text-center mb-12">
              Your <span className="text-brand-blue">Savings</span> Summary
            </h2>
            
            <div className="grid md:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="text-4xl font-bold text-brand-blue mb-2">
                  ${annualSavings}
                </div>
                <div className="text-brand-white">Annual Savings</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-brand-blue mb-2">
                  {accuracyRate}%
                </div>
                <div className="text-brand-white">Accuracy Rate</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-brand-blue mb-2">
                  {totalEntries}
                </div>
                <div className="text-brand-white">Jackpot Entries</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-brand-blue mb-2">
                  {totalReferrals}
                </div>
                <div className="text-brand-white">Referred Friends</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Quick Actions - Only show if address is entered */}
      {userAddress && (
        <section className="py-16 px-4 bg-brand-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-brand-navy text-center mb-12">
              Quick <span className="text-brand-blue">Actions</span>
            </h2>
            
            <div className="grid md:grid-cols-2 gap-8">
              <div className="bg-brand-navy p-8 rounded-2xl text-center">
                <div className="w-12 h-12 bg-brand-cyan rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-brand-navy text-xl">❓</span>
                </div>
                <h3 className="text-2xl font-bold text-brand-white mb-4">Need Help?</h3>
                <p className="text-brand-white mb-6">Get support or view our FAQ</p>
                <Link href="/faq" className="inline-block bg-brand-white text-brand-navy font-bold py-3 px-6 rounded-xl border-2 border-brand-white hover:border-brand-cyan transition-all duration-300">
                  Get Help
                </Link>
              </div>
              
              <div className="bg-brand-navy p-8 rounded-2xl text-center">
                <div className="w-12 h-12 bg-brand-cyan rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-brand-navy text-xl">⚙️</span>
                </div>
                <h3 className="text-2xl font-bold text-brand-white mb-4">Settings</h3>
                <p className="text-brand-white mb-6">Manage your account preferences</p>
                <Link href="/dashboard/settings" className="inline-block bg-brand-white text-brand-navy font-bold py-3 px-6 rounded-xl border-2 border-brand-white hover:border-brand-cyan transition-all duration-300">
                  Manage Settings
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
} 