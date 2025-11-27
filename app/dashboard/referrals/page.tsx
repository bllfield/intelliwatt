'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import DashboardHero from '@/components/dashboard/DashboardHero';
import hitTheJackWattAd from '@/hitthejackwatt ad.png';
import intelliWattAd from '@/INTELLIWATT AD 2.png';

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
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);

  const referralToken = referralData?.token ?? '';
  const hitTheJackWattUrl = referralToken
    ? `https://hitthejackwatt.com/?ref=${encodeURIComponent(referralToken)}`
    : 'https://hitthejackwatt.com/';
  const intelliWattUrl = referralToken
    ? `https://intelliwatt.com/?ref=${encodeURIComponent(referralToken)}`
    : 'https://intelliwatt.com/';
  const hitTheJackWattMessage = referralToken
    ? `I'm using HitTheJackWatt™ to get free entries into a monthly cash drawing just for sharing my energy data. It’s completely free to join, and they use my smart meter to find better electricity plans without costing me anything. Use my link to sign up and we’ll both get extra entries in the jackpot: ${hitTheJackWattUrl}`
    : 'Your referral link will appear here once your referral token is ready.';
  const intelliWattMessage = referralToken
    ? `I'm using IntelliWatt™ to watch my power usage and get notified when it's time to switch to a cheaper energy plan. It’s free, and it uses my actual smart meter data to find better deals without me having to do anything. Use my link to get set up: ${intelliWattUrl}`
    : 'Your referral link will appear here once your referral token is ready.';
  const shareNetworks = ['Facebook', 'X', 'LinkedIn', 'WhatsApp', 'Instagram'] as const;
  const buildShareHref = (
    network: (typeof shareNetworks)[number],
    url: string,
    message: string
  ) => {
    switch (network) {
      case 'Facebook':
        return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
      case 'X':
        return `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
      case 'LinkedIn':
        return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
      case 'WhatsApp':
        return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
      case 'Instagram':
      default:
        return `https://www.instagram.com/?url=${encodeURIComponent(url)}`;
    }
  };

  const hitTheJackWattShares = shareNetworks.map((network) => ({
    label: network,
    href: buildShareHref(network, hitTheJackWattUrl, hitTheJackWattMessage),
    image: hitTheJackWattAd,
    alt: 'HitTheJackWatt referral graphic',
  }));

  const intelliWattShares = shareNetworks.map((network) => ({
    label: network,
    href: buildShareHref(network, intelliWattUrl, intelliWattMessage),
    image: intelliWattAd,
    alt: 'IntelliWatt referral graphic',
  }));

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [linkResponse, statsResponse] = await Promise.all([
          fetch('/api/user/referral-link', { cache: 'no-store' }),
          fetch('/api/user/referral-stats', { cache: 'no-store' }),
        ]);

        if (linkResponse.ok) {
          const linkData = await linkResponse.json();
          setReferralData(linkData);
        }

        if (statsResponse.ok) {
          const statsData = (await statsResponse.json()) as ReferralStats;
          setStats(statsData);
        } else {
          setStats({ totalReferrals: 0, totalEntries: 0 });
        }
      } catch (error) {
        console.error('Error fetching referral data:', error);
        setStats({ totalReferrals: 0, totalEntries: 0 });
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
        setCopiedTarget('link');
        setTimeout(() => setCopiedTarget(null), 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    }
  };

  const handleCopyCode = async () => {
    if (referralData?.vanityCode) {
      try {
        await navigator.clipboard.writeText(referralData.vanityCode);
        setCopiedTarget('code');
        setTimeout(() => setCopiedTarget(null), 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    }
  };

  const handleCopyHitTheJackWattLink = async () => {
    if (!hitTheJackWattUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(hitTheJackWattUrl);
      setCopiedTarget('hjw-link');
      setTimeout(() => setCopiedTarget(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleCopyMessage = async (message: string, key: string) => {
    if (!message) {
      return;
    }

    try {
      await navigator.clipboard.writeText(message);
      setCopiedTarget(key);
      setTimeout(() => setCopiedTarget(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
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
      <DashboardHero
        title="Refer"
        highlight="Friends"
        description="Share your referral link and unlock unlimited bonus entries through successful referrals."
      >
        <div className="inline-flex items-center justify-center rounded-full border border-[#39FF14]/40 bg-[#39FF14]/15 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-[#39FF14] sm:text-sm">
          🎁 Earn 1 jackpot entry for each friend who signs up!
        </div>
      </DashboardHero>

      {/* Stats Section */}
      <section className="pt-4 pb-8 px-4 bg-brand-white">
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
      <section className="pt-4 pb-8 px-4 bg-brand-white">
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
            <div className="space-y-6 mb-8">
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
                    {copiedTarget === 'link' ? 'Copied!' : 'Copy Link'}
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
                    {copiedTarget === 'code' ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
              </div>

              {/* HitTheJackWatt Quick Share */}
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-brand-navy font-semibold">
                    HitTheJackWatt Link
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={hitTheJackWattUrl}
                      readOnly
                      className="flex-1 px-4 py-3 rounded-lg bg-brand-navy/5 border-2 border-brand-navy text-brand-navy"
                    />
                    <button
                      onClick={handleCopyHitTheJackWattLink}
                      className="bg-brand-navy text-brand-blue font-bold py-3 px-6 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 whitespace-nowrap"
                    >
                      {copiedTarget === 'hjw-link' ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-brand-navy font-semibold">
                    HitTheJackWatt Post Caption
                  </label>
                  <textarea
                    readOnly
                    rows={4}
                    value={hitTheJackWattMessage}
                    className="w-full px-4 py-3 rounded-lg bg-brand-navy/5 border-2 border-brand-navy text-brand-navy resize-none"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(hitTheJackWattMessage, 'hjw-message')}
                      className="bg-brand-navy text-brand-blue font-bold py-2.5 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300"
                    >
                      {copiedTarget === 'hjw-message' ? 'Copied!' : 'Copy Caption'}
                    </button>
                  </div>
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
                <span>You earn <strong style={{ color: '#39FF14' }}>1 entry</strong> per successful referral</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span style={{ color: '#BF00FF' }} className="text-lg">✓</span>
                  <span>Unlimited bonus entries from referrals!</span>
                </li>
              </ul>
            </div>

            {/* Sharing Tools */}
            <div className="mt-10 space-y-6">
              <h3 className="text-2xl font-bold text-brand-navy">Referral Sharing Tools</h3>
              <p className="text-brand-navy/80">
                Share your referral story anywhere your friends hang out. Copy the message or jump straight into a
                social post with your link embedded.
              </p>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="bg-brand-navy/5 p-6 rounded-xl border border-brand-navy/20 space-y-4">
                  <div>
                    <h4 className="text-xl font-semibold text-brand-navy">HitTheJackWatt™ Spotlight</h4>
                    <p className="text-sm text-brand-navy/80">
                      Highlight the free jackpot angle to excite friends about stacking bonus entries alongside you.
                    </p>
                  </div>
                  <textarea
                    readOnly
                    className="w-full text-sm rounded-lg border-2 border-brand-navy bg-brand-navy/5 p-3 text-brand-navy resize-none"
                    rows={5}
                    value={hitTheJackWattMessage}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(hitTheJackWattMessage, 'hjw-message')}
                      className="w-full rounded-lg border-2 border-brand-navy bg-brand-navy px-4 py-2.5 font-bold text-brand-blue transition-all duration-300 hover:border-brand-blue sm:col-span-2"
                    >
                      {copiedTarget === 'hjw-message' ? 'Copied!' : 'Copy message'}
                    </button>
                    {hitTheJackWattShares.map((share) => (
                      <a
                        key={`hit-${share.label}`}
                        href={share.href}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex flex-col overflow-hidden rounded-xl border border-brand-blue/40 bg-brand-blue/10 p-3 text-center text-sm font-semibold text-brand-navy transition-all duration-300 hover:border-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/70"
                        title={`Share on ${share.label}`}
                        aria-label={`Share on ${share.label}`}
                      >
                        <div className="relative mb-2 aspect-[4/3] w-full overflow-hidden rounded-lg bg-white">
                          <Image
                            src={share.image}
                            alt={share.alt}
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <span>Share on {share.label}</span>
                      </a>
                    ))}
                  </div>
                </div>

                <div className="bg-brand-navy/5 p-6 rounded-xl border border-brand-navy/20 space-y-4">
                  <div>
                    <h4 className="text-xl font-semibold text-brand-navy">IntelliWatt™ Savings Story</h4>
                    <p className="text-sm text-brand-navy/80">
                      Focus on real usage tracking and plan monitoring so friends see the long-term savings angle.
                    </p>
                  </div>
                  <textarea
                    readOnly
                    className="w-full text-sm rounded-lg border-2 border-brand-navy bg-brand-navy/5 p-3 text-brand-navy resize-none"
                    rows={5}
                    value={intelliWattMessage}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(intelliWattMessage, 'iw-message')}
                      className="w-full rounded-lg border-2 border-brand-navy bg-brand-navy px-4 py-2.5 font-bold text-brand-blue transition-all duration-300 hover:border-brand-blue sm:col-span-2"
                    >
                      {copiedTarget === 'iw-message' ? 'Copied!' : 'Copy message'}
                    </button>
                    {intelliWattShares.map((share) => (
                      <a
                        key={`iw-${share.label}`}
                        href={share.href}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex flex-col overflow-hidden rounded-xl border border-brand-blue/40 bg-brand-blue/10 p-3 text-center text-sm font-semibold text-brand-navy transition-all duration-300 hover:border-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/70"
                        title={`Share on ${share.label}`}
                        aria-label={`Share on ${share.label}`}
                      >
                        <div className="relative mb-2 aspect-[4/3] w-full overflow-hidden rounded-lg bg-white">
                          <Image
                            src={share.image}
                            alt={share.alt}
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <span>Share on {share.label}</span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
