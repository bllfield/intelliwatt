'use client';

import { useEffect, useMemo, useState } from "react";

type InspectResponse = {
  ok: boolean;
  error?: string;
  detail?: string;
  availableHouses?: Array<{
    id: string;
    label: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    esiid: string | null;
    isPrimary: boolean | null;
  }>;
  availableScenarios?: Array<{ id: string; name: string; updatedAt: string }>;
  [k: string]: unknown;
};

export default function SimulationEnginesPage() {
  const [adminToken, setAdminToken] = useState("");
  const [email, setEmail] = useState("");
  const [houseId, setHouseId] = useState("");
  const [scenario, setScenario] = useState<"past" | "future" | "baseline">("past");
  const [recalc, setRecalc] = useState(false);
  const [mode, setMode] = useState<"SMT_BASELINE" | "NEW_BUILD_ESTIMATE" | "MANUAL_TOTALS">("SMT_BASELINE");
  const [weatherPreference, setWeatherPreference] = useState<"NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE">(
    "LAST_YEAR_WEATHER"
  );
  const [includeSeries, setIncludeSeries] = useState(false);
  const [includeBuildInputsRaw, setIncludeBuildInputsRaw] = useState(false);
  const [includeDayDiagnostics, setIncludeDayDiagnostics] = useState(true);
  const [dayDiagnosticsLimit, setDayDiagnosticsLimit] = useState(400);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<InspectResponse | null>(null);

  useEffect(() => {
    const token = window.localStorage.getItem("iw_admin_token");
    if (token) setAdminToken(token);
  }, []);

  useEffect(() => {
    if (adminToken.trim()) window.localStorage.setItem("iw_admin_token", adminToken.trim());
  }, [adminToken]);

  const headers = useMemo(() => {
    const h = new Headers();
    h.set("Content-Type", "application/json");
    if (adminToken.trim()) h.set("x-admin-token", adminToken.trim());
    return h;
  }, [adminToken]);

  async function inspect() {
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        email: email.trim(),
        scenario,
        recalc: recalc ? "1" : "0",
        includeSeries: includeSeries ? "1" : "0",
        includeBuildInputsRaw: includeBuildInputsRaw ? "1" : "0",
        includeDayDiagnostics: includeDayDiagnostics ? "1" : "0",
        dayDiagnosticsLimit: String(Math.max(10, Math.min(2000, Math.trunc(dayDiagnosticsLimit || 400)))),
      });
      if (recalc) {
        qs.set("mode", mode);
        qs.set("weatherPreference", weatherPreference);
      }
      if (houseId.trim()) qs.set("houseId", houseId.trim());
      const res = await fetch(`/api/admin/simulation-engines?${qs.toString()}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as InspectResponse | null;
      if (!res.ok || !json?.ok) {
        setPayload(json);
        setError(json?.error ?? json?.detail ?? `Request failed (${res.status})`);
        return;
      }
      setPayload(json);
      const houses = Array.isArray(json.availableHouses) ? json.availableHouses : [];
      if (!houseId.trim() && houses.length > 0) setHouseId(houses[0].id);
    } finally {
      setLoading(false);
    }
  }

  const prettyJson = useMemo(() => (payload ? JSON.stringify(payload, null, 2) : ""), [payload]);
  const houses = Array.isArray(payload?.availableHouses) ? payload.availableHouses : [];
  const scenarios = Array.isArray(payload?.availableScenarios) ? payload.availableScenarios : [];

  return (
    <div className="min-h-screen bg-brand-navy">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 rounded-lg bg-brand-white p-6 shadow-lg">
          <h1 className="text-2xl font-bold text-brand-navy">Simulation Engines</h1>
          <p className="mt-1 text-sm text-brand-navy/70">
            Inspect Past/Future/New Build simulation inputs and outputs by user email, including build payload snapshots and engine context.
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
              <div className="mb-1 font-semibold text-brand-navy">User email</div>
              <input
                type="email"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Engine target</div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={scenario}
                onChange={(e) => setScenario(e.target.value as "past" | "future" | "baseline")}
              >
                <option value="past">Past (Corrected)</option>
                <option value="future">Future (What-if)</option>
                <option value="baseline">Baseline / New Build base</option>
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">House (optional override)</div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={houseId}
                onChange={(e) => setHouseId(e.target.value)}
              >
                <option value="">Auto-select primary/latest</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label || h.addressLine1 || h.id} {h.esiid ? `(${h.esiid})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="font-semibold">Scenarios on selected house</div>
              <div className="mt-1 max-h-24 overflow-auto">
                {scenarios.length > 0
                  ? scenarios.map((s) => (
                      <div key={s.id}>
                        {s.name} - {s.id}
                      </div>
                    ))
                  : "No active scenarios loaded yet."}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Recalc mode</div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={mode}
                onChange={(e) => setMode(e.target.value as "SMT_BASELINE" | "NEW_BUILD_ESTIMATE" | "MANUAL_TOTALS")}
              >
                <option value="SMT_BASELINE">SMT_BASELINE (Past/vacant/travel patch path)</option>
                <option value="NEW_BUILD_ESTIMATE">NEW_BUILD_ESTIMATE (new build engine)</option>
                <option value="MANUAL_TOTALS">MANUAL_TOTALS</option>
              </select>
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Weather preference</div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={weatherPreference}
                onChange={(e) =>
                  setWeatherPreference(e.target.value as "NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE")
                }
              >
                <option value="LAST_YEAR_WEATHER">LAST_YEAR_WEATHER</option>
                <option value="LONG_TERM_AVERAGE">LONG_TERM_AVERAGE</option>
                <option value="NONE">NONE</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-brand-navy">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={recalc} onChange={(e) => setRecalc(e.target.checked)} />
              Recalculate before inspect
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={includeSeries} onChange={(e) => setIncludeSeries(e.target.checked)} />
              Include full interval series
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeBuildInputsRaw}
                onChange={(e) => setIncludeBuildInputsRaw(e.target.checked)}
              />
              Include raw buildInputs payload
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeDayDiagnostics}
                onChange={(e) => setIncludeDayDiagnostics(e.target.checked)}
              />
              Include per-day diagnostics
            </label>
            <label className="inline-flex items-center gap-2">
              <span>Day diag limit</span>
              <input
                type="number"
                min={10}
                max={2000}
                value={dayDiagnosticsLimit}
                onChange={(e) => setDayDiagnosticsLimit(Number(e.target.value) || 400)}
                className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </label>
            <button
              type="button"
              onClick={() => inspect()}
              disabled={loading}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {loading ? "Inspecting..." : "Inspect Simulation Engine"}
            </button>
          </div>

          {error ? <div className="mt-4 rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

          {payload ? (
            <div className="mt-6">
              <div className="mb-2 text-sm font-semibold text-brand-navy">Engine payload + response</div>
              <textarea
                readOnly
                value={prettyJson}
                className="h-[560px] w-full rounded border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-slate-100"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

