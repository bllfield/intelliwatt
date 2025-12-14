'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  createdAt: string;
  entries?: any[];
  referrals?: any[];
  houseAddresses?: {
    id: string;
    archivedAt: string | null;
    addressLine1?: string | null;
  }[];
}

interface Commission {
  id: string;
  userId: string;
  type: string;
  amount: number;
  status: string;
  user?: User;
}

interface JackpotPayout {
  id: string;
  userId: string;
  amount: number;
  paid: boolean;
  user?: User;
}

interface FinanceRecord {
  id: string;
  type: string;
  source: string;
  amount: number;
  status: string;
}

interface FlaggedHouseDetail {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  addressCity: string;
  addressState: string;
  addressZip5: string;
  archivedAt: string | null;
  esiid: string | null;
  utilityName: string | null;
}

interface FlaggedAuthorizationDetail {
  id: string;
  meterNumber: string | null;
  esiid: string | null;
  archivedAt: string | null;
  authorizationEndDate: string | null;
  smtStatusMessage: string | null;
  houseAddress: {
    addressLine1: string;
    addressLine2: string | null;
    addressCity: string;
    addressState: string;
    addressZip5: string;
  } | null;
}

interface FlaggedHouseRecord {
  userId: string;
  email: string | null;
  esiid: string | null;
  attentionAt: string | null;
  attentionCode: string | null;
  houses: FlaggedHouseDetail[];
  authorizations: FlaggedAuthorizationDetail[];
}

interface EntryExpiryDigest {
  entryId: string;
  userId: string;
  entryType: string;
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';
  expiresAt: string | null;
  recordedAt: string;
  email: string | null;
}

interface ReferralRecord {
  id: string;
  status: 'PENDING' | 'QUALIFIED' | 'CANCELLED';
  referredEmail: string;
  createdAt: string;
  qualifiedAt: string | null;
  entryAwardedAt: string | null;
  referredBy: {
    id: string;
    email: string;
  };
  referredUser: {
    id: string;
    email: string;
  } | null;
  entry: {
    id: string;
    createdAt: string;
  } | null;
}

interface SmtEmailConfirmationRecord {
  id: string;
  userId: string;
  email: string | null;
  status: 'PENDING' | 'DECLINED';
  confirmedAt: string | null;
  createdAt: string;
  authorizationEndDate: string | null;
  smtStatus: string | null;
  smtStatusMessage: string | null;
  houseAddress: {
    addressLine1: string;
    addressLine2: string | null;
    addressCity: string;
    addressState: string;
    addressZip5: string;
  } | null;
}

interface TestimonialRecord {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  content: string;
  submittedAt: string;
  entryAwardedAt: string | null;
  user: {
    id: string;
    email: string;
    createdAt: string;
  };
}

interface SummaryStats {
  totalUsers: number;
  activeSmtAuthorizations: number;
  activeManualUploads: number;
  totalUsageCustomers: number;
  activeHouseCount: number;
  applianceCount: number;
  pendingSmtRevocations: number;
  testimonialSubmissionCount: number;
  testimonialPendingCount: number;
  referralPendingCount: number;
  referralQualifiedCount: number;
  pendingSmtEmailConfirmations: number;
  declinedSmtEmailConfirmations: number;
  approvedSmtEmailConfirmations: number;
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export default function AdminDashboard() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adminEmail, setAdminEmail] = useState('admin@intelliwatt.com');
  
  // Real data state
  const [users, setUsers] = useState<User[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [jackpotPayouts, setJackpotPayouts] = useState<JackpotPayout[]>([]);
  const [financeRecords, setFinanceRecords] = useState<FinanceRecord[]>([]);
  const [flaggedRecords, setFlaggedRecords] = useState<FlaggedHouseRecord[]>([]);
  const [expiringEntries, setExpiringEntries] = useState<EntryExpiryDigest[]>([]);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [testimonials, setTestimonials] = useState<TestimonialRecord[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [emailConfirmations, setEmailConfirmations] = useState<{
    pending: SmtEmailConfirmationRecord[];
    declined: SmtEmailConfirmationRecord[];
  }>({ pending: [], declined: [] });
  const [adminToken, setAdminToken] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [recalculatingReferrals, setRecalculatingReferrals] = useState(false);
  const [recalculatingEntries, setRecalculatingEntries] = useState(false);
  const [copiedAdId, setCopiedAdId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedToken = window.localStorage.getItem('intelliwattAdminToken');
    if (storedToken) {
      setAdminToken(storedToken);
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const trimmed = adminToken.trim();
    if (trimmed.length > 0) {
      window.localStorage.setItem('intelliwattAdminToken', trimmed);
    } else {
      window.localStorage.removeItem('intelliwattAdminToken');
    }
  }, [adminToken]);
  const readResponseBody = useCallback(async (response: Response) => {
    const raw = await response.text();
    let json: any = null;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
    }
    return { raw, json };
  }, []);
  const withAdminHeaders = useCallback(
    (init?: RequestInit): RequestInit => {
      const headers = new Headers(init?.headers ?? {});
      const token = adminToken.trim();
      if (token.length > 0) {
        headers.set('x-admin-token', token);
      }
      return { ...init, headers };
    },
    [adminToken],
  );
  const fetchWithAdmin = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => fetch(input, withAdminHeaders(init)),
    [withAdminHeaders],
  );

  // Fetch real data from API
  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      const [
        summaryRes,
        usersRes,
        commissionsRes,
        jackpotRes,
        financeRes,
        flaggedRes,
        expiringRes,
        testimonialsRes,
        referralsRes,
        emailConfirmationsRes,
      ] = await Promise.all([
        fetchWithAdmin('/api/admin/stats/summary'),
        fetchWithAdmin('/api/admin/users'),
        fetchWithAdmin('/api/admin/commissions'),
        fetchWithAdmin('/api/admin/jackpot'),
        fetchWithAdmin('/api/admin/finance'),
        fetchWithAdmin('/api/admin/houses/flagged'),
        fetchWithAdmin('/api/admin/hitthejackwatt/expiring'),
        fetchWithAdmin('/api/admin/testimonials'),
        fetchWithAdmin('/api/admin/referrals'),
        fetchWithAdmin('/api/admin/smt/email-confirmations'),
      ]);

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        console.log('Fetched summary stats:', summaryData);
        setSummary(summaryData);
      } else {
        console.error('Failed to fetch summary stats:', summaryRes.status, summaryRes.statusText);
      }

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        console.log('Fetched users data:', usersData);
        setUsers(usersData);
      } else {
        console.error('Failed to fetch users:', usersRes.status, usersRes.statusText);
      }

      if (commissionsRes.ok) {
        const commissionsData = await commissionsRes.json();
        console.log('Fetched commissions data:', commissionsData);
        setCommissions(commissionsData);
      } else {
        console.error('Failed to fetch commissions:', commissionsRes.status, commissionsRes.statusText);
      }

      if (jackpotRes.ok) {
        const jackpotData = await jackpotRes.json();
        console.log('Fetched jackpot data:', jackpotData);
        setJackpotPayouts(jackpotData);
      } else {
        console.error('Failed to fetch jackpot:', jackpotRes.status, jackpotRes.statusText);
      }

      if (financeRes.ok) {
        const financeData = await financeRes.json();
        console.log('Fetched finance data:', financeData);
        setFinanceRecords(financeData);
      } else {
        console.error('Failed to fetch finance:', financeRes.status, financeRes.statusText);
      }

      if (flaggedRes.ok) {
        const flaggedData = await flaggedRes.json();
        console.log('Fetched flagged houses:', flaggedData);
        setFlaggedRecords(flaggedData);
      } else {
        console.error('Failed to fetch flagged houses:', flaggedRes.status, flaggedRes.statusText);
      }

      if (expiringRes.ok) {
        const expiryData = await expiringRes.json();
        console.log('Fetched expiring entries:', expiryData);
        setExpiringEntries(expiryData);
      } else {
        console.error('Failed to fetch expiring entries:', expiringRes.status, expiringRes.statusText);
      }

      if (testimonialsRes.ok) {
        const testimonialData = await testimonialsRes.json();
        console.log('Fetched testimonials:', testimonialData);
        setTestimonials(testimonialData);
      } else {
        console.error('Failed to fetch testimonials:', testimonialsRes.status, testimonialsRes.statusText);
      }

      if (referralsRes.ok) {
        const referralsData = await referralsRes.json();
        console.log('Fetched referrals:', referralsData);
        setReferrals(referralsData);
      } else {
        console.error('Failed to fetch referrals:', referralsRes.status, referralsRes.statusText);
      }

      if (emailConfirmationsRes.ok) {
        const confirmationsData = await emailConfirmationsRes.json();
        console.log('Fetched SMT email confirmations:', confirmationsData);
        setEmailConfirmations(confirmationsData);
      } else {
        console.error(
          'Failed to fetch SMT email confirmations:',
          emailConfirmationsRes.status,
          emailConfirmationsRes.statusText,
        );
      }
    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  const handleRecalculateReferrals = useCallback(async () => {
    try {
      setRecalculatingReferrals(true);
      const response = await fetchWithAdmin('/api/admin/referrals/recalculate', {
        method: 'POST',
      });

      if (!response.ok) {
        console.error('Failed to recalculate referrals', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error recalculating referrals:', error);
    } finally {
      setRecalculatingReferrals(false);
      fetchData();
    }
  }, [fetchData]);

  const handleRecalculateEntries = useCallback(async () => {
    try {
      setRecalculatingEntries(true);
      const response = await fetchWithAdmin('/api/admin/entries/recalculate', {
        method: 'POST',
      });

      if (!response.ok) {
        console.error('Failed to resync entries', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error resyncing entries:', error);
    } finally {
      setRecalculatingEntries(false);
      fetchData();
    }
  }, [fetchData]);

  const handleCopyAdCaption = useCallback(async (adId: string, caption: string) => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopiedAdId(adId);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setCopiedAdId(null), 2000);
    } catch (error) {
      console.error('Failed to copy ad caption:', error);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setMounted(true);
    document.title = 'Admin Dashboard - IntelliWatt™';

    fetchData();
  }, [fetchData]);

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-navy flex items-center justify-center">
        <div className="text-brand-white text-xl">Loading Admin Dashboard...</div>
      </div>
    );
  }

  const totalCommissions = commissions.reduce((sum, r) => sum + r.amount, 0);
  const pendingJackpot = jackpotPayouts.filter(j => !j.paid).length;
  const totalFinance = financeRecords.reduce((sum, f) => sum + (f.type === 'income' ? f.amount : -f.amount), 0);
  const formatTimestamp = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');
  const expiringSoonCount = expiringEntries.filter((entry) => entry.status === 'EXPIRING_SOON').length;
  const totalUsersCount = summary?.totalUsers ?? users.length;
  const smtApiCount = summary?.activeSmtAuthorizations ?? 0;
  const manualEntriesCount = summary?.activeManualUploads ?? 0;
  const totalUsageCustomers = summary?.totalUsageCustomers ?? 0;
  const applianceCount = summary?.applianceCount ?? 0;
  const pendingRevocationsCount = summary?.pendingSmtRevocations ?? 0;
  const testimonialsTotal = summary?.testimonialSubmissionCount ?? testimonials.length;
  const testimonialsPendingCount = summary?.testimonialPendingCount ?? testimonials.filter((record) => record.status === 'PENDING').length;
  const pendingEmailConfirmationsCount =
    summary?.pendingSmtEmailConfirmations ?? emailConfirmations.pending.length;
  const declinedEmailConfirmationsCount =
    summary?.declinedSmtEmailConfirmations ?? emailConfirmations.declined.length;
  const approvedEmailConfirmationsCount = summary?.approvedSmtEmailConfirmations ?? 0;
  const testimonialStatusStyles: Record<TestimonialRecord['status'], string> = {
    PENDING: 'border border-amber-400/40 bg-amber-400/10 text-amber-600',
    APPROVED: 'border border-emerald-400/40 bg-emerald-400/10 text-emerald-600',
    REJECTED: 'border border-rose-400/40 bg-rose-400/10 text-rose-600',
  };
  const referralPendingTotal =
    summary?.referralPendingCount ?? referrals.filter((record) => record.status === 'PENDING').length;
  const referralQualifiedTotal =
    summary?.referralQualifiedCount ?? referrals.filter((record) => record.status === 'QUALIFIED').length;
  const referralStatusStyles: Record<ReferralRecord['status'], string> = {
    PENDING: 'border border-amber-400/40 bg-amber-400/10 text-amber-600',
    QUALIFIED: 'border border-emerald-400/40 bg-emerald-400/10 text-emerald-600',
    CANCELLED: 'border border-rose-400/40 bg-rose-400/10 text-rose-600',
  };
  const adOptions = [
    {
      id: 'jackpot-charge',
      title: 'Jackpot Jumpstart',
      description:
        'Hero-ready neon tile that mirrors the HitTheJackWatt landing gradient and spotlights the instant jackpot promise.',
      imageSrc: '/ads/hitthejackwatt/ad-jackpot-charge.svg',
      alt: 'HitTheJackWatt jackpot jumpstart tile with neon magenta headline over deep purple gradient.',
      caption: [
        '🎰 HitTheJackWatt™ Jackpot Jumpstart',
        'Slash your energy bill and stay in every monthly drawing with verified Smart Meter Texas data.',
        'Authorize once, let IntelliWatt monitor usage, and watch jackpot entries stack automatically.',
        'Claim your dashboard: https://www.hitthejackwatt.com',
      ].join('\n'),
      downloadName: 'HitTheJackWatt-Jackpot-Jumpstart.svg',
    },
    {
      id: 'smart-meter-surge',
      title: 'Smart Meter Autopilot',
      description:
        'Cyan-forward automation tile designed to promote the “connect once, stay verified” SMT workflow.',
      imageSrc: '/ads/hitthejackwatt/ad-smart-meter-surge.svg',
      alt: 'HitTheJackWatt smart meter autopilot tile with cyan waveform accents.',
      caption: [
        '⚡ HitTheJackWatt™ Smart Meter Autopilot',
        'Connect Smart Meter Texas once—IntelliWatt pulls verified intervals daily and keeps entries active.',
        'Track live usage, savings alerts, and jackpot progress without manual uploads.',
        'Sync now and automate your energy dashboard: https://www.hitthejackwatt.com',
      ].join('\n'),
      downloadName: 'HitTheJackWatt-Smart-Meter-Autopilot.svg',
    },
    {
      id: 'referral-rush',
      title: 'Referral Power-Up',
      description:
        'Referral-forward magenta tile aligned with the landing page CTA bars for ambassador sharing.',
      imageSrc: '/ads/hitthejackwatt/ad-referral-rush.svg',
      alt: 'HitTheJackWatt referral power-up tile with neon magenta and green glow.',
      caption: [
        '🤝 HitTheJackWatt™ Referral Power-Up',
        'Invite friends, earn double entries once their usage is verified—no manual chasing.',
        'We send reminders, log progress, and surface payouts in your IntelliWatt referral hub.',
        'Share your jackpot link: https://www.hitthejackwatt.com',
      ].join('\n'),
      downloadName: 'HitTheJackWatt-Referral-Power-Up.svg',
    },
    {
      id: 'savings-snapshot',
      title: 'Savings Radar',
      description:
        'Data-forward cyan tile that echoes the IntelliWatt analytics sections with neon radar accents.',
      imageSrc: '/ads/hitthejackwatt/ad-savings-snapshot.svg',
      alt: 'HitTheJackWatt savings radar tile with cyan mesh background and neon headline.',
      caption: [
        '📊 HitTheJackWatt™ Savings Radar',
        'Upload a bill for baseline insights, then automate SMT pulls for precision savings tracking.',
        'Compare your current contract against curated Texas plans while banking jackpot entries.',
        'Open your IntelliWatt dashboard: https://www.hitthejackwatt.com',
      ].join('\n'),
      downloadName: 'HitTheJackWatt-Savings-Radar.svg',
    },
  ];
  const pendingReferrals = referrals.filter((record) => record.status === 'PENDING');

  const flaggedReplacements = flaggedRecords.filter(
    (record) => record.attentionCode === 'smt_replaced',
  );
  const flaggedRevocations = flaggedRecords.filter(
    (record) => record.attentionCode === 'smt_revoke_requested',
  );
  const flaggedEmailPending = flaggedRecords.filter(
    (record) => record.attentionCode === 'smt_email_pending',
  );
  const flaggedEmailDeclined = flaggedRecords.filter(
    (record) => record.attentionCode === 'smt_email_declined',
  );

  const overviewStats = [
    { label: 'Users', value: totalUsersCount.toLocaleString() },
    { label: "SMT API's", value: smtApiCount.toLocaleString() },
    { label: 'Manual Entries', value: manualEntriesCount.toLocaleString() },
    { label: 'Total Usage Customers', value: totalUsageCustomers.toLocaleString() },
    { label: 'Appliances #', value: applianceCount.toLocaleString() },
    { label: 'Testimonials', value: testimonialsTotal.toLocaleString() },
    { label: 'Testimonials Pending', value: testimonialsPendingCount.toLocaleString() },
    { label: 'Referrals Pending', value: referralPendingTotal.toLocaleString() },
    { label: 'Referrals Qualified', value: referralQualifiedTotal.toLocaleString() },
    { label: 'SMT Email Confirmations Pending', value: pendingEmailConfirmationsCount.toLocaleString() },
    { label: 'SMT Email Confirmations Declined', value: declinedEmailConfirmationsCount.toLocaleString() },
    { label: 'SMT Email Confirmations Approved', value: approvedEmailConfirmationsCount.toLocaleString() },
    { label: 'SMT Email Follow-ups Flagged', value: flaggedEmailPending.length.toLocaleString() },
    { label: 'SMT Revocations Pending', value: pendingRevocationsCount.toLocaleString() },
    { label: 'Total Commissions', value: currencyFormatter.format(totalCommissions) },
    { label: 'Net Finance', value: currencyFormatter.format(totalFinance) },
    { label: 'Pending Jackpot Payouts', value: pendingJackpot.toLocaleString() },
    { label: 'Homes flagged for SMT replacement email', value: flaggedReplacements.length.toLocaleString() },
    { label: 'Entries expiring within 30 days', value: expiringSoonCount.toLocaleString() },
  ];

  return (
    <div className="min-h-screen bg-brand-navy">
      {/* Header */}
      <div className="bg-brand-navy border-b border-brand-blue/20">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-brand-white">Admin Dashboard</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-brand-blue">
                <div className="flex items-center gap-2 rounded-full border border-brand-blue/30 bg-brand-blue/10 px-3 py-1">
                  <input
                    type="password"
                    value={adminToken}
                    onChange={(event) => setAdminToken(event.target.value)}
                    placeholder="Admin token"
                    className="w-40 bg-transparent text-xs font-semibold uppercase tracking-wide text-brand-blue placeholder:text-brand-blue/60 focus:outline-none"
                  />
                  {adminToken ? (
                    <button
                      type="button"
                      onClick={() => setAdminToken('')}
                      className="text-xs font-semibold uppercase tracking-wide text-brand-blue/70 transition hover:text-brand-blue"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              <button
                type="button"
                onClick={handleRecalculateEntries}
                disabled={recalculatingEntries || refreshing || recalculatingReferrals}
                className="inline-flex items-center gap-2 rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {recalculatingEntries ? 'Resyncing entries…' : 'Re-sync entries'}
              </button>
              <button
                type="button"
                onClick={handleRecalculateReferrals}
                disabled={recalculatingReferrals || refreshing || recalculatingEntries}
                className="inline-flex items-center gap-2 rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {recalculatingReferrals ? 'Replaying referrals…' : 'Re-run referral sync'}
              </button>
              <button
                type="button"
                onClick={fetchData}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? 'Refreshing…' : 'Refresh data'}
              </button>
              <span className="text-brand-blue/80">Logged in as: {adminEmail}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats Overview */}
        <div className="grid gap-6 mb-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {overviewStats.map((stat) => (
            <div key={stat.label} className="bg-brand-white rounded-lg p-6 shadow-lg">
              <div className="text-2xl font-bold text-brand-navy">{stat.value}</div>
              <div className="text-brand-navy/60">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* HitTheJackWatt Social Ads */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold text-brand-navy mb-2">🎯 HitTheJackWatt Social Ads</h2>
              <p className="text-sm text-brand-navy/70">
                Download ready-to-share square creatives or copy the suggested caption. Each tile keeps brand colors on-brand
                for the HitTheJackWatt jackpot campaign and pairs cleanly with referral links or paid ads.
              </p>
            </div>
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 self-start rounded-full border border-brand-blue/30 bg-brand-blue/10 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/20"
            >
              View landing site
            </a>
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {adOptions.map((ad) => (
              <article
                key={ad.id}
                className="flex h-full flex-col rounded-2xl border border-brand-navy/10 bg-brand-navy/5 p-4"
              >
                <div className="relative overflow-hidden rounded-xl bg-brand-navy shadow-inner">
                  <img
                    src={ad.imageSrc}
                    alt={ad.alt}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="mt-4 flex flex-col gap-3 text-brand-navy">
                  <div>
                    <h3 className="text-lg font-semibold text-brand-navy">{ad.title}</h3>
                    <p className="mt-1 text-sm text-brand-navy/70">{ad.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => handleCopyAdCaption(ad.id, ad.caption)}
                      className="inline-flex items-center gap-2 rounded-full border border-brand-blue/30 bg-brand-blue/10 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/20"
                    >
                      {copiedAdId === ad.id ? 'Caption copied!' : 'Copy caption'}
                    </button>
                    <a
                      href={ad.imageSrc}
                      download={ad.downloadName}
                      className="inline-flex items-center gap-2 rounded-full border border-brand-navy/20 bg-brand-white px-4 py-2 text-sm font-semibold uppercase tracking-wide text-brand-navy shadow-sm transition hover:border-brand-blue/40 hover:text-brand-blue"
                    >
                      Download SVG
                    </a>
                  </div>
                </div>
                <span className="sr-only" aria-live="polite">
                  {copiedAdId === ad.id ? 'Caption copied to clipboard' : ''}
                </span>
              </article>
            ))}
          </div>
        </section>

        {/* Prisma Studio Shortcuts */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-3">🛠️ Prisma Studio Shortcuts</h2>
          <p className="text-sm text-brand-navy/70 mb-4">
            Copy any block below into a local PowerShell window to open Prisma Studio for the selected database.
            Each command sets the appropriate connection string and binds Studio to its own port.
          </p>
          <div className="space-y-4 rounded-xl border border-brand-navy/10 bg-brand-navy/5 p-4 text-sm font-mono text-brand-navy">
            <div>
              <div className="font-semibold text-brand-navy mb-1">Master (pooled via DATABASE_URL)</div>
              <code className="block whitespace-pre-wrap">
                {`$env:DATABASE_URL = "postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25061/app-pool?sslmode=require&pgbouncer=true"
npx prisma studio --browser none --port 5555`}
              </code>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Current Plan module</div>
              <code className="block whitespace-pre-wrap">
                {`$env:CURRENT_PLAN_DATABASE_URL = "postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_current_plan?sslmode=require"
npx prisma studio --schema=prisma/current-plan/schema.prisma --browser none --port 5556`}
              </code>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Usage module</div>
              <code className="block whitespace-pre-wrap">
                {`$env:USAGE_DATABASE_URL = "postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_usage?sslmode=require"
npx prisma studio --schema=prisma/usage/schema.prisma --browser none --port 5557`}
              </code>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Home Details module</div>
              <code className="block whitespace-pre-wrap">
                {`$env:DATABASE_URL = "postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_home_details?sslmode=require"
npx prisma studio --browser none --port 5558`}
              </code>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Appliances module</div>
              <code className="block whitespace-pre-wrap">
                {`$env:DATABASE_URL = "postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_appliances?sslmode=require"
npx prisma studio --browser none --port 5559`}
              </code>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Upgrades module</div>
              <code className="block whitespace-pre-wrap">
                {`$env:DATABASE_URL = "postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_upgrades?sslmode=require"
npx prisma studio --browser none --port 5560`}
              </code>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">WattBuy Offers module</div>
              <code className="block whitespace-pre-wrap">
                {`$env:DATABASE_URL = "postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_wattbuy_offers?sslmode=require"
npx prisma studio --browser none --port 5561`}
              </code>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Referrals module</div>
              <code className="block whitespace-pre-wrap">
                {`$env:DATABASE_URL = "postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_referrals?sslmode=require"
npx prisma studio --browser none --port 5562`}
              </code>
            </div>
            <p className="text-xs text-brand-navy/60">
              Tip: run each pair in a fresh window, and stop the Studio process when finished (Ctrl+C or closing the console).
            </p>
          </div>
        </section>

        {/* Quick Links / Tools Section */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">🔧 Admin Tools</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <a
              href="/admin/wattbuy/inspector"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🔍 WattBuy Inspector</div>
              <div className="text-sm text-brand-navy/60">Test electricity, retail rates, and offers endpoints with real-time metadata</div>
            </a>
            <a
              href="/admin/tdsp-tariffs"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🏭 TDSP Tariff Viewer</div>
              <div className="text-sm text-brand-navy/60">
                Inspect Texas TDSP delivery tariffs, components, and lookupTdspCharges summaries by code and date
              </div>
            </a>
            <a
              href="/admin/smt/inspector"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📊 SMT Inspector</div>
              <div className="text-sm text-brand-navy/60">Test SMT ingest, upload, and health endpoints</div>
            </a>
            <a
              href="/admin/usage"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">⚙️ Usage Test Suite</div>
              <div className="text-sm text-brand-navy/60">
                Exercise SMT + Green Button pipelines and monitor live usage debugging feeds
              </div>
            </a>
            <a
              href="/admin/retail-rates"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">⚡ Retail Rates</div>
              <div className="text-sm text-brand-navy/60">Explore and manage retail rate data</div>
            </a>
            <a
              href="/admin/modules"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📦 Modules</div>
              <div className="text-sm text-brand-navy/60">View available system modules</div>
            </a>
            <a
              href="/admin/site-map"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🗺️ Site Map &amp; Routes</div>
              <div className="text-sm text-brand-navy/60">
                Inventory of every page, including hidden test harnesses and admin tools
              </div>
            </a>
            <a
              href="/admin/database"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🗄️ Database Explorer</div>
              <div className="text-sm text-brand-navy/60">Read-only database viewer with search and CSV export</div>
            </a>
            <a
              href="/admin/openai/usage"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🧠 OpenAI Usage</div>
              <div className="text-sm text-brand-navy/60">
                Track OpenAI calls, tokens, and estimated cost by module.
              </div>
            </a>
            <a
              href="/admin/current-plan/bill-parser"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📄 Bill Parser Harness</div>
              <div className="text-sm text-brand-navy/60">
                Test current-plan bill parsing (regex + OpenAI) and review parsed bill templates.
              </div>
            </a>
            <a
              href="/admin/puct/reps"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📇 PUCT REP Directory</div>
              <div className="text-sm text-brand-navy/60">
                Upload the latest PUCT REP CSV to refresh the internal Retail Electric Provider list
              </div>
            </a>
            <a
              href="/admin/efl/tests"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🧪 EFL Fact Card Engine</div>
              <div className="text-sm text-brand-navy/60">
                Run EFL PlanRules smoke tests to verify extraction and pricing helpers
              </div>
            </a>
            <a
              href="/admin/efl/manual-upload"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📄 Manual Fact Card Loader</div>
              <div className="text-sm text-brand-navy/60">
                Upload an EFL PDF, review deterministic extracts, and copy the AI prompt for PlanRules
              </div>
            </a>
            <a
              href="/admin/efl/manual-review"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📝 Fact Card Manual Review Queue</div>
              <div className="text-sm text-brand-navy/60">
                Review EFL Fact Cards that the AI extractor flags as requiring manual review.
              </div>
            </a>
            <a
              href="/admin/efl/links"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🔗 EFL Link Runner</div>
              <div className="text-sm text-brand-navy/60">
                Fetch any EFL PDF URL, fingerprint it, and open the document in a new tab
              </div>
            </a>
          </div>
        </section>

        {/* Entry Expiration Digest */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">⚠️ Jackpot Entry Expiration</h2>
          <p className="text-brand-navy/70 mb-4">
            Entries listed here are either expiring within the next 30 days or already expired due to missing usage
            data. Use this list to queue customer outreach and keep reward eligibility up to date. The daily cron clears
            and repopulates this table automatically. To force a refresh manually, call the secured endpoint
            <code className="mx-1 rounded bg-brand-navy/10 px-1 py-0.5 text-xs text-brand-navy">POST /api/admin/hitthejackwatt/refresh</code>
            with the admin token.
          </p>
          {expiringEntries.length === 0 ? (
            <div className="rounded-md border border-brand-navy/10 bg-brand-navy/5 px-4 py-6 text-center text-brand-navy/70">
              No expiring entries detected in the latest digest.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-brand-navy/10">
              <table className="min-w-full divide-y divide-brand-navy/10">
                <thead className="bg-brand-navy/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Entry Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Expires At
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Recorded
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-navy/10 bg-white">
                  {expiringEntries.map((entry) => (
                    <tr key={entry.entryId}>
                      <td className="px-4 py-3 text-sm text-brand-navy">{entry.email ?? entry.userId}</td>
                      <td className="px-4 py-3 text-sm text-brand-navy capitalize">
                        {entry.entryType.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold">
                        {entry.status === 'EXPIRING_SOON' ? (
                          <span className="text-amber-600">Expiring Soon</span>
                        ) : entry.status === 'EXPIRED' ? (
                          <span className="text-rose-600">Expired</span>
                        ) : (
                          <span className="text-emerald-600">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-navy">
                        {entry.expiresAt ? new Date(entry.expiresAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-navy/70">
                        {new Date(entry.recordedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Customer Testimonials */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-2">🗣️ Customer Testimonials</h2>
          <p className="text-sm text-brand-navy/70 mb-4">
            Testimonials unlock only after a customer switches plans or completes an IntelliPath upgrade. Monitor pending
            submissions here and follow up when additional verification is required.
          </p>
          {testimonials.length === 0 ? (
            <div className="rounded-md border border-brand-navy/10 bg-brand-navy/5 px-4 py-6 text-center text-brand-navy/70">
              No testimonials submitted yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-brand-navy/10">
              <table className="min-w-full divide-y divide-brand-navy/10">
                <thead className="bg-brand-navy/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Entry Awarded
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Submitted
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Testimonial
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-navy/10 bg-white">
                  {testimonials.map((record) => {
                    const snippet =
                      record.content.length > 200 ? `${record.content.slice(0, 200)}…` : record.content;
                    return (
                      <tr key={record.id}>
                        <td className="px-4 py-3 text-sm text-brand-navy">
                          <div className="font-semibold">{record.user.email}</div>
                          <div className="text-xs text-brand-navy/60">
                            Customer since {formatTimestamp(record.user.createdAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${testimonialStatusStyles[record.status]}`}
                          >
                            {record.status.toLowerCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-brand-navy">
                          {record.entryAwardedAt ? formatTimestamp(record.entryAwardedAt) : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-brand-navy">
                          {formatTimestamp(record.submittedAt)}
                        </td>
                        <td className="px-4 py-3 text-sm text-brand-navy/80">{snippet}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Referral Progress */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-2">🤝 Referral Progress</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm text-brand-navy/80 mb-4">
            <span>
              Referrers earn their bonus entry once the invited member shares usage through Smart Meter Texas or a manual upload.
            </span>
            <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-600">
              Pending: {pendingReferrals.length.toLocaleString()}
            </span>
          </div>
          {referrals.length === 0 ? (
            <div className="rounded-md border border-brand-navy/10 bg-brand-navy/5 px-4 py-6 text-center text-brand-navy/70">
              No referrals recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-brand-navy/10">
              <table className="min-w-full divide-y divide-brand-navy/10">
                <thead className="bg-brand-navy/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Referrer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Invitee
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Qualified
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Entry Awarded
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-navy/10 bg-white">
                  {referrals.map((record) => (
                    <tr key={record.id}>
                      <td className="px-4 py-3 text-sm text-brand-navy">
                        <div className="font-semibold">{record.referredBy.email}</div>
                        <div className="text-xs text-brand-navy/60">
                          Created {new Date(record.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-navy">
                        <div>{record.referredEmail}</div>
                        {record.referredUser ? (
                          <div className="text-xs text-brand-navy/60">User ID: {record.referredUser.id}</div>
                        ) : (
                          <div className="text-xs text-brand-navy/50">User not linked yet</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${referralStatusStyles[record.status]}`}
                        >
                          {record.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-navy">
                        {record.qualifiedAt ? new Date(record.qualifiedAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-navy">
                        {record.entryAwardedAt ? new Date(record.entryAwardedAt).toLocaleString() : 'Pending'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Pending Referral Validation */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-2">⏳ Referrals Awaiting Invitee Usage</h2>
          <p className="text-sm text-brand-navy/70 mb-4">
            These invitations have not qualified yet. Once the invitee completes a Smart Meter Texas connection or manual usage upload,
            the referral will be replayed automatically and the bonus entry will be awarded.
          </p>
          {pendingReferrals.length === 0 ? (
            <div className="rounded-md border border-brand-navy/10 bg-brand-navy/5 px-4 py-6 text-center text-brand-navy/70">
              No pending referrals currently waiting on invitee validation.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-brand-navy/10">
              <table className="min-w-full divide-y divide-brand-navy/10">
                <thead className="bg-brand-navy/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Referrer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Invitee Email
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Invitee Account
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                      Invited On
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-navy/10 bg-white">
                  {pendingReferrals.map((record) => (
                    <tr key={`${record.id}-pending`}>
                      <td className="px-4 py-3 text-sm text-brand-navy">
                        <div className="font-semibold">{record.referredBy.email}</div>
                        <div className="text-xs text-brand-navy/50">ID · {record.referredBy.id}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-navy">{record.referredEmail}</td>
                      <td className="px-4 py-3 text-sm text-brand-navy">
                        {record.referredUser ? (
                          <>
                            <div>{record.referredUser.email}</div>
                            <div className="text-xs text-brand-navy/50">ID · {record.referredUser.id}</div>
                          </>
                        ) : (
                          <span className="text-brand-navy/50 text-xs italic">User not linked</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-navy">
                        {new Date(record.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-2">📧 SMT Email Confirmations</h2>
          <p className="text-sm text-brand-navy/70 mb-4">
            Customers listed here still need to act on the Smart Meter Texas authorization email. Follow up with pending
            confirmations to keep their entries active. Declined responses automatically disable their SMT entry and flag the
            account for manual review.
          </p>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-brand-navy/10 bg-brand-navy/5 p-4">
              <h3 className="text-lg font-semibold text-brand-navy mb-3">Pending acknowledgements</h3>
              {emailConfirmations.pending.length === 0 ? (
                <div className="rounded-md border border-brand-navy/10 bg-white px-4 py-6 text-center text-brand-navy/70">
                  No outstanding confirmations waiting on customers.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-brand-navy/10 bg-white">
                  <table className="min-w-full divide-y divide-brand-navy/10 text-sm text-brand-navy">
                    <thead className="bg-brand-navy/5">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                          Customer
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                          Requested
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                          Address
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-navy/10">
                      {emailConfirmations.pending.map((record) => {
                        const address = record.houseAddress
                          ? [
                              record.houseAddress.addressLine1,
                              record.houseAddress.addressLine2,
                              `${record.houseAddress.addressCity}, ${record.houseAddress.addressState} ${record.houseAddress.addressZip5}`,
                            ]
                              .filter(Boolean)
                              .join('\n')
                          : '—';
                        return (
                          <tr key={`${record.id}-pending`} className="align-top">
                            <td className="whitespace-nowrap px-4 py-3">
                              <div className="font-semibold">{record.email ?? 'Unknown email'}</div>
                              <div className="text-xs text-brand-navy/50">User ID · {record.userId}</div>
                            </td>
                            <td className="px-4 py-3 text-xs text-brand-navy/70">
                              {new Date(record.createdAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-xs text-brand-navy/80 whitespace-pre-line">{address}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-brand-navy/10 bg-brand-navy/5 p-4">
              <h3 className="text-lg font-semibold text-brand-navy mb-3">Declined or revoked</h3>
              {emailConfirmations.declined.length === 0 ? (
                <div className="rounded-md border border-brand-navy/10 bg-white px-4 py-6 text-center text-brand-navy/70">
                  No recent declines recorded.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-brand-navy/10 bg-white">
                  <table className="min-w-full divide-y divide-brand-navy/10 text-sm text-brand-navy">
                    <thead className="bg-brand-navy/5">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                          Customer
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                          Declined At
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                          Notes
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-navy/10">
                      {emailConfirmations.declined.map((record) => (
                        <tr key={`${record.id}-declined`} className="align-top">
                          <td className="whitespace-nowrap px-4 py-3">
                            <div className="font-semibold">{record.email ?? 'Unknown email'}</div>
                            <div className="text-xs text-brand-navy/50">User ID · {record.userId}</div>
                          </td>
                          <td className="px-4 py-3 text-xs text-brand-navy/70">
                            {record.confirmedAt ? new Date(record.confirmedAt).toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-brand-navy/80 space-y-1">
                            {record.smtStatusMessage ? (
                              <div>{record.smtStatusMessage}</div>
                            ) : (
                              <div className="italic text-brand-navy/50">No SMT status message recorded</div>
                            )}
                            {record.authorizationEndDate ? (
                              <div className="text-brand-navy/60">
                                Authorization end {new Date(record.authorizationEndDate).toLocaleDateString()}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-2">🚨 Houses Awaiting Notification</h2>
          <p className="text-sm text-brand-navy/70 mb-4">
            These users lost SMT access when another account took their service address. Send the replacement email and help them reconnect.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">User Email</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">ESIID</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Flagged</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Archived homes</th>
                </tr>
              </thead>
              <tbody>
                {flaggedReplacements.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-brand-navy/60">
                      No displaced homes waiting for outreach.
                    </td>
                  </tr>
                ) : (
                  flaggedReplacements.map((record) => (
                    <tr key={`${record.userId}-${record.esiid ?? 'no-esiid'}`} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                      <td className="py-3 px-4 text-brand-navy">{record.email ?? 'Unknown'}</td>
                      <td className="py-3 px-4 text-brand-navy">{record.esiid ?? '—'}</td>
                      <td className="py-3 px-4 text-brand-navy">{formatTimestamp(record.attentionAt)}</td>
                      <td className="py-3 px-4 text-brand-navy">
                        {record.houses.length === 0 ? (
                          <span className="text-brand-navy/60 text-xs">No archived homes on record</span>
                        ) : (
                          <ul className="space-y-2">
                            {record.houses.map((house) => {
                              const line1 = house.addressLine1;
                              const line2 = house.addressLine2 ? `${house.addressLine2}\n` : '';
                              const cityStateZip = `${house.addressCity}, ${house.addressState} ${house.addressZip5}`;
                              return (
                                <li key={house.id} className="border border-brand-navy/10 rounded-md p-2 bg-brand-navy/5">
                                  <div className="font-semibold whitespace-pre-line">
                                    {`${line1}\n${line2}${cityStateZip}`}
                                  </div>
                                  <div className="text-xs text-brand-navy/70 mt-1">
                                    SMT archived: {formatTimestamp(house.archivedAt)}
                                  </div>
                                  {house.esiid ? (
                                    <div className="text-xs text-brand-navy/70">ESIID: {house.esiid}</div>
                                  ) : null}
                                  {house.utilityName ? (
                                    <div className="text-xs text-brand-navy/70">Utility: {house.utilityName}</div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-2">🛑 SMT Revocations Awaiting Manual Disconnect</h2>
          <p className="text-sm text-brand-navy/70 mb-4">
            Customers who revoked SMT access are queued here so operations can finish the manual disconnect inside Smart
            Meter Texas. Once the revocation is processed, clear the flag on their profile.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">User Email</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">ESIID</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Revocation Logged</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Archived Authorizations</th>
                </tr>
              </thead>
              <tbody>
                {flaggedRevocations.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-brand-navy/60">
                      No customer-requested SMT revocations awaiting action.
                    </td>
                  </tr>
                ) : (
                  flaggedRevocations.map((record) => (
                    <tr key={`${record.userId}-revocation`} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                      <td className="py-3 px-4 text-brand-navy">{record.email ?? 'Unknown'}</td>
                      <td className="py-3 px-4 text-brand-navy">{record.esiid ?? '—'}</td>
                      <td className="py-3 px-4 text-brand-navy">{formatTimestamp(record.attentionAt)}</td>
                      <td className="py-3 px-4 text-brand-navy">
                        {record.authorizations.length === 0 ? (
                          <span className="text-brand-navy/60 text-xs">Awaiting archival details.</span>
                        ) : (
                          <ul className="space-y-2">
                            {record.authorizations.map((auth) => {
                              const addressLine = auth.houseAddress
                                ? [
                                    auth.houseAddress.addressLine1 ?? '',
                                    auth.houseAddress.addressLine2 ?? '',
                                    `${auth.houseAddress.addressCity ?? ''}, ${auth.houseAddress.addressState ?? ''} ${
                                      auth.houseAddress.addressZip5 ?? ''
                                    }`,
                                  ]
                                    .filter((part) => part && part.trim().length > 0)
                                    .join('\n')
                                : null;
                              return (
                                <li key={auth.id} className="border border-brand-navy/10 rounded-md p-3 bg-brand-navy/5 whitespace-pre-line">
                                  {addressLine ? <div className="font-semibold">{addressLine}</div> : null}
                                  <div className="text-xs text-brand-navy/70 mt-1">
                                    SMT archived: {formatTimestamp(auth.archivedAt)}
                                  </div>
                                  <div className="text-xs text-brand-navy/70">
                                    Meter: {auth.meterNumber ?? '—'} · Authorization end: {formatTimestamp(auth.authorizationEndDate)}
                                  </div>
                                  {auth.smtStatusMessage ? (
                                    <div className="text-xs text-brand-navy/60 mt-1">{auth.smtStatusMessage}</div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-2">⏳ SMT Emails Awaiting Confirmation</h2>
          <p className="text-sm text-brand-navy/70 mb-4">
            These customers submitted the Smart Meter Texas authorization form but have not yet confirmed the follow-up
            email. We flagged their accounts as not approved so the ops team can monitor progress and nudge them when
            needed. Once they approve, the flag clears automatically and their referrers become eligible for entries.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">User Email</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Flagged</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Homes on File</th>
                </tr>
              </thead>
              <tbody>
                {flaggedEmailPending.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 px-4 text-center text-brand-navy/60">
                      No SMT confirmations waiting on customer approval.
                    </td>
                  </tr>
                ) : (
                  flaggedEmailPending.map((record) => (
                    <tr
                      key={`${record.userId}-pending`}
                      className="border-b border-brand-navy/10 hover:bg-brand-navy/5"
                    >
                      <td className="py-3 px-4 text-brand-navy">{record.email ?? 'Unknown'}</td>
                      <td className="py-3 px-4 text-brand-navy">{formatTimestamp(record.attentionAt)}</td>
                      <td className="py-3 px-4 text-brand-navy">
                        {record.houses.length === 0 ? (
                          <span className="text-brand-navy/60 text-xs">No active homes on file.</span>
                        ) : (
                          <ul className="space-y-2">
                            {record.houses.map((house) => {
                              const line2 = house.addressLine2 ? `${house.addressLine2}\n` : '';
                              const addressBlock = `${house.addressLine1}\n${line2}${house.addressCity}, ${house.addressState} ${house.addressZip5}`;
                              return (
                                <li
                                  key={house.id}
                                  className="border border-brand-navy/10 rounded-md p-3 bg-brand-navy/5 whitespace-pre-line"
                                >
                                  <div className="font-semibold">{addressBlock}</div>
                                  {house.esiid ? (
                                    <div className="text-xs text-brand-navy/70 mt-1">ESIID: {house.esiid}</div>
                                  ) : null}
                                  {house.utilityName ? (
                                    <div className="text-xs text-brand-navy/70 mt-1">Utility: {house.utilityName}</div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-2">⚠️ SMT Emails Declined</h2>
          <p className="text-sm text-brand-navy/70 mb-4">
            These customers reported that they declined or revoked the Smart Meter Texas authorization email.
            Their smart meter entries are disabled until they re-authorize and confirm the follow-up email. Track
            outreach here so we can reactivate them quickly once they approve.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">User Email</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Flagged</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Homes on File</th>
                </tr>
              </thead>
              <tbody>
                {flaggedEmailDeclined.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 px-4 text-center text-brand-navy/60">
                      No SMT declines waiting on follow-up.
                    </td>
                  </tr>
                ) : (
                  flaggedEmailDeclined.map((record) => (
                    <tr key={`${record.userId}-declined`} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                      <td className="py-3 px-4 text-brand-navy">{record.email ?? 'Unknown'}</td>
                      <td className="py-3 px-4 text-brand-navy">{formatTimestamp(record.attentionAt)}</td>
                      <td className="py-3 px-4 text-brand-navy">
                        {record.houses.length === 0 ? (
                          <span className="text-brand-navy/60 text-xs">No active homes on file.</span>
                        ) : (
                          <ul className="space-y-2">
                            {record.houses.map((house) => {
                              const line2 = house.addressLine2 ? `${house.addressLine2}\n` : '';
                              const addressBlock = `${house.addressLine1}\n${line2}${house.addressCity}, ${house.addressState} ${house.addressZip5}`;
                              return (
                                <li key={house.id} className="border border-brand-navy/10 rounded-md p-3 bg-brand-navy/5 whitespace-pre-line">
                                  <div className="font-semibold">{addressBlock}</div>
                                  {house.esiid ? (
                                    <div className="text-xs text-brand-navy/70 mt-1">ESIID: {house.esiid}</div>
                                  ) : null}
                                  {house.utilityName ? (
                                    <div className="text-xs text-brand-navy/70 mt-1">Utility: {house.utilityName}</div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Users Section */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">📋 Users</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Email</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Joined</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Entries</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Referrals</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">House IDs</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 px-4 text-center text-brand-navy/60">
                      No users found
                    </td>
                  </tr>
                ) : (
                  users.map((user) => {
                    const totalEntries =
                      user.entries?.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
                    const totalReferrals = user.referrals?.length ?? 0;

                    return (
                      <tr
                        key={user.id}
                        className="border-b border-brand-navy/10 hover:bg-brand-navy/5"
                      >
                        <td className="py-3 px-4 text-brand-navy">{user.email}</td>
                        <td className="py-3 px-4 text-brand-navy">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-brand-navy">{totalEntries}</td>
                        <td className="py-3 px-4 text-brand-navy">{totalReferrals}</td>
                        <td className="py-3 px-4 text-brand-navy font-mono text-xs">
                          {user.houseAddresses && user.houseAddresses.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {user.houseAddresses.map((house) => (
                                <span key={house.id}>
                                  {house.id}
                                  {house.archivedAt ? ' (archived)' : ''}
                                </span>
                              ))}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Commissions Section */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">💰 Commissions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">User</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Type</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {commissions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-brand-navy/60">
                      No commissions found
                    </td>
                  </tr>
                ) : (
                  commissions.map(c => (
                    <tr key={c.id} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                      <td className="py-3 px-4 text-brand-navy">{c.user?.email || 'Unknown'}</td>
                      <td className="py-3 px-4 text-brand-navy">{c.type}</td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">${c.amount.toFixed(2)}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          c.status === 'paid' ? 'bg-green-100 text-green-800' :
                          c.status === 'approved' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Jackpot Section */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">🎰 Jackpot Payouts</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">User</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {jackpotPayouts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 px-4 text-center text-brand-navy/60">
                      No jackpot payouts found
                    </td>
                  </tr>
                ) : (
                  jackpotPayouts.map(j => (
                    <tr key={j.id} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                      <td className="py-3 px-4 text-brand-navy">{j.user?.email || 'Unknown'}</td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">${j.amount.toFixed(2)}</td>
                      <td className="py-3 px-4">
                        {j.paid ? (
                          <span className="text-green-600">✅ Paid</span>
                        ) : (
                          <span className="text-red-600">❌ Pending</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Finance Section */}
        <section className="bg-brand-white rounded-lg p-6 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">📊 Finance Records</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Type</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Source</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {financeRecords.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-brand-navy/60">
                      No finance records found
                    </td>
                  </tr>
                ) : (
                  financeRecords.map(f => (
                    <tr key={f.id} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        f.type === 'income' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {f.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-brand-navy">{f.source}</td>
                    <td className="py-3 px-4 text-brand-navy font-semibold">${f.amount.toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        f.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {f.status}
                      </span>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
} 