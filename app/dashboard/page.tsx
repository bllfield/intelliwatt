'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect, type ReactNode } from 'react';

const ICON_COLOR = '#00F0FF';

const IconChip = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl border border-[#00F0FF]/40 bg-brand-navy shadow-[0_0_25px_rgba(0,240,255,0.25)] transition-all duration-300 group-hover:border-[#00F0FF] group-hover:shadow-[0_0_30px_rgba(0,240,255,0.45)]">
    {children}
  </div>
);

const ApiIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx={6} cy={6} r={2.4} />
    <circle cx={18} cy={6} r={2.4} />
    <circle cx={12} cy={17.5} r={2.6} />
    <path d="M7.4 7.5l3.3 5.9" />
    <path d="M16.6 7.5l-3.3 5.9" />
    <path d="M6 8.7v5.9" />
    <path d="M18 8.7v5.9" />
  </svg>
);

const UsageIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 19h16" />
    <path d="M6 14l3.5-4.5 3 3.5L17 7l1.5 2.8" />
  </svg>
);

const CurrentRateIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
    <path d="M9 16h3" />
  </svg>
);

const PlansIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x={6} y={5} width={12} height={7} rx={1.5} />
    <path d="M5 12h14v7a1 1 0 01-1 1H6a1 1 0 01-1-1v-7z" />
  </svg>
);

const HomeIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 11l8-6 8 6" />
    <path d="M6 10v9a1 1 0 001 1h4v-5h2v5h4a1 1 0 001-1v-9" />
  </svg>
);

const AppliancesIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 3h8v6H8z" />
    <path d="M6 9h12v9a2 2 0 01-2 2H8a2 2 0 01-2-2z" />
    <path d="M10 13h4" />
    <path d="M10 16h4" />
  </svg>
);

const UpgradesIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v12" />
    <path d="M8.5 7.5L12 3l3.5 4.5" />
    <path d="M6 15h12v3a2 2 0 01-2 2H8a2 2 0 01-2-2z" />
  </svg>
);

const AnalysisIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx={10.5} cy={10.5} r={5.5} />
    <path d="M15.5 15.5L19 19" />
    <path d="M8.5 10.5l1.8 1.8 3-3.2" />
  </svg>
);

const OptimalEnergyIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13 2L6 13h5v9l7-11h-5z" />
  </svg>
);

const EntriesIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 6a2 2 0 012-2h10a2 2 0 012 2v3a1 1 0 01-1 1h0a2 2 0 000 4h0a1 1 0 011 1v3a2 2 0 01-2 2H7a2 2 0 01-2-2z" />
    <path d="M9 9h6" />
    <path d="M9 15h4" />
  </svg>
);

const ReferralsIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 14a4 4 0 014 4v1.5H8V18a4 4 0 014-4z" />
    <path d="M12 11a3 3 0 100-6 3 3 0 000 6z" />
    <path d="M5 18.5V18a4 4 0 013-3.87" />
    <path d="M19 18.5V18a4 4 0 00-3-3.87" />
    <path d="M7.5 7.5a2.5 2.5 0 115 0" />
  </svg>
);

const ProfileIcon = () => (
  <svg
    className="h-8 w-8 text-[#00F0FF]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 12a4 4 0 100-8 4 4 0 000 8z" />
    <path d="M6 20a6 6 0 0112 0" />
  </svg>
);

const DASHBOARD_BENEFITS: Array<{ icon: string; text: string }> = [
  { icon: '🎯', text: 'Completely free to join—no purchases or commitments required.' },
  { icon: '🏆', text: 'One verified winner is selected monthly and paid via digital wallet or check.' },
  { icon: '💰', text: 'Monthly jackpot grows by $5 whenever a member switches to a commissionable plan through IntelliWatt™.' },
  { icon: '💸', text: 'Earn entries by connecting Smart Meter Texas, uploading usage, and completing your profile details.' },
  { icon: '⚡', text: 'Secure Smart Meter Texas integration lets IntelliWatt™ pull usage data automatically with your permission.' },
  { icon: '🔒', text: 'Usage data is safeguarded with secure handling and is never sold to third parties.' },
  { icon: '👥', text: 'Earn an entry for every friend who shares their usage—referrals have no cap and never expire.' },
  { icon: '🏠', text: 'See where your home uses energy and uncover opportunities to reduce waste.' },
  { icon: '📊', text: 'Personalized savings reports highlight best-fit plans, appliances, and upgrades.' },
  { icon: '📈', text: 'Track usage trends over time and receive tailored recommendations.' },
  { icon: '🚫', text: 'No pressure—recommendations always focus on what saves you the most.' },
  { icon: '🧠', text: 'Powered by AI that blends usage, weather, and efficiency data for smarter guidance.' },
  { icon: '📱', text: 'Optimized for mobile so you can check entries and insights from any device.' },
  { icon: '🗣️', text: 'Eligible customers can submit testimonials for an additional entry that never expires.' },
  { icon: '🔁', text: 'Keep profile entries active by refreshing your usage data at least every 12 months.' },
  { icon: '🎉', text: 'Prefer mail-in? The AMOE postcard option keeps entries available without sharing usage.' },
];

type DashboardCard = {
  title: string;
  description: string;
  cta: string;
  href: string;
  Icon: () => JSX.Element;
};

const DASHBOARD_CARDS: DashboardCard[] = [
  {
    title: 'API Connect',
    description: 'Connect third-party services and integrations',
    cta: 'Manage APIs',
    href: '/dashboard/api',
    Icon: ApiIcon,
  },
  {
    title: 'Usage',
    description: 'View detailed usage patterns and insights',
    cta: 'View Analysis',
    href: '/dashboard/usage',
    Icon: UsageIcon,
  },
  {
    title: 'Current Rate',
    description: 'Upload your bill or enter plan details to earn 1 entry',
    cta: 'Add Current Rate',
    href: '/dashboard/current-rate',
    Icon: CurrentRateIcon,
  },
  {
    title: 'Plans',
    description: 'Compare plans and find the best rates',
    cta: 'Compare Plans',
    href: '/dashboard/plans',
    Icon: PlansIcon,
  },
  {
    title: 'Home Info',
    description: 'Keep your address and preferences current',
    cta: 'Update Home Info',
    href: '/dashboard/home',
    Icon: HomeIcon,
  },
  {
    title: 'Appliances',
    description: 'Track individual appliance usage',
    cta: 'Manage Appliances',
    href: '/dashboard/appliances',
    Icon: AppliancesIcon,
  },
  {
    title: 'Upgrades',
    description: 'Explore premium features',
    cta: 'View Upgrades',
    href: '/dashboard/upgrades',
    Icon: UpgradesIcon,
  },
  {
    title: 'Analysis',
    description: 'Dive into detailed energy analytics',
    cta: 'Analyze Usage',
    href: '/dashboard/analysis',
    Icon: AnalysisIcon,
  },
  {
    title: 'Optimal Energy',
    description: 'See IntelliWatt’s recommended optimal plan for your home',
    cta: 'View Recommendation',
    href: '/dashboard/optimal',
    Icon: OptimalEnergyIcon,
  },
  {
    title: 'Entries',
    description: 'Track your jackpot entries and rewards',
    cta: 'View Entries',
    href: '/dashboard/entries',
    Icon: EntriesIcon,
  },
  {
    title: 'Referrals',
    description: 'Earn rewards by referring friends',
    cta: 'Invite Friends',
    href: '/dashboard/referrals',
    Icon: ReferralsIcon,
  },
  {
    title: 'Profile',
    description: 'Update your contact details and notification preferences',
    cta: 'Manage Profile',
    href: '/dashboard/profile',
    Icon: ProfileIcon,
  },
];

export default function DashboardPage() {
const [mounted, setMounted] = useState(false);
  const [userAddress, setUserAddress] = useState<string>('');

  const resolveStorageKey = () => {
    if (typeof document === 'undefined') {
      return 'intelliwatt_user_address';
    }
    const cookies = document.cookie.split(';').map((entry) => entry.trim());
    const sessionCookie = cookies.find((entry) => entry.startsWith('intelliwatt_user='));
    if (!sessionCookie) {
      return 'intelliwatt_user_address_guest';
    }
    const value = sessionCookie.split('=').slice(1).join('=') || 'guest';
    return `intelliwatt_user_address_${value.toLowerCase()}`;
  };

  useEffect(() => {
    setMounted(true);

  if (typeof window === 'undefined') {
    return;
  }

  const key = resolveStorageKey();

  const legacy = localStorage.getItem('intelliwatt_user_address');
  if (legacy && key !== 'intelliwatt_user_address') {
    localStorage.setItem(key, legacy);
    localStorage.removeItem('intelliwatt_user_address');
    }

  const savedAddress = localStorage.getItem(key);
  setUserAddress(savedAddress ?? '');
}, []);

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
      <section className="bg-brand-navy py-16 px-4">
        <div className="mx-auto max-w-6xl rounded-3xl border-2 border-[#00F0FF]/40 bg-brand-navy/85 p-8 text-center shadow-[0_30px_80px_rgba(10,20,60,0.55)] backdrop-blur sm:p-12">
          <h1 className="text-4xl font-bold text-brand-white sm:text-5xl md:text-6xl">
            Welcome to <span className="text-brand-blue">IntelliWatt™</span>
          </h1>
          <p className="mx-auto mt-4 max-w-4xl text-lg leading-relaxed text-brand-white/85 sm:text-xl">
            Your FREE AI-powered energy optimization dashboard. Track savings, manage your plan, and earn rewards.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="relative inline-block h-24 w-full max-w-xs sm:h-28 sm:max-w-sm md:h-24 md:w-64"
            >
              <Image
                src="/Hitthejackwatt-Logo.png"
                alt="HitTheJackWatt™"
                fill
                className="object-contain"
                priority
              />
            </a>
            <div className="inline-flex w-full max-w-xl flex-col items-center gap-2 rounded-3xl border border-[#39FF14]/40 bg-[#39FF14]/10 px-6 py-4 text-center shadow-lg shadow-[#39FF14]/12 ring-1 ring-[#39FF14]/30">
              <span className="text-lg font-extrabold leading-tight text-brand-white md:text-xl">
                <span style={{ color: '#39FF14' }}>⚡ Connect your smart meter data</span>
                <span className="mx-1 text-brand-white">for</span>
                <span style={{ color: '#39FF14' }}>1 jackpot entry!</span>
              </span>
              <span className="text-sm font-bold leading-tight text-brand-white md:text-base">
                <Link href="/dashboard/referrals" style={{ color: '#BF00FF' }} className="hover:underline">
                  👥 Refer a Friend:
                </Link>
                <span className="mx-1 text-brand-white" />
                <span style={{ color: '#39FF14' }}>1 jackpot entry per signup!</span>
              </span>
            </div>
          </div>
          <div className="mx-auto mt-10 max-w-5xl rounded-3xl border-2 border-brand-blue/40 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_18px_55px_rgba(16,46,90,0.35)] sm:p-8">
            <h2 className="text-center text-2xl font-semibold uppercase tracking-[0.3em] text-brand-cyan/70">
              Benefits of IntelliWatt
            </h2>
            <div className="mt-6 grid gap-4 text-left sm:grid-cols-2">
              {DASHBOARD_BENEFITS.map(({ icon, text }) => (
                <div
                  key={text}
                  className="flex items-start gap-3 rounded-3xl border border-brand-blue/35 bg-brand-navy p-4 text-sm leading-relaxed text-brand-cyan"
                >
                  <span className="text-xl sm:text-2xl">{icon}</span>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 inline-flex flex-wrap items-center justify-center gap-3">
            <div className="inline-flex items-center rounded-full border border-brand-blue/50 bg-brand-blue px-6 py-2 text-sm font-semibold uppercase tracking-wide text-brand-navy">
              🚀 Beta Version — New features launching soon
            </div>
            <div className="inline-flex items-center rounded-full border border-white/30 bg-white/10 px-5 py-1.5 text-sm font-semibold uppercase tracking-wide text-brand-white">
              💸 100% Free — No fees, ever
            </div>
          </div>
        </div>
      </section>

      {/* Dashboard Grid */}
      <section className="bg-brand-white py-16 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 text-center md:grid-cols-2 lg:grid-cols-3">
            {DASHBOARD_CARDS.map(({ title, description, cta, href, Icon }) => (
              <div
                key={title}
                className="group rounded-3xl border border-[#00F0FF]/30 bg-brand-navy p-8 shadow-[0_30px_60px_rgba(10,20,60,0.5)] transition-all duration-300 hover:border-[#00F0FF]/80 hover:shadow-[0_38px_80px_rgba(0,240,255,0.35)]"
              >
                <IconChip>
                  <Icon />
                </IconChip>
                <h3 className="mb-3 text-2xl font-semibold text-[#00F0FF]">{title}</h3>
                <p className="mx-auto mb-6 max-w-xs text-base text-white">{description}</p>
                <Link
                  href={href}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[#00F0FF]/60 bg-transparent px-6 py-3 text-sm font-semibold uppercase tracking-wide text-[#00F0FF] transition-all duration-300 hover:border-[#00F0FF] hover:bg-[#00F0FF]/10"
                >
                  {cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action - Show if no address entered */}
      {!userAddress && (
        <section className="py-16 px-4 bg-brand-white">
          <div className="max-w-4xl mx-auto text-center">
            <div className="rounded-3xl border-2 border-brand-navy bg-white p-8 shadow-lg">
              <div className="w-16 h-16 rounded-full bg-brand-cyan shadow flex items-center justify-center mx-auto mb-6">
                <span className="text-brand-navy text-2xl">⚡</span>
              </div>
              <h2 className="text-3xl font-bold text-brand-navy mb-4">
                Ready to Start <span className="text-brand-blue">Saving</span>?
              </h2>
              <p className="text-lg text-brand-navy mb-8 max-w-2xl mx-auto">
                Enter your service address above to unlock personalized energy plan recommendations and start tracking your savings.
              </p>
              <div className="grid md:grid-cols-3 gap-6 text-center">
                <div className="rounded-2xl border border-brand-navy bg-white p-6 shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-brand-navy flex items-center justify-center mb-4 mx-auto">
                    <span className="text-brand-cyan text-xl">🔍</span>
                  </div>
                  <h3 className="text-xl font-bold text-brand-navy mb-2">Find Best Plans</h3>
                  <p className="text-brand-navy text-sm">Get personalized recommendations based on your usage patterns</p>
                </div>
                <div className="rounded-2xl border border-brand-navy bg-white p-6 shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-brand-navy flex items-center justify-center mb-4 mx-auto">
                    <span className="text-brand-cyan text-xl">📊</span>
                  </div>
                  <h3 className="text-xl font-bold text-brand-navy mb-2">Track Usage</h3>
                  <p className="text-brand-navy text-sm">Monitor your energy consumption and identify savings opportunities</p>
                </div>
                <div className="rounded-2xl border border-brand-navy bg-white p-6 shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-brand-navy flex items-center justify-center mb-4 mx-auto">
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

      {/* Stats Section - Only show if address is entered */}
      {userAddress && (
        <section className="py-16 px-4 bg-brand-navy">
          <div className="mx-auto max-w-6xl rounded-3xl border border-brand-cyan/40 bg-brand-navy/90 p-8 text-center shadow-[0_24px_70px_rgba(16,46,90,0.45)] sm:p-10">
            <h2 className="text-3xl font-bold text-brand-white text-center mb-10">
              Your <span className="text-brand-blue">Savings</span> Summary
            </h2>
            
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-brand-blue/35 bg-brand-navy/75 p-6 text-center shadow-[0_18px_45px_rgba(10,20,60,0.35)]">
                <div className="text-4xl font-bold text-brand-blue mb-2">${annualSavings}</div>
                <div className="text-brand-white">Annual Savings</div>
              </div>
              <div className="rounded-2xl border border-brand-blue/35 bg-brand-navy/75 p-6 text-center shadow-[0_18px_45px_rgba(10,20,60,0.35)]">
                <div className="text-4xl font-bold text-brand-blue mb-2">{accuracyRate}%</div>
                <div className="text-brand-white">Accuracy Rate</div>
              </div>
              <div className="rounded-2xl border border-brand-blue/35 bg-brand-navy/75 p-6 text-center shadow-[0_18px_45px_rgba(10,20,60,0.35)]">
                <div className="text-4xl font-bold text-brand-blue mb-2">{totalEntries}</div>
                <div className="text-brand-white">Jackpot Entries</div>
              </div>
              <div className="rounded-2xl border border-brand-blue/35 bg-brand-navy/75 p-6 text-center shadow-[0_18px_45px_rgba(10,20,60,0.35)]">
                <div className="text-4xl font-bold text-brand-blue mb-2">{totalReferrals}</div>
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
            <div className="rounded-3xl bg-brand-navy p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-brand-cyan flex items-center justify-center mx-auto mb-4">
                  <span className="text-brand-navy text-xl">❓</span>
                </div>
                <h3 className="text-2xl font-bold text-brand-white mb-4">Need Help?</h3>
                <p className="text-brand-white mb-6">Get support or view our FAQ</p>
                <Link href="/faq" className="inline-block bg-brand-white text-brand-navy font-bold py-3 px-6 rounded-xl border-2 border-brand-white hover:border-brand-cyan transition-all duration-300">
                  Get Help
                </Link>
              </div>
              
              <div className="rounded-3xl bg-brand-navy p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-brand-cyan flex items-center justify-center mx-auto mb-4">
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