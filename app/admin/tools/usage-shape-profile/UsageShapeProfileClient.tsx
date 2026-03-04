"use client";

import { useState } from "react";
import Link from "next/link";

type HouseOption = { id: string; label: string };

type RebuildResponse =
  | {
      ok: true;
      profileId: string;
      houseId: string;
      houseLabel: string;
      version: string;
      windowStartUtc: string;
      windowEndUtc: string;
      intervalCount: number;
      baseloadKwhPer15m: number | null;
      baseloadKwhPerDay: number | null;
      peakHourByMonth: number[];
      p95KwByMonth: number[];
      timeOfDayShares: { overnight: number; morning: number; afternoon: number; evening: number };
      configHash: string;
      shapeAll96Preview: number[];
    }
  | { ok: false; error: string; message?: string };

export default function UsageShapeProfileClient() {
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [houseId, setHouseId] = useState("");
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RebuildResponse | null>(null);

  async function handleLookup() {
    setError(null);
    setResult(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    setLookupLoading(true);
    try {
      const res = await fetch(`/api/admin/tools/usage-shape-profile?email=${encodeURIComponent(trimmed)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data as any)?.message ?? (data as any)?.error ?? "Lookup failed.");
        setHouses([]);
        return;
      }
      if (data.ok && data.houses?.length) {
        setHouses(data.houses);
        const currentInList = houseId && data.houses.some((h: HouseOption) => h.id === houseId);
        setHouseId(currentInList ? houseId : data.houses[0].id);
      } else {
        setHouses([]);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setHouses([]);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleComputeAndSave() {
    setError(null);
    setResult(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tools/usage-shape-profile/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          houseId: houseId || undefined,
          timezone,
        }),
      });
      const data = (await res.json().catch(() => null)) as RebuildResponse | null;
      if (!res.ok) {
        setError((data as any)?.message ?? (data as any)?.error ?? `Request failed (${res.status})`);
        setResult(null);
        return;
      }
      if (data == null || typeof data !== "object") {
        setError("Invalid response from server.");
        setResult(null);
        return;
      }
      setResult(data);
      if (data.ok && (data as any).houses?.length) setHouses((data as any).houses);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const summary = result && result.ok ? result : null;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <Link href="/admin" className="text-brand-blue hover:underline text-sm">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-brand-navy mt-2">Usage Shape Profile</h1>
        <p className="text-brand-navy/70 text-sm mt-1">
          Derive and save a versioned usage shape from actual 15-min intervals (canonical 12-month window). Foundation for travel/missing-day gap-fill.
        </p>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1">Email</label>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 border border-brand-navy/20 rounded px-3 py-2 text-brand-navy"
              placeholder="user@example.com"
            />
            <button
              type="button"
              onClick={handleLookup}
              disabled={lookupLoading}
              className="px-4 py-2 bg-brand-navy/10 text-brand-navy rounded hover:bg-brand-blue/20 disabled:opacity-50"
            >
              {lookupLoading ? "…" : "Look up"}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1">House</label>
          <select
            value={houseId}
            onChange={(e) => setHouseId(e.target.value)}
            className="w-full border border-brand-navy/20 rounded px-3 py-2 text-brand-navy"
            disabled={!houses.length}
          >
            {!houses.length && <option value="">Enter email and click Look up</option>}
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1">Timezone</label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full border border-brand-navy/20 rounded px-3 py-2 text-brand-navy"
          />
        </div>
        <div>
          <button
            type="button"
            onClick={handleComputeAndSave}
            disabled={loading || !houseId}
            className="px-4 py-2 bg-brand-navy text-white rounded hover:bg-brand-blue disabled:opacity-50"
          >
            {loading ? "Computing…" : "Compute & Save Usage Shape Profile"}
          </button>
          <span className="ml-2 text-sm text-brand-navy/60">May take 30–60 seconds (full-year intervals).</span>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded bg-rose-50 text-rose-800 border border-rose-200">
          {error}
        </div>
      )}

      {summary && (
        <div className="space-y-4 p-4 rounded bg-brand-blue/5 border border-brand-blue/20">
          <div className="font-semibold text-brand-navy">Profile summary</div>
          <div className="grid gap-2 text-sm">
            <div>House: {summary.houseLabel}</div>
            <div>Version: {summary.version} · Config: {summary.configHash}</div>
            <div>Window: {summary.windowStartUtc?.slice(0, 10)} → {summary.windowEndUtc?.slice(0, 10)} · Intervals: {summary.intervalCount}</div>
            <div>Baseload: {summary.baseloadKwhPer15m != null ? `${summary.baseloadKwhPer15m.toFixed(4)} kWh/15m` : "—"} · {summary.baseloadKwhPerDay != null ? `${summary.baseloadKwhPerDay.toFixed(2)} kWh/day` : "—"}</div>
            <div>
              Time-of-day shares: overnight {((summary.timeOfDayShares?.overnight ?? 0) * 100).toFixed(1)}% · morning {((summary.timeOfDayShares?.morning ?? 0) * 100).toFixed(1)}% · afternoon {((summary.timeOfDayShares?.afternoon ?? 0) * 100).toFixed(1)}% · evening {((summary.timeOfDayShares?.evening ?? 0) * 100).toFixed(1)}%
            </div>
            {summary.peakHourByMonth?.length ? (
              <div>Peak hour by month (0–23): {summary.peakHourByMonth.join(", ")}</div>
            ) : null}
            {summary.p95KwByMonth?.length ? (
              <div>P95 kW by month: {summary.p95KwByMonth.map((k) => k.toFixed(2)).join(", ")}</div>
            ) : null}
            {summary.shapeAll96Preview?.length ? (
              <div>Shape (first 24 slots kWh/15m): {summary.shapeAll96Preview.map((v) => v.toFixed(3)).join(", ")}</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}