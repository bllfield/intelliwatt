'use client';

import { useEffect, useMemo, useState } from 'react';

import DashboardHero from '@/components/dashboard/DashboardHero';
import LocalTime from '@/components/LocalTime';

type UsageSeriesPoint = {
  timestamp: string;
  kwh: number;
};

type UsageDatasetSummary = {
  source: 'SMT' | 'GREEN_BUTTON';
  intervalsCount: number;
  totalKwh: number;
  start: string | null;
  end: string | null;
  latest: string | null;
};

type UsageDataset = {
  summary: UsageDatasetSummary;
  series: {
    intervals15: UsageSeriesPoint[];
    hourly: UsageSeriesPoint[];
    daily: UsageSeriesPoint[];
    monthly: UsageSeriesPoint[];
    annual: UsageSeriesPoint[];
  };
};

type HouseUsage = {
  houseId: string;
  label: string | null;
  address: {
    line1: string;
    city: string | null;
    state: string | null;
  };
  esiid: string | null;
  dataset: UsageDataset | null;
  alternatives: {
    smt: UsageDatasetSummary | null;
    greenButton: UsageDatasetSummary | null;
  };
};

type UsageApiResponse =
  | { ok: true; houses: HouseUsage[] }
  | { ok: false; error: string };

const numberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const kwhFormatter = (value: number) => `${numberFormatter.format(value)} kWh`;

function formatLabel(dateIso: string | null, options: Intl.DateTimeFormatOptions): string {
  if (!dateIso) return '—';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function PeakTable({ series }: { series: UsageSeriesPoint[] }) {
  const rows = useMemo(() => {
    return [...series]
      .sort((a, b) => b.kwh - a.kwh)
      .slice(0, 8);
  }, [series]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-brand-cyan/70">
        We haven’t ingested peak-hour data for this home yet. Upload usage or reconnect SMT to populate trends.
      </p>
    );
  }

  return (
    <div className="overflow-auto rounded-2xl border border-brand-cyan/15 bg-brand-navy/30">
      <table className="min-w-full divide-y divide-brand-cyan/20 text-sm text-brand-cyan">
        <thead className="bg-brand-navy/50 text-xs uppercase tracking-wide text-brand-cyan/70">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">Interval start</th>
            <th className="px-4 py-3 text-left font-semibold">Usage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-cyan/10">
          {rows.map((row) => (
            <tr key={row.timestamp}>
              <td className="px-4 py-3">
                <LocalTime value={row.timestamp} options={{ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }} />
              </td>
              <td className="px-4 py-3">{kwhFormatter(row.kwh)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyTable({ series }: { series: UsageSeriesPoint[] }) {
  const rows = useMemo(() => series.slice(-14), [series]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-brand-cyan/70">
        Daily totals will appear once IntelliWatt ingests a full day of usage data for this home.
      </p>
    );
  }

  return (
    <div className="overflow-auto rounded-2xl border border-brand-cyan/15 bg-brand-navy/30">
      <table className="min-w-full divide-y divide-brand-cyan/20 text-sm text-brand-cyan">
        <thead className="bg-brand-navy/50 text-xs uppercase tracking-wide text-brand-cyan/70">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">Day</th>
            <th className="px-4 py-3 text-left font-semibold">Usage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-cyan/10">
          {rows.map((row) => (
            <tr key={row.timestamp}>
              <td className="px-4 py-3">
                <LocalTime value={row.timestamp} options={{ month: 'short', day: 'numeric', year: 'numeric' }} />
              </td>
              <td className="px-4 py-3">{kwhFormatter(row.kwh)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageDatasetSection({ house }: { house: HouseUsage }) {
  const dataset = house.dataset;

  if (!dataset) {
    return (
      <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/60 p-6 text-brand-cyan shadow-[0_30px_60px_rgba(10,20,60,0.45)]">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-brand-cyan">{house.label ?? 'Home usage'}</h2>
          <p className="text-sm text-brand-cyan/80">
            We haven’t detected any usage data for this home yet. Connect Smart Meter Texas or upload a Green Button file to unlock daily and hourly insights.
          </p>
          <div className="rounded-2xl border border-brand-cyan/25 bg-brand-navy/80 px-4 py-3 text-xs text-brand-cyan/70">
            Referrals remain available without usage data. Connect SMT or upload usage to activate Current Plan, Home Details, Appliances, and Testimonial entries.
          </div>
        </div>
      </section>
    );
  }

  const { summary, series } = dataset;
  const sourceLabel = summary.source === 'SMT' ? 'Smart Meter Texas' : 'Green Button';
  const coverageText =
    summary.start && summary.end
      ? `${formatLabel(summary.start, { month: 'short', day: 'numeric', year: 'numeric' })} – ${formatLabel(summary.end, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'Coverage pending';

  const altSource =
    summary.source === 'SMT' ? house.alternatives.greenButton : house.alternatives.smt;

  return (
    <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/80 p-6 text-brand-cyan shadow-[0_30px_60px_rgba(10,20,60,0.45)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-brand-cyan">{house.label ?? 'Home usage'}</h2>
          <p className="text-sm text-brand-cyan/70">
            Data source:&nbsp;
            <span className="font-semibold text-brand-white">{sourceLabel}</span>
          </p>
          <p className="mt-1 text-sm text-brand-cyan/70">Coverage: {coverageText}</p>
          <div className="mt-4 grid gap-3 text-sm text-brand-white/90 sm:grid-cols-2">
            <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy/60 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.3em] text-brand-cyan/50">Intervals</p>
              <p className="mt-2 text-xl font-semibold text-brand-white">
                {numberFormatter.format(summary.intervalsCount)}
              </p>
              <p className="text-xs text-brand-cyan/60">15-minute rows ingested</p>
            </div>
            <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy/60 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.3em] text-brand-cyan/50">Total usage</p>
              <p className="mt-2 text-xl font-semibold text-brand-white">{kwhFormatter(summary.totalKwh)}</p>
              <p className="text-xs text-brand-cyan/60">Across coverage window</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy/60 px-4 py-3 text-xs text-brand-cyan/70">
          <p className="font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Latest interval</p>
          <div className="mt-2 text-sm text-brand-white">
            <LocalTime value={summary.latest} fallback="—" options={{ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }} />
          </div>
          {altSource ? (
            <p className="mt-3">
              {altSource.source === 'SMT' ? 'SMT' : 'Green Button'} data also available through{' '}
              {formatLabel(altSource.end, { month: 'short', day: 'numeric', year: 'numeric' })}. The dashboard prioritizes the most recently updated source automatically.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
            Daily totals (last 14 days)
          </h3>
          <DailyTable series={series.daily} />
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
            Peak usage intervals
          </h3>
          <PeakTable series={series.hourly} />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-brand-cyan/15 bg-brand-navy/50 px-4 py-3 text-xs text-brand-cyan/70">
        <p>
          Need richer visualizations? API clients can query <code className="rounded bg-brand-navy/30 px-1">/api/user/usage</code> for the raw data powering this page. We&apos;ll add charts once the manual usage migration ships.
        </p>
      </div>
    </section>
  );
}

export default function UsagePage() {
  const [houses, setHouses] = useState<HouseUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/user/usage', { cache: 'no-store' });
        if (!res.ok) {
          const body = (await res.json()) as UsageApiResponse;
          if (!cancelled) {
            setError(body.ok ? 'Unexpected response' : body.error);
            setLoading(false);
          }
          return;
        }
        const body = (await res.json()) as UsageApiResponse;
        if (!cancelled && body.ok) {
          setHouses(body.houses);
          setLoading(false);
        } else if (!cancelled && !body.ok) {
          setError(body.error ?? 'Failed to load usage data');
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error)?.message ?? 'Failed to load usage data');
          setLoading(false);
        }
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Energy"
        highlight="Usage"
        description="Review how your household consumes electricity. IntelliWatt automatically favors the most recent data source (SMT or Green Button) so the insights below always reflect fresh usage."
      />

      <section className="bg-brand-white pt-4 pb-12 px-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          {loading ? (
            <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy/60 p-6 text-center text-brand-cyan">
              <p className="text-sm text-brand-cyan/80">Pulling usage history…</p>
            </div>
          ) : error ? (
            <div className="rounded-3xl border border-rose-300 bg-rose-500/20 p-6 text-center text-rose-200">
              <p className="text-sm">{error}</p>
            </div>
          ) : houses.length === 0 ? (
            <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy/60 p-6 text-center text-brand-cyan">
              <p className="text-sm text-brand-cyan/80">
                Add a service address to your profile to unlock consumption insights. IntelliWatt activates this dashboard as soon as usage data is available.
              </p>
            </div>
          ) : (
            houses.map((house) => <UsageDatasetSection key={house.houseId} house={house} />)
          )}
        </div>
      </section>
    </div>
  );
}

