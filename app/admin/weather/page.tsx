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
  house?: { id: string; label: string };
  station: { id: string; code: string };
  range: { start: string; end: string; version: number };
  counts: {
    dateKeys: number;
    actual: number;
    normal: number;
    houseActual: number;
    houseNormal: number;
  };
  missing: {
    ACTUAL_LAST_YEAR: string[];
    NORMAL_AVG: string[];
    HOUSE_ACTUAL_LAST_YEAR: string[];
    HOUSE_NORMAL_AVG: string[];
  };
  actualLastYear: DayWeather[];
  normalAvg: DayWeather[];
  houseActualLastYear: DayWeather[];
  houseNormalAvg: DayWeather[];
  error?: string;
};

type OpenMeteoTestRow = {
  timestampUtc: string;
  temperatureC: number | null;
  cloudcoverPct: number | null;
  solarRadiation: number | null;
};

type OpenMeteoTestResponse = {
  ok: boolean;
  fromStub: boolean;
  rowCount: number;
  message: string;
  firstRow: OpenMeteoTestRow | null;
  lastRow: OpenMeteoTestRow | null;
  sample: OpenMeteoTestRow[];
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

  const [omLat, setOmLat] = useState("32.7555");
  const [omLon, setOmLon] = useState("-97.3308");
  const [omStart, setOmStart] = useState("2025-01-01");
  const [omEnd, setOmEnd] = useState("2025-01-10");
  const [omLoading, setOmLoading] = useState(false);
  const [omData, setOmData] = useState<OpenMeteoTestResponse | null>(null);
  const [omError, setOmError] = useState<string | null>(null);

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

  async function testOpenMeteoFetch() {
    setOmError(null);
    setOmData(null);
    const lat = Number(omLat);
    const lon = Number(omLon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setOmError("Lat must be between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setOmError("Lon must be between -180 and 180.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(omStart) || !/^\d{4}-\d{2}-\d{2}$/.test(omEnd) || omEnd < omStart) {
      setOmError("Start and end must be YYYY-MM-DD with end >= start.");
      return;
    }
    setOmLoading(true);
    try {
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        start: omStart,
        end: omEnd,
      });
      const res = await fetch(`/api/admin/weather/test-open-meteo?${params.toString()}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as OpenMeteoTestResponse & { error?: string };
      if (!res.ok || !json?.ok) {
        setOmError(json?.error ?? `Request failed (${res.status})`);
        return;
      }
      setOmData(json);
    } finally {
      setOmLoading(false);
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
                  House: {data.house?.label ?? data.house?.id ?? "Unknown house"}
                </div>
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
                <div>
                  Missing shared house ACTUAL_LAST_YEAR: {data.missing.HOUSE_ACTUAL_LAST_YEAR.length} | Missing shared
                  house NORMAL_AVG: {data.missing.HOUSE_NORMAL_AVG.length}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-navy">Station weather DB rows</h3>
                  <p className="text-sm text-brand-navy/70">
                    Station-scoped inspector rows for the selected house and 365-day window.
                  </p>
                </div>
                <WeatherTable title="ACTUAL_LAST_YEAR" rows={data.actualLastYear} />
                <WeatherTable title="NORMAL_AVG" rows={data.normalAvg} />
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-brand-navy">Shared house weather DB rows</h3>
                  <p className="text-sm text-brand-navy/70">
                    House-scoped rows used by shared Past Sim and GapFill after the same weather pull/backfill path.
                  </p>
                </div>
                <WeatherTable title="HOUSE ACTUAL_LAST_YEAR" rows={data.houseActualLastYear} />
                <WeatherTable title="HOUSE NORMAL_AVG" rows={data.houseNormalAvg} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-8 rounded-lg bg-brand-white p-6 shadow-lg">
          <h2 className="text-xl font-bold text-brand-navy">Open-Meteo hourly (simulator)</h2>
          <p className="mt-1 text-sm text-brand-navy/70">
            Test the simulator weather path: real Open-Meteo + DB cache with stub fallback. Run twice to confirm second run uses cache.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Lat</div>
              <input
                type="text"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={omLat}
                onChange={(e) => setOmLat(e.target.value)}
                placeholder="32.7555"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Lon</div>
              <input
                type="text"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={omLon}
                onChange={(e) => setOmLon(e.target.value)}
                placeholder="-97.3308"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Start (YYYY-MM-DD)</div>
              <input
                type="date"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={omStart}
                onChange={(e) => setOmStart(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">End (YYYY-MM-DD)</div>
              <input
                type="date"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={omEnd}
                onChange={(e) => setOmEnd(e.target.value)}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => testOpenMeteoFetch()}
              disabled={omLoading}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {omLoading ? "Loading..." : "Test fetch"}
            </button>
            <span className="text-xs text-slate-500">Uses same admin token. Run twice to verify cache.</span>
          </div>
          {omError ? <div className="mt-4 rounded bg-rose-50 p-3 text-sm text-rose-700">{omError}</div> : null}
          {omData ? (
            <div className="mt-6 space-y-4">
              <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
                <div className="font-semibold">
                  {omData.fromStub ? "Stub used" : "Real weather (Open-Meteo cache)"}
                </div>
                <div>Rows: {omData.rowCount}</div>
                <div>{omData.message}</div>
              </div>
              {omData.firstRow || omData.lastRow ? (
                <div className="grid gap-4 sm:grid-cols-2 text-sm">
                  {omData.firstRow ? (
                    <div className="rounded border border-slate-200 p-3">
                      <div className="font-semibold text-slate-700">First row</div>
                      <pre className="mt-1 overflow-auto text-xs">{JSON.stringify(omData.firstRow, null, 2)}</pre>
                    </div>
                  ) : null}
                  {omData.lastRow ? (
                    <div className="rounded border border-slate-200 p-3">
                      <div className="font-semibold text-slate-700">Last row</div>
                      <pre className="mt-1 overflow-auto text-xs">{JSON.stringify(omData.lastRow, null, 2)}</pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {omData.sample?.length > 0 ? (
                <div className="rounded border border-slate-200">
                  <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
                    Sample (first 5)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-white">
                        <tr className="border-b">
                          <th className="px-3 py-2 text-left">timestampUtc</th>
                          <th className="px-3 py-2 text-left">temperatureC</th>
                          <th className="px-3 py-2 text-left">cloudcoverPct</th>
                          <th className="px-3 py-2 text-left">solarRadiation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {omData.sample.map((r, i) => (
                          <tr key={i} className="border-b last:border-b-0">
                            <td className="px-3 py-2">{r.timestampUtc}</td>
                            <td className="px-3 py-2">{r.temperatureC ?? "—"}</td>
                            <td className="px-3 py-2">{r.cloudcoverPct ?? "—"}</td>
                            <td className="px-3 py-2">{r.solarRadiation ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
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
