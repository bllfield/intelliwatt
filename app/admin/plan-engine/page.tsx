'use client';

import React, { useCallback, useMemo, useState } from 'react';

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const m = Math.floor(n);
  return Math.max(min, Math.min(max, m));
}

function parseOfferIds(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const lines = String(text ?? '')
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const id of lines) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function extractOfferIdsFromJsonText(input: string): { ok: true; offerIds: string[] } | { ok: false; error: string } {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: true, offerIds: [] };

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : "invalid_json" };
  }

  const out: string[] = [];
  const seen = new Set<string>();

  const push = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  const walk = (node: any) => {
    if (node == null) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === "string" || typeof item === "number") push(item);
        else walk(item);
      }
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        const nk = String(k ?? "")
          .trim()
          .replace(/_/g, "")
          .toLowerCase();
        if (nk === "offerid") {
          push(v);
        }
        walk(v);
      }
    }
  };

  walk(parsed);
  return { ok: true, offerIds: out };
}

export default function PlanEngineLabPage() {
  const [offerIdsText, setOfferIdsText] = useState('');
  const [offersJsonText, setOffersJsonText] = useState('');
  const [extractStatus, setExtractStatus] = useState<string | null>(null);
  const [monthsCount, setMonthsCount] = useState(12);
  const [backfill, setBackfill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState<any>(null);

  const offerIds = useMemo(() => parseOfferIds(offerIdsText), [offerIdsText]);
  const monthsCountClamped = useMemo(() => clampInt(monthsCount, 1, 12, 12), [monthsCount]);

  const cleanOfferIds = useCallback(() => {
    const cleaned = parseOfferIds(offerIdsText);
    setOfferIdsText(cleaned.join("\n"));
    setExtractStatus(`Cleaned to ${cleaned.length} unique offerIds.`);
  }, [offerIdsText]);

  const extractOfferIds = useCallback(() => {
    const res = extractOfferIdsFromJsonText(offersJsonText);
    if (!res.ok) {
      setExtractStatus(`Extract error: ${res.error}`);
      return;
    }
    setOfferIdsText(res.offerIds.join("\n"));
    setExtractStatus(
      res.offerIds.length > 0
        ? `Extracted ${res.offerIds.length} offerIds.`
        : `Extracted 0 offerIds. Make sure you pasted valid JSON that includes offerId/offer_id fields (or an array of offerId strings).`,
    );
  }, [offersJsonText]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setRawJson(null);
    try {
      const res = await fetch('/api/plan-engine/estimate-set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          offerIds,
          monthsCount: monthsCountClamped,
          backfill,
        }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { ok: false, error: 'non_json_response', status: res.status, body: text };
      }

      setRawJson(json);
      if (!res.ok) {
        setError(json?.error ? String(json.error) : `http_${res.status}`);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [offerIds, monthsCountClamped, backfill]);

  const rows = Array.isArray(rawJson?.results) ? rawJson.results : [];

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Plan Engine Lab</h1>
        <p className="text-sm text-gray-600">
          Run <code className="font-mono">POST /api/plan-engine/estimate-set</code> to estimate multiple offers (bucket-gated, fail-closed),
          with optional explicit backfill.
        </p>
      </div>

      <div className="grid gap-4 max-w-3xl">
        <label className="space-y-1">
          <div className="text-sm font-semibold text-gray-800">Paste Offers JSON (optional)</div>
          <textarea
            className="w-full border px-3 py-2 rounded font-mono text-xs min-h-[120px]"
            placeholder='Paste /api/dashboard/plans results, or any JSON containing offer_id/offerId fields.'
            value={offersJsonText}
            onChange={(e) => setOffersJsonText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={extractOfferIds}
              className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-gray-700"
            >
              Extract offerIds
            </button>
            {extractStatus ? <div className="text-xs text-gray-600">{extractStatus}</div> : null}
          </div>
        </label>

        <label className="space-y-1">
          <div className="text-sm font-semibold text-gray-800">Offer IDs (one per line)</div>
          <textarea
            className="w-full border px-3 py-2 rounded font-mono text-xs min-h-[160px]"
            placeholder="offerId_1&#10;offerId_2&#10;..."
            value={offerIdsText}
            onChange={(e) => setOfferIdsText(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-gray-500">Parsed: {offerIds.length} unique offerIds (max 25).</div>
            <button type="button" onClick={cleanOfferIds} className="text-xs font-semibold text-gray-700 hover:text-gray-900">
              Clean / De-dupe
            </button>
          </div>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">monthsCount</span>
            <input
              type="number"
              min={1}
              max={12}
              className="border px-3 py-2 rounded w-[120px]"
              value={monthsCount}
              onChange={(e) => setMonthsCount(clampInt(e.target.value, 1, 12, 12))}
            />
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={backfill} onChange={(e) => setBackfill(e.target.checked)} />
            <span className="text-sm font-semibold text-gray-800">backfill</span>
          </label>

          <button
            type="button"
            onClick={run}
            disabled={busy || offerIds.length === 0}
            className="px-4 py-2 rounded bg-black text-white hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? 'Running…' : 'Run estimate-set'}
          </button>

          {error ? <div className="text-sm text-red-600">Error: {error}</div> : null}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Summary</h2>
        <table className="w-full text-sm border border-gray-200">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">offerId</th>
              <th className="p-2">estimate.status</th>
              <th className="p-2">estimate.reason</th>
              <th className="p-2">backfill.ok</th>
              <th className="p-2">missingKeysAfter</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-2 text-gray-500" colSpan={5}>
                  No results yet.
                </td>
              </tr>
            ) : (
              rows.map((r: any, idx: number) => (
                <tr key={r?.offerId ?? idx} className="border-t border-gray-200">
                  <td className="p-2 font-mono text-xs break-all">{String(r?.offerId ?? '')}</td>
                  <td className="p-2 font-mono text-xs">{String(r?.estimate?.status ?? r?.estimate?.statusLabel ?? '')}</td>
                  <td className="p-2 font-mono text-xs break-all">{String(r?.estimate?.reason ?? r?.error ?? '')}</td>
                  <td className="p-2 font-mono text-xs">{String(Boolean(r?.backfill?.ok))}</td>
                  <td className="p-2 font-mono text-xs">{String(r?.backfill?.missingKeysAfter ?? '')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Raw JSON</h2>
        <pre className="bg-gray-100 p-3 rounded text-xs whitespace-pre-wrap">
          {rawJson ? JSON.stringify(rawJson, null, 2) : 'Responses will appear here.'}
        </pre>
      </div>
    </div>
  );
}

