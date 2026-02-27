'use client';

import { useEffect, useMemo, useState } from "react";

type WeatherSourceMode = "STUB" | "REAL_API";
type DayWeather = {
  dateKey: string;
  tAvgF: number;
  tMinF: number;
  tMaxF: number;
  hdd65: number;
  cdd65: number;
  source: string;
};

type WeatherResponse = {
  ok: boolean;
  mode: WeatherSourceMode;
  station: { id: string; code: string };
  range: { start: string; end: string; version: number };
  counts: { dateKeys: number; actual: number; normal: number };
  missing: { ACTUAL_LAST_YEAR: string[]; NORMAL_AVG: string[] };
  actualLastYear: DayWeather[];
  normalAvg: DayWeather[];
  error?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toYyyyMmDdUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultRange() {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(todayUtc.getTime() - DAY_MS);
  const start = new Date(end.getTime() - 364 * DAY_MS);
  return { start: toYyyyMmDdUtc(start), end: toYyyyMmDdUtc(end) };
}

export default function AdminWeatherPage() {
  const [adminToken, setAdminToken] = useState("");
  const [email, setEmail] = useState("");
  const [end, setEnd] = useState(defaultRange().end);
  const [mode, setMode] = useState<WeatherSourceMode>("STUB");
  const [loading, setLoading] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("iw_admin_token");
    if (stored) setAdminToken(stored);
  }, []);

  useEffect(() => {
    const token = adminToken.trim();
    if (token) window.localStorage.setItem("iw_admin_token", token);
  }, [adminToken]);

  const headers = useMemo(() => {
    const token = adminToken.trim();
    const h = new Headers();
    if (token) h.set("x-admin-token", token);
    h.set("Content-Type", "application/json");
    return h;
  }, [adminToken]);

  async function loadMode() {
    setError(null);
    const res = await fetch("/api/admin/settings/weather-source", {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? `Failed to load mode (${res.status})`);
      return;
    }
    setMode(json.mode === "REAL_API" ? "REAL_API" : "STUB");
  }

  async function saveMode(nextMode: WeatherSourceMode) {
    setSavingMode(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings/weather-source", {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: nextMode }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? `Failed to save mode (${res.status})`);
        return;
      }
      setMode(json.mode === "REAL_API" ? "REAL_API" : "STUB");
    } finally {
      setSavingMode(false);
    }
  }

  async function fetchWeather() {
    if (!email.trim()) {
      setError("email is required.");
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams({
        email: email.trim(),
        end: end.trim(),
        version: "1",
      });
      const res = await fetch(`/api/admin/weather?${params.toString()}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as WeatherResponse | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? `Failed to load weather (${res.status})`);
        return;
      }
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand-navy">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 rounded-lg bg-brand-white p-6 shadow-lg">
          <h1 className="text-2xl font-bold text-brand-navy">Admin Weather</h1>
          <p className="mt-1 text-sm text-brand-navy/70">
            Inspect station-based weather rows by email and a fixed 365-day window ending on the selected date.
          </p>
        </div>

        <div className="rounded-lg bg-brand-white p-6 shadow-lg">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Admin token</div>
              <input
                type="password"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder="x-admin-token"
              />
            </label>
            <label className="text-sm lg:col-span-2">
              <div className="mb-1 font-semibold text-brand-navy">Email address</div>
              <input
                type="email"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">End</div>
              <input
                type="date"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
              <div className="mt-1 text-xs text-slate-500">
                Start is auto-set to 364 days before End (365 total days).
              </div>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => loadMode()}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Load Mode
            </button>
            <label className="inline-flex items-center gap-2 text-sm text-brand-navy">
              <input
                type="checkbox"
                checked={mode === "REAL_API"}
                onChange={(e) => saveMode(e.target.checked ? "REAL_API" : "STUB")}
                disabled={savingMode}
              />
              Use real weather API
            </label>
            <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              Current mode: {mode}
            </span>
            <button
              type="button"
              onClick={() => fetchWeather()}
              disabled={loading}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {loading ? "Loading..." : "Load Weather"}
            </button>
          </div>

          {error ? <div className="mt-4 rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

          {data ? (
            <div className="mt-6 space-y-6">
              <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
                <div className="font-semibold">
                  Station: {data.station.code} ({data.station.id})
                </div>
                <div>
                  Range: {data.range.start} to {data.range.end} (v{data.range.version})
                </div>
                <div>
                  Missing ACTUAL_LAST_YEAR: {data.missing.ACTUAL_LAST_YEAR.length} | Missing NORMAL_AVG:{" "}
                  {data.missing.NORMAL_AVG.length}
                </div>
              </div>

              <WeatherTable title="ACTUAL_LAST_YEAR" rows={data.actualLastYear} />
              <WeatherTable title="NORMAL_AVG" rows={data.normalAvg} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WeatherTable({ title, rows }: { title: string; rows: DayWeather[] }) {
  return (
    <div className="rounded border border-slate-200">
      <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
        {title} ({rows.length})
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-white">
            <tr className="border-b">
              <th className="px-3 py-2 text-left">dateKey</th>
              <th className="px-3 py-2 text-left">tAvgF</th>
              <th className="px-3 py-2 text-left">tMinF</th>
              <th className="px-3 py-2 text-left">tMaxF</th>
              <th className="px-3 py-2 text-left">hdd65</th>
              <th className="px-3 py-2 text-left">cdd65</th>
              <th className="px-3 py-2 text-left">source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${title}:${r.dateKey}`} className="border-b last:border-b-0">
                <td className="px-3 py-2">{r.dateKey}</td>
                <td className="px-3 py-2">{r.tAvgF}</td>
                <td className="px-3 py-2">{r.tMinF}</td>
                <td className="px-3 py-2">{r.tMaxF}</td>
                <td className="px-3 py-2">{r.hdd65}</td>
                <td className="px-3 py-2">{r.cdd65}</td>
                <td className="px-3 py-2">{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
