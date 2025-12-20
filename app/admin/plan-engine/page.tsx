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

  // OfferId finder (WattBuy offers proxy)
  const [lookupMode, setLookupMode] = useState<'address' | 'wattkey'>('address');
  const [offerKind, setOfferKind] = useState<'all' | 'fixed' | 'tou' | 'free-weekends' | 'free-nights' | 'variable' | 'other'>('all');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('tx');
  const [zip, setZip] = useState('');
  const [wattkey, setWattkey] = useState('');
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [offersRaw, setOffersRaw] = useState<any>(null);
  const [offersList, setOffersList] = useState<any[]>([]);
  const [templateClassifying, setTemplateClassifying] = useState(false);
  const [templateClassError, setTemplateClassError] = useState<string | null>(null);
  type OfferPrimaryType = "INDEXED" | "TIERED" | "FREE_WEEKENDS" | "FREE_NIGHTS" | "TOU" | "FIXED" | "OTHER";
  const [templateTypeByOfferId, setTemplateTypeByOfferId] = useState<Record<string, OfferPrimaryType>>({});
  const [templateFlagsByOfferId, setTemplateFlagsByOfferId] = useState<Record<string, string[]>>({});
  const [templateReasonByOfferId, setTemplateReasonByOfferId] = useState<Record<string, string>>({});
  const [monthsCount, setMonthsCount] = useState(12);
  const [backfill, setBackfill] = useState(true);
  const [approxIndexed, setApproxIndexed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState<any>(null);

  const offerIds = useMemo(() => parseOfferIds(offerIdsText), [offerIdsText]);
  const monthsCountClamped = useMemo(() => clampInt(monthsCount, 1, 12, 12), [monthsCount]);

  const cleanOfferIds = useCallback(() => {
    const cleaned = parseOfferIds(offerIdsText);
    setOfferIdsText(cleaned.join('\n'));
    setExtractStatus(`Cleaned to ${cleaned.length} unique offerIds.`);
  }, [offerIdsText]);

  const addOfferIdsToTextarea = useCallback(
    (ids: string[], mode: 'append' | 'replace') => {
      const base = mode === 'replace' ? '' : offerIdsText;
      const merged = parseOfferIds([base, ...(ids ?? [])].filter(Boolean).join('\n'));
      setOfferIdsText(merged.join('\n'));
      setExtractStatus(`Now have ${merged.length} unique offerIds.`);
    },
    [offerIdsText],
  );

  const extractOfferIds = useCallback(() => {
    const res = extractOfferIdsFromJsonText(offersJsonText);
    if (!res.ok) {
      setExtractStatus(`Extract error: ${res.error}`);
      return;
    }
    setOfferIdsText(res.offerIds.join('\n'));
    setExtractStatus(
      res.offerIds.length > 0
        ? `Extracted ${res.offerIds.length} offerIds.`
        : `Extracted 0 offerIds. Make sure you pasted valid JSON that includes offerId/offer_id fields (or an array of offerId strings).`,
    );
  }, [offersJsonText]);

  const fetchOffers = useCallback(async () => {
    setOffersLoading(true);
    setOffersError(null);
    setOffersRaw(null);
    setOffersList([]);

    try {
      const body: any = {};
      if (lookupMode === 'wattkey') {
        const wk = wattkey.trim();
        if (!wk) {
          setOffersError('Enter a wattkey.');
          return;
        }
        body.wattkey = wk;
      } else {
        const a = address.trim();
        const c = city.trim();
        const s = state.trim();
        const z = zip.trim();
        if (!a || !c || !s || !z) {
          setOffersError('Enter address + city + state + zip.');
          return;
        }
        body.address = a;
        body.city = c;
        body.state = s;
        body.zip = z;
      }

      const res = await fetch('/api/wattbuy/offers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      setOffersRaw(json);

      if (!res.ok) {
        setOffersError(json?.error ? String(json.error) : `http_${res.status}`);
        return;
      }

      const offers = Array.isArray(json?.offers) ? json.offers : [];
      setOffersList(offers);
      setExtractStatus(`Fetched ${offers.length} offers.`);
      setTemplateTypeByOfferId({});
      setTemplateFlagsByOfferId({});
      setTemplateReasonByOfferId({});
    } catch (e: any) {
      setOffersError(e?.message ?? String(e));
    } finally {
      setOffersLoading(false);
    }
  }, [lookupMode, wattkey, address, city, state, zip]);

  function deriveTypeAndFlagsFromTemplateResult(r: any): { type: OfferPrimaryType; flags: string[] } {
    const estimate = r?.estimate ?? null;
    const reason = String(estimate?.reason ?? "").toUpperCase();
    const notes: string[] = Array.isArray(estimate?.notes) ? estimate.notes.map((x: any) => String(x)) : [];
    const notesHay = notes.join(" ").toUpperCase();
    const estimateMode = String(estimate?.estimateMode ?? "").toUpperCase();
    const detected = r?.detected ?? {};

    const flags: string[] = [];

    if (detected?.freeWeekends) flags.push("FREE_WEEKENDS");
    if (detected?.dayNightTou) flags.push("TOU_DAY_NIGHT");
    if (detected?.freeNights) flags.push("FREE_NIGHTS");
    if (detected?.tiered) flags.push("TIERED");
    if (detected?.indexed || detected?.variable) flags.push("INDEXED");
    if (detected?.fixedRate) flags.push("FIXED");

    if (reason.includes("MISSING_USAGE_BUCKETS")) flags.push("MISSING_BUCKETS");
    if (reason.includes("USAGE_BUCKET_SUM_MISMATCH")) flags.push("SUM_MISMATCH");

    // Deterministic precedence:
    // 1) INDEXED
    const isIndexedApprox =
      estimateMode === "INDEXED_EFL_ANCHOR_APPROX" ||
      /\bEFL MODELED AVERAGE PRICE ANCHORS?\b/.test(notesHay);
    if (
      reason.includes("NON_DETERMINISTIC_PRICING_INDEXED") ||
      reason.includes("MISSING_EFL_ANCHORS") ||
      isIndexedApprox ||
      reason.includes("NON_DETERMINISTIC") ||
      reason.includes("INDEX") ||
      detected?.indexed ||
      detected?.variable
    ) {
      if (estimate?.status === "APPROXIMATE" && isIndexedApprox) flags.push("INDEXED_APPROX");
      return { type: "INDEXED", flags: Array.from(new Set(flags)) };
    }
    // 2) TIERED
    if (detected?.tiered || reason.includes("TIER")) {
      return { type: "TIERED", flags: Array.from(new Set(flags)) };
    }
    // 3) FREE_WEEKENDS
    if (detected?.freeWeekends || notesHay.includes("FREE WEEKEND") || reason.includes("FREE_WEEKENDS")) {
      return { type: "FREE_WEEKENDS", flags: Array.from(new Set(flags)) };
    }
    // 4) FREE_NIGHTS
    if (detected?.freeNights || notesHay.includes("FREE NIGHT")) {
      return { type: "FREE_NIGHTS", flags: Array.from(new Set(flags)) };
    }
    // 5) TOU
    if (detected?.dayNightTou || notesHay.includes("TOU PHASE-2") || notesHay.includes("TOU PHASE-1") || reason.includes("TOU")) {
      return { type: "TOU", flags: Array.from(new Set(flags)) };
    }
    // 6) FIXED (only with explicit detection; do NOT infer from OK)
    if (detected?.fixedRate) {
      return { type: "FIXED", flags: Array.from(new Set(flags)) };
    }
    // 7) OTHER
    if (estimate?.status === "OK" || estimate?.status === "APPROXIMATE") flags.push("OK_BUT_UNKNOWN_TYPE");
    if (estimate?.status === "APPROXIMATE" && !isIndexedApprox) flags.push("APPROXIMATE_BUT_UNKNOWN_TYPE");
    return { type: "OTHER", flags: Array.from(new Set(flags)) };
  }

  const classifyOffersFromTemplates = useCallback(async () => {
    setTemplateClassifying(true);
    setTemplateClassError(null);
    try {
      const offerIds = offersList.map((o: any) => String(o?.offer_id ?? "").trim()).filter(Boolean).slice(0, 25);
      if (offerIds.length === 0) {
        setTemplateClassError("No offers to classify.");
        return;
      }

      const res = await fetch("/api/plan-engine/estimate-set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offerIds, monthsCount: 12 }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setTemplateClassError(json?.error ? String(json.error) : `http_${res.status}`);
        return;
      }

      const results = Array.isArray(json?.results) ? json.results : [];
      const typeMap: Record<string, OfferPrimaryType> = {};
      const flagsMap: Record<string, string[]> = {};
      const reasonMap: Record<string, string> = {};
      for (const r of results) {
        const id = String(r?.offerId ?? "").trim();
        if (!id) continue;
        const tf = deriveTypeAndFlagsFromTemplateResult(r);
        typeMap[id] = tf.type;
        flagsMap[id] = tf.flags;
        const est = r?.estimate ?? {};
        reasonMap[id] = String(est?.reason ?? "");
      }

      setTemplateTypeByOfferId(typeMap);
      setTemplateFlagsByOfferId(flagsMap);
      setTemplateReasonByOfferId(reasonMap);
      setExtractStatus(`Classified ${Object.keys(typeMap).length} offers from templates.`);
    } catch (e: any) {
      setTemplateClassError(e?.message ?? String(e));
    } finally {
      setTemplateClassifying(false);
    }
  }, [offersList]);

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
          estimateMode: approxIndexed ? "INDEXED_EFL_ANCHOR_APPROX" : "DEFAULT",
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
  }, [offerIds, monthsCountClamped, backfill, approxIndexed]);

  const rows = Array.isArray(rawJson?.results) ? rawJson.results : [];

  function classifyOffer(o: any): 'fixed' | 'tou' | 'free-weekends' | 'free-nights' | 'variable' | 'other' {
    const od = o?.offer_data ?? {};
    const name = String(o?.offer_name ?? od?.offer_name ?? od?.name ?? '').toLowerCase();
    const supplier = String(od?.supplier ?? od?.supplier_name ?? '').toLowerCase();
    const productType = String(od?.product_type ?? od?.productType ?? '').toLowerCase();
    const planType = String(od?.plan_type ?? od?.planType ?? od?.rate_type ?? od?.rateType ?? '').toLowerCase();
    const hay = `${name} ${supplier} ${productType} ${planType}`;

    if (hay.includes('free weekend')) return 'free-weekends';
    if (hay.includes('free night')) return 'free-nights';
    if (hay.includes('tou') || hay.includes('time of use') || hay.includes('time-of-use')) return 'tou';
    if (productType.includes('fixed') || planType.includes('fixed') || hay.includes('fixed rate') || hay.includes('fixed-rate')) return 'fixed';
    if (productType.includes('variable') || planType.includes('variable') || hay.includes('variable rate') || hay.includes('variable-rate')) return 'variable';
    return 'other';
  }

  function heuristicToPrimaryType(k: ReturnType<typeof classifyOffer>): OfferPrimaryType {
    if (k === "free-weekends") return "FREE_WEEKENDS";
    if (k === "free-nights") return "FREE_NIGHTS";
    if (k === "tou") return "TOU";
    if (k === "fixed") return "FIXED";
    if (k === "variable") return "INDEXED";
    return "OTHER";
  }

  function matchesOfferKindFilter(t: OfferPrimaryType): boolean {
    if (offerKind === "all") return true;
    if (offerKind === "fixed") return t === "FIXED";
    if (offerKind === "tou") return t === "TOU";
    if (offerKind === "free-weekends") return t === "FREE_WEEKENDS";
    if (offerKind === "free-nights") return t === "FREE_NIGHTS";
    if (offerKind === "variable") return t === "INDEXED" || t === "TIERED";
    return t === "OTHER";
  }

  const offersFiltered = offersList.filter((o: any) => {
    const id = String(o?.offer_id ?? '').trim();
    const t: OfferPrimaryType | null = id && templateTypeByOfferId[id] ? templateTypeByOfferId[id] : null;
    const fallback = heuristicToPrimaryType(classifyOffer(o));
    const primary = t ?? fallback;
    return matchesOfferKindFilter(primary);
  });
  const offerIdsFromFiltered = offersFiltered.map((o: any) => String(o?.offer_id ?? '').trim()).filter(Boolean);

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Plan Engine Lab</h1>
        <p className="text-sm text-gray-600">
          Run <code className="font-mono">POST /api/plan-engine/estimate-set</code> to estimate multiple offers (bucket-gated, fail-closed),
          with bounded auto-creation of monthly buckets from intervals (recommended).
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

        <div className="space-y-2 rounded border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">OfferId Finder</div>
              <div className="text-xs text-gray-500">Fetch live offers (WattBuy) and click to add their offerIds.</div>
            </div>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" checked={lookupMode === 'address'} onChange={() => setLookupMode('address')} />
                Address
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" checked={lookupMode === 'wattkey'} onChange={() => setLookupMode('wattkey')} />
                Wattkey
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700">Offer type</span>
              <select className="border px-2 py-2 rounded text-sm" value={offerKind} onChange={(e) => setOfferKind(e.target.value as any)}>
                <option value="all">All</option>
                <option value="fixed">Fixed</option>
                <option value="tou">TOU</option>
                <option value="free-weekends">Free Weekends</option>
                <option value="free-nights">Free Nights</option>
                <option value="variable">Variable</option>
                <option value="other">Other</option>
              </select>
            </label>
            {offersList.length > 0 ? (
              <div className="text-xs text-gray-500">
                Showing {offersFiltered.length} of {offersList.length} fetched offers.
              </div>
            ) : null}
          </div>

          {lookupMode === 'address' ? (
            <div className="grid md:grid-cols-6 gap-3">
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold mb-1 text-gray-700">Street</label>
                <input className="w-full border px-3 py-2 rounded" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold mb-1 text-gray-700">City</label>
                <input className="w-full border px-3 py-2 rounded" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="md:col-span-1">
                <label className="block text-xs font-semibold mb-1 text-gray-700">State</label>
                <input className="w-full border px-3 py-2 rounded" value={state} onChange={(e) => setState(e.target.value)} maxLength={2} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold mb-1 text-gray-700">ZIP</label>
                <input className="w-full border px-3 py-2 rounded" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-700">Wattkey</label>
                <input className="w-full border px-3 py-2 rounded" value={wattkey} onChange={(e) => setWattkey(e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={fetchOffers}
              disabled={offersLoading}
              className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {offersLoading ? 'Fetching…' : 'Fetch offers'}
            </button>
            <button
              type="button"
              onClick={classifyOffersFromTemplates}
              disabled={templateClassifying || offersList.length === 0}
              className="px-4 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Uses our stored RatePlan templates via /api/plan-engine/estimate-set to classify offers (up to 25)."
            >
              {templateClassifying ? 'Classifying…' : 'Classify from templates'}
            </button>
            {offersError ? <div className="text-sm text-red-600">{offersError}</div> : null}
            {templateClassError ? <div className="text-sm text-red-600">{templateClassError}</div> : null}
            {offersFiltered.length > 0 ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => addOfferIdsToTextarea(offerIdsFromFiltered, 'replace')}
                  className="px-3 py-2 rounded bg-black text-white hover:bg-gray-800"
                >
                  Use filtered offerIds
                </button>
                <button
                  type="button"
                  onClick={() => addOfferIdsToTextarea(offerIdsFromFiltered, 'append')}
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
                >
                  Append filtered
                </button>
              </div>
            ) : null}
          </div>

          {offersFiltered.length > 0 ? (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="p-2">offer_id</th>
                    <th className="p-2">type</th>
                    <th className="p-2">flags</th>
                    <th className="p-2">supplier</th>
                    <th className="p-2">plan</th>
                    <th className="p-2">term</th>
                    <th className="p-2">¢/kWh</th>
                    <th className="p-2">add</th>
                    <th className="p-2">details</th>
                  </tr>
                </thead>
                <tbody>
                  {offersFiltered.slice(0, 50).map((o: any, idx: number) => {
                    const offerId = String(o?.offer_id ?? '').trim();
                    const od = o?.offer_data ?? {};
                    const primaryType = offerId && templateTypeByOfferId[offerId] ? templateTypeByOfferId[offerId] : heuristicToPrimaryType(classifyOffer(o));
                    const isHeuristic = !(offerId && templateTypeByOfferId[offerId]);
                    const reason = offerId && templateReasonByOfferId[offerId] ? templateReasonByOfferId[offerId] : "";
                    const flags = offerId && templateFlagsByOfferId[offerId] ? templateFlagsByOfferId[offerId] : [];
                    const flagsWithFallback = Array.from(new Set([...(flags ?? []), ...(isHeuristic ? ["HEURISTIC"] : [])]));
                    const supplier = String(od?.supplier ?? od?.supplier_name ?? '').trim();
                    const plan = String(o?.offer_name ?? od?.offer_name ?? od?.name ?? '').trim();
                    const term = od?.term ?? od?.term_months ?? null;
                    const cost = o?.cost ?? od?.cost ?? null;
                    return (
                      <tr key={offerId || idx} className="border-t border-gray-200">
                        <td className="p-2 font-mono break-all">{offerId}</td>
                        <td className="p-2 font-mono text-[11px]" title={reason}>{String(primaryType)}</td>
                        <td
                          className="p-2 font-mono text-[11px] max-w-[220px] truncate"
                          title={flagsWithFallback.join(",")}
                        >
                          {flagsWithFallback.join(",")}
                        </td>
                        <td className="p-2">{supplier}</td>
                        <td className="p-2">{plan}</td>
                        <td className="p-2 font-mono">{term != null ? String(term) : ''}</td>
                        <td className="p-2 font-mono">{cost != null ? String(cost) : ''}</td>
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => addOfferIdsToTextarea([offerId].filter(Boolean), 'append')}
                            className="px-2 py-1 rounded bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-60"
                            disabled={!offerId}
                          >
                            Add
                          </button>
                        </td>
                        <td className="p-2">
                          {offerId ? (
                            <a
                              className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                              href={`/admin/plans/${encodeURIComponent(offerId)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Details
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {offersFiltered.length > 50 ? (
                <div className="p-2 text-xs text-gray-500">Showing first 50 offers (filtered {offersFiltered.length}).</div>
              ) : null}
            </div>
          ) : null}

          {offersRaw ? (
            <details className="text-xs text-gray-700">
              <summary className="cursor-pointer select-none">Raw offers response (debug)</summary>
              <pre className="mt-2 bg-gray-100 p-3 rounded whitespace-pre-wrap">{JSON.stringify(offersRaw, null, 2)}</pre>
            </details>
          ) : null}
        </div>

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
            <span className="text-sm font-semibold text-gray-800">Auto-create monthly buckets (recommended)</span>
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={approxIndexed} onChange={(e) => setApproxIndexed(e.target.checked)} />
            <span className="text-sm font-semibold text-gray-800">Approx Indexed via EFL anchors</span>
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
              <th className="p-2">type</th>
              <th className="p-2">estimate.status</th>
              <th className="p-2">estimate.reason</th>
              <th className="p-2">backfill.ok</th>
              <th className="p-2">missingKeysAfter</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-2 text-gray-500" colSpan={6}>
                  No results yet.
                </td>
              </tr>
            ) : (
              rows.map((r: any, idx: number) => {
                const tf = deriveTypeAndFlagsFromTemplateResult(r);
                return (
                  <tr key={r?.offerId ?? idx} className="border-t border-gray-200">
                    <td className="p-2 font-mono text-xs break-all">
                      {r?.offerId ? (
                        <a className="underline" href={`/admin/plans/${encodeURIComponent(String(r.offerId))}`} target="_blank" rel="noreferrer">
                          {String(r?.offerId ?? '')}
                        </a>
                      ) : (
                        String(r?.offerId ?? "")
                      )}
                    </td>
                    <td className="p-2 font-mono text-xs" title={(tf.flags ?? []).join(",")}>{String(tf.type)}</td>
                    <td className="p-2 font-mono text-xs">{String(r?.estimate?.status ?? r?.estimate?.statusLabel ?? '')}</td>
                    <td className="p-2 font-mono text-xs break-all">{String(r?.estimate?.reason ?? r?.error ?? '')}</td>
                    <td className="p-2 font-mono text-xs">{String(Boolean(r?.backfill?.ok))}</td>
                    <td className="p-2 font-mono text-xs">{String(r?.backfill?.missingKeysAfter ?? '')}</td>
                  </tr>
                );
              })
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
