'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import SmartMeterSection from '../../components/SmartMeterSection';
import QuickAddressEntry from '../../components/QuickAddressEntry';
import AddressCollection from '../../components/AddressCollection';
import AddressImageUpload from '../../components/AddressImageUpload';

interface DashboardData {
  user: {
    email: string;
    createdAt: string;
  };
  stats: {
    annualSavings: number;
    accuracyRate: number;
    totalEntries: number;
    totalReferrals: number;
  };
  profile: any;
  hasAddress: boolean;
  hasSmartMeter: boolean;
  hasUsageData: boolean;
  currentPlan: any;
}

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [userAddress, setUserAddress] = useState<string>('');
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
    
    // Load saved address from localStorage
    const savedAddress = localStorage.getItem('intelliwatt_user_address');
    if (savedAddress) {
      setUserAddress(savedAddress);
    }

    // Fetch user dashboard data
    const fetchDashboardData = async () => {
      try {
        const response = await fetch('/api/admin/user/dashboard');
        if (response.ok) {
          const data = await response.json();
          setDashboardData(data);
        } else {
          console.error('Failed to fetch dashboard data');
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const handleAddressSubmitted = (address: string) => {
    setUserAddress(address);
    if (!address) {
      localStorage.removeItem('intelliwatt_user_address');
    }
  };

  // Prevent hydration mismatch
  if (!mounted || loading) {
    return (
      <div className="min-h-screen bg-brand-white flex items-center justify-center">
        <div className="animate-pulse text-brand-navy">Loading...</div>
      </div>
    );
  }
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
            <p className="text-xl text-brand-white mb-8 max-w-4xl mx-auto leading-relaxed">
              Your AI-powered energy optimization dashboard. Track savings, manage your plan, and earn rewards.
            </p>
            
            {/* Address Entry - Right below hero text - Updated */}
            <div className="max-w-2xl mx-auto mb-8">
              <QuickAddressEntry 
                onAddressSubmitted={handleAddressSubmitted}
                userAddress={userAddress}
              />
            </div>
            
            {/* Beta Banner */}
            <div className="inline-block bg-brand-blue text-brand-navy px-6 py-2 rounded-full font-semibold mb-8">
              🚀 Beta Version - New Features Coming Soon!
            </div>
          </div>
        </div>
      </section>


      {/* Dashboard Grid - Only show if address is entered */}
      {userAddress && (
        <section className="py-16 px-4 bg-brand-white">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            
            {/* Usage Analysis */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <span className="text-brand-blue text-2xl">📊</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Usage Analysis</h3>
              <p className="text-brand-navy mb-6">View detailed usage patterns and insights</p>
              <Link href="/dashboard/usage" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                View Analysis
              </Link>
            </div>

            {/* Plan Comparison */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <span className="text-brand-blue text-2xl">🔍</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Plan Comparison</h3>
              <p className="text-brand-navy mb-6">Compare plans and find the best rates</p>
              <Link href="/dashboard/plans" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                Compare Plans
              </Link>
            </div>

            {/* Manual Entry */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <span className="text-brand-blue text-2xl">✍️</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Manual Entry</h3>
              <p className="text-brand-navy mb-6">Enter usage data manually</p>
              <Link href="/dashboard/manual-entry" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                Enter Data
              </Link>
            </div>

            {/* Referrals */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <span className="text-brand-blue text-2xl">👥</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Referrals</h3>
              <p className="text-brand-navy mb-6">Earn rewards by referring friends</p>
              <Link href="/dashboard/referrals" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                Invite Friends
              </Link>
            </div>

            {/* Jackpot Entries */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <span className="text-brand-blue text-2xl">🎰</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Jackpot Entries</h3>
              <p className="text-brand-navy mb-6">Track your entries and rewards</p>
              <Link href="/dashboard/entries" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                View Entries
              </Link>
            </div>

            {/* API Integration */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <span className="text-brand-blue text-2xl">🔌</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">API Integration</h3>
              <p className="text-brand-navy mb-6">Connect third-party services</p>
              <Link href="/dashboard/api" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                Manage APIs
              </Link>
            </div>

            {/* Appliance Tracking */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <span className="text-brand-blue text-2xl">🏠</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Appliances</h3>
              <p className="text-brand-navy mb-6">Track individual appliance usage</p>
              <Link href="/dashboard/appliances" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                Manage Appliances
              </Link>
            </div>

            {/* Upgrades */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300 group">
              <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <span className="text-brand-blue text-2xl">🚀</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Upgrades</h3>
              <p className="text-brand-navy mb-6">Explore premium features</p>
              <Link href="/dashboard/upgrades" className="inline-block bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                View Upgrades
              </Link>
            </div>
          </div>
        </div>
      </section>
      )}

      {/* Address Collection Section */}
      <section className="py-16 px-4 bg-brand-white">
        <div className="max-w-4xl mx-auto space-y-8">
          <AddressCollection />
          <AddressImageUpload />
        </div>
      </section>

      {/* Call to Action - Show if no address entered */}
      {!userAddress && (
        <section className="py-16 px-4 bg-brand-white">
          <div className="max-w-4xl mx-auto text-center">
            <div className="bg-brand-blue/10 p-8 rounded-2xl border border-brand-blue/20">
              <div className="w-16 h-16 bg-brand-blue rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-white text-2xl">⚡</span>
              </div>
              <h2 className="text-3xl font-bold text-brand-navy mb-4">
                Ready to Start <span className="text-brand-blue">Saving</span>?
              </h2>
              <p className="text-lg text-brand-navy mb-8 max-w-2xl mx-auto">
                Enter your service address above to unlock personalized energy plan recommendations and start tracking your savings.
              </p>
              <div className="grid md:grid-cols-3 gap-6 text-left">
                <div className="bg-white p-6 rounded-xl border border-brand-blue/20">
                  <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mb-4">
                    <span className="text-brand-blue text-xl">🔍</span>
                  </div>
                  <h3 className="text-xl font-bold text-brand-navy mb-2">Find Best Plans</h3>
                  <p className="text-brand-navy text-sm">Get personalized recommendations based on your usage patterns</p>
                </div>
                <div className="bg-white p-6 rounded-xl border border-brand-blue/20">
                  <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mb-4">
                    <span className="text-brand-blue text-xl">📊</span>
                  </div>
                  <h3 className="text-xl font-bold text-brand-navy mb-2">Track Usage</h3>
                  <p className="text-brand-navy text-sm">Monitor your energy consumption and identify savings opportunities</p>
                </div>
                <div className="bg-white p-6 rounded-xl border border-brand-blue/20">
                  <div className="w-12 h-12 bg-brand-navy rounded-full flex items-center justify-center mb-4">
                    <span className="text-brand-blue text-xl">💰</span>
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
                  ${dashboardData?.stats.annualSavings || 0}
                </div>
                <div className="text-brand-white">Annual Savings</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-brand-blue mb-2">
                  {dashboardData?.stats.accuracyRate || 0}%
                </div>
                <div className="text-brand-white">Accuracy Rate</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-brand-blue mb-2">
                  {dashboardData?.stats.totalEntries || 0}
                </div>
                <div className="text-brand-white">Jackpot Entries</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-brand-blue mb-2">
                  {dashboardData?.stats.totalReferrals || 0}
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
                <h3 className="text-2xl font-bold text-brand-white mb-4">Need Help?</h3>
                <p className="text-brand-white mb-6">Get support or view our FAQ</p>
                <Link href="/faq" className="inline-block bg-brand-blue text-brand-navy font-bold py-3 px-6 rounded-xl border-2 border-brand-blue hover:border-brand-white transition-all duration-300">
                  Get Help
                </Link>
              </div>
              
              <div className="bg-brand-navy p-8 rounded-2xl text-center">
                <h3 className="text-2xl font-bold text-brand-white mb-4">Settings</h3>
                <p className="text-brand-white mb-6">Manage your account preferences</p>
                <Link href="/dashboard/settings" className="inline-block bg-brand-blue text-brand-navy font-bold py-3 px-6 rounded-xl border-2 border-brand-blue hover:border-brand-white transition-all duration-300">
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