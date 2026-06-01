"use client";

import { useCallback, useState } from "react";

type ParityRow = {
  surface: string;
  userPath: string;
  onePathPath: string;
  status: string;
  summary: string;
  details?: Record<string, unknown>;
};

type ParityResponse = {
  ok: boolean;
  email?: string;
  houseId?: string;
  houseLabel?: string;
  committedSource?: string | null;
  greenButtonIntervalCount?: number | null;
  rows?: ParityRow[];
  baselineParityReport?: {
    overallMatch?: boolean;
    firstDivergenceField?: string | null;
    mismatchedKeys?: string[];
  } | null;
  error?: string;
  message?: string;
};

function statusTone(status: string): string {
  if (status === "match") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (status === "skipped") return "text-slate-700 bg-slate-50 border-slate-200";
  if (status === "blocked") return "text-amber-800 bg-amber-50 border-amber-200";
  return "text-rose-800 bg-rose-50 border-rose-200";
}

export function SurfaceParityAdmin() {
  const [email, setEmail] = useState("");
  const [houseId, setHouseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParityResponse | null>(null);

  const runAudit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/tools/surface-parity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          houseId: houseId.trim() || null,
        }),
      });
      const json = (await response.json()) as ParityResponse;
      if (!response.ok) {
        setError(json.error ?? json.message ?? `Request failed (${response.status})`);
        return;
      }
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [email, houseId]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-brand-navy">Surface parity lab</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        Enter any customer email to compare user-site Usage and baseline contracts with the same shared
        One Path loaders. Modes are data-type presets (Interval, Green Button, manual, new build)—not
        house-specific configurations.
      </p>

      <div className="mt-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
        <label className="text-sm text-slate-700">
          <span className="font-semibold text-brand-navy">Email</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="customer@example.com"
          />
        </label>
        <label className="text-sm text-slate-700">
          <span className="font-semibold text-brand-navy">House id (optional)</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
            value={houseId}
            onChange={(event) => setHouseId(event.target.value)}
            placeholder="Primary visible house when empty"
          />
        </label>
      </div>

      <button
        type="button"
        className="mt-4 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        disabled={busy || !email.trim()}
        onClick={() => void runAudit()}
      >
        {busy ? "Running parity audit…" : "Run parity audit"}
      </button>

      {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}

      {result ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <div>
              <span className="font-semibold">House:</span> {result.houseLabel ?? result.houseId}
            </div>
            <div className="mt-1">
              <span className="font-semibold">Committed source:</span> {result.committedSource ?? "unknown"}
            </div>
            <div className="mt-1">
              <span className="font-semibold">Green Button intervals:</span>{" "}
              {result.greenButtonIntervalCount == null ? "n/a" : result.greenButtonIntervalCount}
            </div>
            <div className="mt-1">
              <span className="font-semibold">Overall:</span> {result.ok ? "PASS" : "NEEDS ATTENTION"}
            </div>
          </div>

          {(result.rows ?? []).map((row) => (
            <div key={row.surface} className={`rounded-xl border p-4 ${statusTone(row.status)}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold uppercase tracking-wide">{row.surface}</div>
                <div className="text-xs font-semibold">{row.status}</div>
              </div>
              <p className="mt-2 text-sm">{row.summary}</p>
              <div className="mt-2 grid gap-1 text-xs text-slate-600 md:grid-cols-2">
                <div>
                  <span className="font-semibold">User:</span> {row.userPath}
                </div>
                <div>
                  <span className="font-semibold">One Path:</span> {row.onePathPath}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
