'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CopyInline } from '@/app/components/ui/CopyInline';

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

interface UserInsightRow {
  userId: string;
  email: string;
  joinedAt: string;
  hasSmt: boolean;
  hasUsage: boolean;
  switchedWithUs: boolean;
  contractEndDate: string | null;
  monthlySavingsNoEtf: number | null;
  monthlySavingsBasis?: "TO_CONTRACT_END" | "NEXT_12_MONTHS" | null;
  monthlySavingsBasisMonths?: number | null;
  savingsUntilContractEndNetEtf: number | null;
  savingsNext12MonthsNetEtf: number | null;
  referralsTotal?: number;
  referralsPending?: number;
  referralsQualified?: number;
  applianceCount?: number;
  homeDetailsEntryStatus?: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | null;
  applianceDetailsEntryStatus?: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | null;
  testimonialEntryStatus?: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | null;
  entriesEligibleTotal?: number;
  entriesExpiredTotal?: number;
  commissionLifetimeEarnedDollars?: number;
  commissionPendingDollars?: number;
  houseAddressId: string | null;
}

interface UserInsightsResponse {
  ok: true;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rows: UserInsightRow[];
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
  eflQuarantineOpenCount: number;
  currentPlanEflQuarantineOpenCount?: number;
  currentPlanBillQuarantineOpenCount?: number;
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

const entryBadgeClass = (status: string | null | undefined) => {
  if (!status) return 'border-slate-200 bg-white text-slate-500';
  const s = String(status).toUpperCase();
  if (s === 'ACTIVE') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (s === 'EXPIRING_SOON') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
};

const entryBadgeLabel = (status: string | null | undefined) => {
  if (!status) return '—';
  const s = String(status).toUpperCase();
  if (s === 'ACTIVE') return 'Active';
  if (s === 'EXPIRING_SOON') return 'Expiring';
  return 'Expired';
};

export default function AdminDashboard() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adminEmail, setAdminEmail] = useState('admin@intelliwatt.com');
  
  // Real data state
  const [users, setUsers] = useState<User[]>([]);
  const [userInsights, setUserInsights] = useState<UserInsightsResponse | null>(null);
  const [userInsightsPage, setUserInsightsPage] = useState<number>(1);
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
  const [runningJackpotDraw, setRunningJackpotDraw] = useState(false);
  const [jackpotDrawResult, setJackpotDrawResult] = useState<any | null>(null);
  const [jackpotDrawError, setJackpotDrawError] = useState<string | null>(null);
  const [previewPlansShare, setPreviewPlansShare] = useState<{ url: string | null; token: string | null }>({
    url: null,
    token: null,
  });
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

  const fetchUserInsightsPage = useCallback(
    async (page: number) => {
      try {
        const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
        const res = await fetchWithAdmin(
          `/api/admin/users/insights?page=${encodeURIComponent(String(safePage))}&pageSize=20&sort=savingsToEndNet&dir=desc`,
          { cache: 'no-store' },
        );
        const json = await res.json().catch(() => null);
        if (res.ok && json?.ok === true) {
          setUserInsights(json as UserInsightsResponse);
        }
      } catch {
        // ignore; best-effort
      }
    },
    [fetchWithAdmin],
  );

  const fetchPreviewPlansShare = useCallback(async () => {
    try {
      const res = await fetchWithAdmin('/api/admin/preview/plans-token');
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      if (!json || json.ok !== true) return;
      setPreviewPlansShare({
        url: typeof json.url === 'string' ? json.url : null,
        token: typeof json.token === 'string' ? json.token : null,
      });
    } catch {
      // ignore
    }
  }, [fetchWithAdmin]);

  useEffect(() => {
    // Carousel/slider paging for the lightweight dashboard view (20 users per page).
    if (!mounted) return;
    // Page 1 is loaded as part of the main dashboard fetch.
    if (userInsightsPage <= 1) return;
    fetchUserInsightsPage(userInsightsPage);
  }, [mounted, userInsightsPage, fetchUserInsightsPage]);

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
        fetchWithAdmin('/api/admin/users/insights?page=1&pageSize=20&sort=savingsToEndNet&dir=desc'),
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
        console.log('Fetched user insights:', usersData);
        setUserInsights(usersData?.ok === true ? (usersData as UserInsightsResponse) : null);
        setUserInsightsPage(1);
        // Keep legacy `users` empty; summary stats provide total user counts.
        setUsers([]);
      } else {
        console.error('Failed to fetch users:', usersRes.status, usersRes.statusText);
      }

      if (commissionsRes.ok) {
        const commissionsData = await commissionsRes.json();
        console.log('Fetched commissions data:', commissionsData);
        if (commissionsData && commissionsData.ok === true && Array.isArray(commissionsData.rows)) {
          setCommissions(
            commissionsData.rows.map((r: any) => ({
              id: r.id,
              userId: r.userId,
              type: r.type,
              amount: typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : 0,
              status: r.status,
              user: r.userEmail ? { id: r.userId, email: r.userEmail, createdAt: r.createdAt ?? new Date().toISOString() } : undefined,
            })),
          );
        } else {
          // Backwards-compat (older payloads returned an array)
          setCommissions(commissionsData);
        }
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

  const handleRunJackpotDraw = useCallback(async () => {
    try {
      setRunningJackpotDraw(true);
      setJackpotDrawError(null);
      setJackpotDrawResult(null);

      const response = await fetchWithAdmin('/api/admin/jackpot/draw', { method: 'POST' });
      const { raw, json } = await readResponseBody(response);
      if (!response.ok || !json || json.ok !== true) {
        const msg = json?.error || `HTTP ${response.status}`;
        setJackpotDrawError(msg);
        console.error('Jackpot draw failed:', response.status, raw);
        return;
      }
      setJackpotDrawResult(json);
    } catch (error: any) {
      setJackpotDrawError(error?.message || String(error));
    } finally {
      setRunningJackpotDraw(false);
      fetchData();
    }
  }, [fetchData, fetchWithAdmin, readResponseBody]);

  useEffect(() => {
    setMounted(true);
    document.title = 'Admin Dashboard - IntelliWatt™';

    fetchData();
    fetchPreviewPlansShare();
  }, [fetchData, fetchPreviewPlansShare]);

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
  const eflQuarantineOpenCount = summary?.eflQuarantineOpenCount ?? 0;
  const currentPlanEflQuarantineOpenCount = summary?.currentPlanEflQuarantineOpenCount ?? 0;
  const currentPlanBillQuarantineOpenCount = summary?.currentPlanBillQuarantineOpenCount ?? 0;
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

  const overviewStats: Array<{
    label: string;
    value: string;
    href?: string;
    tone?: 'default' | 'danger';
  }> = [
    { label: 'Users', value: totalUsersCount.toLocaleString(), href: '/admin/users' },
    { label: "SMT API's", value: smtApiCount.toLocaleString(), href: '/admin/smt' },
    // Closest existing destination for manual/usage tooling.
    { label: 'Manual Entries', value: manualEntriesCount.toLocaleString(), href: '/admin/usage' },
    { label: 'Total Usage Customers', value: totalUsageCustomers.toLocaleString(), href: '/admin/users' },
    {
      label: 'EFL Quarantine (Open)',
      value: eflQuarantineOpenCount.toLocaleString(),
      href: '/admin/efl/fact-cards',
      tone: eflQuarantineOpenCount > 0 ? 'danger' : 'default',
    },
    {
      label: 'Current Plan EFL Quarantine (Open)',
      value: currentPlanEflQuarantineOpenCount.toLocaleString(),
      href: '/admin/efl-review?source=current_plan_efl',
      tone: currentPlanEflQuarantineOpenCount > 0 ? 'danger' : 'default',
    },
    {
      label: 'Current Plan Bill Parse Queue (Open)',
      value: currentPlanBillQuarantineOpenCount.toLocaleString(),
      href: '/admin/current-plan/bill-parser#queue',
      tone: currentPlanBillQuarantineOpenCount > 0 ? 'danger' : 'default',
    },
    { label: 'Appliances #', value: applianceCount.toLocaleString() },
    { label: 'Testimonials', value: testimonialsTotal.toLocaleString(), href: '#testimonials' },
    { label: 'Testimonials Pending', value: testimonialsPendingCount.toLocaleString(), href: '#testimonials' },
    { label: 'Referrals Pending', value: referralPendingTotal.toLocaleString(), href: '#referrals' },
    { label: 'Referrals Qualified', value: referralQualifiedTotal.toLocaleString(), href: '#referrals' },
    { label: 'SMT Email Confirmations Pending', value: pendingEmailConfirmationsCount.toLocaleString(), href: '#smt-email-confirmations' },
    { label: 'SMT Email Confirmations Declined', value: declinedEmailConfirmationsCount.toLocaleString(), href: '#smt-email-confirmations' },
    { label: 'SMT Email Confirmations Approved', value: approvedEmailConfirmationsCount.toLocaleString(), href: '#smt-email-confirmations' },
    { label: 'SMT Email Follow-ups Flagged', value: flaggedEmailPending.length.toLocaleString(), href: '#smt-followups' },
    { label: 'SMT Revocations Pending', value: pendingRevocationsCount.toLocaleString(), href: '#smt-revocations' },
    { label: 'Total Commissions', value: currencyFormatter.format(totalCommissions), href: '#commissions' },
    { label: 'Net Finance', value: currencyFormatter.format(totalFinance), href: '#finance' },
    { label: 'Pending Jackpot Payouts', value: pendingJackpot.toLocaleString(), href: '#jackpot' },
    { label: 'Homes flagged for SMT replacement email', value: flaggedReplacements.length.toLocaleString(), href: '#smt-replacements' },
    { label: 'Entries expiring within 30 days', value: expiringSoonCount.toLocaleString(), href: '#entry-expiration' },
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
                    className="w-40 bg-transparent text-xs font-semibold uppercase tracking-wide text-brand-navy placeholder:text-brand-navy/60 focus:outline-none"
                  />
                  {adminToken ? (
                    <button
                      type="button"
                      onClick={() => setAdminToken('')}
                      className="text-xs font-semibold uppercase tracking-wide text-brand-navy/70 transition hover:text-brand-navy"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              <button
                type="button"
                onClick={handleRecalculateEntries}
                disabled={recalculatingEntries || refreshing || recalculatingReferrals}
                className="inline-flex items-center gap-2 rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:bg-brand-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {recalculatingEntries ? 'Resyncing entries…' : 'Re-sync entries'}
              </button>
              <button
                type="button"
                onClick={handleRecalculateReferrals}
                disabled={recalculatingReferrals || refreshing || recalculatingEntries}
                className="inline-flex items-center gap-2 rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:bg-brand-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {recalculatingReferrals ? 'Replaying referrals…' : 'Re-run referral sync'}
              </button>
              <button
                type="button"
                onClick={fetchData}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:bg-brand-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
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
          {overviewStats.map((stat) => {
            const className =
              (stat.href ? 'block ' : '') +
              (stat.tone === 'danger'
                ? 'bg-rose-50 border border-rose-200 rounded-lg p-6 shadow-lg hover:bg-rose-100 transition-colors'
                : 'bg-brand-white rounded-lg p-6 shadow-lg');
            return stat.href ? (
              <a key={stat.label} href={stat.href} className={className}>
                <div className="text-2xl font-bold text-brand-navy">{stat.value}</div>
                <div className="text-brand-navy/60">{stat.label}</div>
              </a>
            ) : (
              <div key={stat.label} className={className}>
                <div className="text-2xl font-bold text-brand-navy">{stat.value}</div>
                <div className="text-brand-navy/60">{stat.label}</div>
              </div>
            );
          })}
        </div>

        {/* Quick Links / Tools Section */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">🔧 Admin Tools</h2>

          {/* WattBuy preview share link (token-gated public page) */}
          <div className="mb-6 rounded-lg border border-brand-blue/20 bg-brand-blue/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-semibold text-brand-navy">WattBuy plan cards preview link</div>
                <div className="mt-1 text-sm text-brand-navy/70">
                  Public, token-gated, static snapshot page for sharing plan card presentation (no dashboard access).
                </div>
              </div>
              {previewPlansShare.url ? (
                <div className="flex flex-wrap items-center gap-2">
                  <CopyInline value={previewPlansShare.url} label="Copy link" />
                  {previewPlansShare.token ? <CopyInline value={previewPlansShare.token} label="Copy token" /> : null}
                </div>
              ) : (
                <div className="text-xs text-brand-navy/60">
                  Set <span className="font-mono">PREVIEW_PLANS_TOKEN</span> in Vercel env vars to enable.
                </div>
              )}
            </div>

            {previewPlansShare.url ? (
              <div className="mt-3 rounded-lg border border-brand-blue/15 bg-brand-white p-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">Share URL</div>
                <div className="mt-1 break-all font-mono text-[12px] text-brand-navy">{previewPlansShare.url}</div>
                {previewPlansShare.token ? (
                  <>
                    <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-brand-navy/60">Token</div>
                    <div className="mt-1 break-all font-mono text-[12px] text-brand-navy">{previewPlansShare.token}</div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <a
              href="/admin/efl/fact-cards"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🧾 Fact Card Parsing Ops</div>
              <div className="text-sm text-brand-navy/60">
                Unified page: batch parse, review queue, templates, and manual loader (URL/upload/text)
              </div>
            </a>
            <a
              href="/admin/efl-review?source=current_plan_efl"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🧾 Current Plan EFL Quarantine</div>
              <div className="text-sm text-brand-navy/60">
                Review & resolve customer-uploaded current-plan EFLs that didn’t parse cleanly (feeds parser improvements)
              </div>
            </a>
            <a
              href="/admin/tools/hitthejackwatt-ads"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🎯 HitTheJackWatt Social Ads</div>
              <div className="text-sm text-brand-navy/60">
                Download SVG creatives and copy suggested captions for the jackpot campaign
              </div>
            </a>
            <a
              href="/admin/tools/prisma-studio"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🛠️ Prisma Studio Shortcuts</div>
              <div className="text-sm text-brand-navy/60">
                Copy PowerShell blocks to open Prisma Studio on specific databases/ports (no creds stored here)
              </div>
            </a>
            <a
              href="/admin/plan-engine"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🧪 Plan Engine Lab</div>
              <div className="text-sm text-brand-navy/60">
                Run estimate-set (TOU / Free Weekends bucket-gated) with optional backfill.
              </div>
            </a>
            <a
              href="/admin/tools/bot-messages"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🤖 IntelliWattBot Messages</div>
              <div className="text-sm text-brand-navy/60">
                Edit the IntelliWattBot speech bubble copy per dashboard page (updates live after saving)
              </div>
            </a>
            <a
              href="/admin/helpdesk/impersonate"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">Help desk: access user dashboard</div>
              <div className="text-sm text-brand-navy/60">
                Enter a user email to temporarily impersonate their dashboard session (audited, time-bounded).
              </div>
            </a>
            <a
              href="/admin/wattbuy/inspector"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🔍 WattBuy Inspector</div>
              <div className="text-sm text-brand-navy/60">Test electricity, retail rates, and offers endpoints with real-time metadata</div>
            </a>
            <a
              href="/admin/wattbuy/templates"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📦 Templated Plans</div>
              <div className="text-sm text-brand-navy/60">
                View RatePlans that already have cached rateStructure (fast-path) and sort for best deals
              </div>
            </a>
            <a
              href="/plans"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🔎 Public Plans Search</div>
              <div className="text-sm text-brand-navy/60">
                Open the customer-facing plans search page (ESIID/address-based)
              </div>
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
              href="/admin/efl-review"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📝 EFL Manual Review Queue</div>
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
        <section id="entry-expiration" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
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
        <section id="testimonials" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
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
        <section id="referrals" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
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

        <section id="smt-email-confirmations" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
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

        <section id="smt-replacements" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
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

        <section id="smt-revocations" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
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

        <section id="smt-followups" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
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
        <section id="users-section" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">📋 Users</h2>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-brand-navy/70">
              Showing 20 users per page. Use the slider to page through, or open the full Users view.
            </div>
            <div className="flex gap-2">
              <a
                href="/admin/users"
                className="inline-flex items-center gap-2 rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20"
              >
                Open full Users UI
              </a>
              <a
                href="/admin/helpdesk/impersonate"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Help desk
              </a>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-brand-navy/10 bg-brand-navy/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                Page {userInsightsPage} / {userInsights?.totalPages ?? 1}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUserInsightsPage((p) => Math.max(1, p - 1))}
                  disabled={userInsightsPage <= 1}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  Prev
                </button>
                <input
                  type="range"
                  min={1}
                  max={Math.max(1, userInsights?.totalPages ?? 1)}
                  value={Math.min(Math.max(1, userInsightsPage), Math.max(1, userInsights?.totalPages ?? 1))}
                  onChange={(e) => setUserInsightsPage(Number(e.target.value))}
                  className="w-56"
                />
                <button
                  type="button"
                  onClick={() => setUserInsightsPage((p) => Math.min(userInsights?.totalPages ?? 1, p + 1))}
                  disabled={userInsightsPage >= (userInsights?.totalPages ?? 1)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Email</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Contract end</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Monthly (no ETF)</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Savings to end (net ETF)</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Savings 12 mo (net ETF)</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Usage</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">SMT</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Switched</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Referrals</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Home</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Appliances</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Testimonial</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Entries</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Commission $</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Pending $</th>
                </tr>
              </thead>
              <tbody>
                {userInsights?.rows?.length ? (
                  userInsights.rows.map((row) => (
                    <tr
                      key={row.userId}
                      className="border-b border-brand-navy/10 hover:bg-brand-navy/5"
                    >
                      <td className="py-3 px-4 text-brand-navy">
                        <a
                          className="font-semibold hover:underline"
                          href={`/admin/helpdesk/impersonate?email=${encodeURIComponent(row.email)}`}
                        >
                          {row.email}
                        </a>
                        <div className="mt-1 text-[11px] text-brand-navy/60">
                          Joined {new Date(row.joinedAt).toLocaleDateString()}
                          {row.houseAddressId ? ` · House ${row.houseAddressId}` : ""}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-brand-navy">
                        {row.contractEndDate ? new Date(row.contractEndDate).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">
                        {typeof row.monthlySavingsNoEtf === "number" && Number.isFinite(row.monthlySavingsNoEtf)
                          ? `${currencyFormatter.format(row.monthlySavingsNoEtf)}/mo`
                          : "—"}
                      </td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">
                        {typeof row.savingsUntilContractEndNetEtf === "number" && Number.isFinite(row.savingsUntilContractEndNetEtf)
                          ? currencyFormatter.format(row.savingsUntilContractEndNetEtf)
                          : "—"}
                      </td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">
                        {typeof row.savingsNext12MonthsNetEtf === "number" && Number.isFinite(row.savingsNext12MonthsNetEtf)
                          ? currencyFormatter.format(row.savingsNext12MonthsNetEtf)
                          : "—"}
                      </td>
                      <td className="py-3 px-4">{row.hasUsage ? <span className="text-emerald-700">Yes</span> : <span className="text-slate-500">No</span>}</td>
                      <td className="py-3 px-4">{row.hasSmt ? <span className="text-emerald-700">Yes</span> : <span className="text-slate-500">No</span>}</td>
                      <td className="py-3 px-4">{row.switchedWithUs ? <span className="text-emerald-700">Yes</span> : <span className="text-slate-500">No</span>}</td>
                      <td className="py-3 px-4 text-brand-navy">
                        <span className="font-semibold">{row.referralsTotal ?? 0}</span>
                        <div className="text-[11px] text-brand-navy/60">
                          {`${row.referralsPending ?? 0} pending · ${row.referralsQualified ?? 0} qualified`}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${entryBadgeClass(row.homeDetailsEntryStatus ?? null)}`}>
                          {entryBadgeLabel(row.homeDetailsEntryStatus ?? null)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${entryBadgeClass(row.applianceDetailsEntryStatus ?? null)}`}>
                            {entryBadgeLabel(row.applianceDetailsEntryStatus ?? null)}
                          </span>
                          <span className="text-[11px] text-brand-navy/60">{row.applianceCount ?? 0} item(s)</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${entryBadgeClass(row.testimonialEntryStatus ?? null)}`}>
                          {entryBadgeLabel(row.testimonialEntryStatus ?? null)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">
                        <a
                          className="hover:underline"
                          href={`/admin/jackpot/entries?q=${encodeURIComponent(row.email)}`}
                          title="Open Jackpot Entries inspection"
                        >
                          {String(row.entriesEligibleTotal ?? 0)}
                        </a>
                        <div className="text-[11px] text-brand-navy/60">
                          {row.entriesExpiredTotal ? `${row.entriesExpiredTotal} expired` : ""}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">
                        {typeof row.commissionLifetimeEarnedDollars === "number" && Number.isFinite(row.commissionLifetimeEarnedDollars)
                          ? currencyFormatter.format(row.commissionLifetimeEarnedDollars)
                          : "—"}
                      </td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">
                        <a
                          className="hover:underline"
                          href={`/admin/commissions?q=${encodeURIComponent(row.email)}&status=pending`}
                          title="Open Commissions tracking"
                        >
                          {typeof row.commissionPendingDollars === "number" && Number.isFinite(row.commissionPendingDollars)
                            ? currencyFormatter.format(row.commissionPendingDollars)
                            : "—"}
                        </a>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={15} className="py-8 px-4 text-center text-brand-navy/60">
                      No users found (or snapshots still computing).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Commissions Section */}
        <section id="commissions" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
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
                          c.status === 'approved' ? 'bg-blue-100 text-brand-navy' :
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
        <section id="jackpot" className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">🎰 Jackpot Payouts</h2>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-brand-navy/70">
              Run the monthly draw using the current eligible entries pool (after a status refresh).
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="/admin/jackpot/entries"
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Inspect entries
              </a>
              <button
                type="button"
                onClick={handleRunJackpotDraw}
                disabled={runningJackpotDraw || refreshing || recalculatingEntries || recalculatingReferrals}
                className="inline-flex items-center rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
              >
                {runningJackpotDraw ? 'Running drawing…' : 'Run drawing'}
              </button>
            </div>
          </div>

          {jackpotDrawError ? (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {jackpotDrawError}
            </div>
          ) : null}
          {jackpotDrawResult?.ok === true ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <div className="font-semibold">
                Winner: {jackpotDrawResult?.winner?.email ?? jackpotDrawResult?.winner?.userId}
              </div>
              <div className="text-emerald-900/80">
                Pool: {Number(jackpotDrawResult?.pool?.totalTickets ?? 0).toLocaleString()} tickets across{' '}
                {Number(jackpotDrawResult?.pool?.eligibleUsers ?? 0).toLocaleString()} users · Payout:{' '}
                {currencyFormatter.format(Number(jackpotDrawResult?.payout?.amount ?? 0))}
              </div>
            </div>
          ) : null}
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
        <section id="finance" className="bg-brand-white rounded-lg p-6 shadow-lg">
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