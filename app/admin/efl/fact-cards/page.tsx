"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ManualFactCardLoader } from "@/components/admin/ManualFactCardLoader";

type Json = any;

function useLocalToken(key = "iw_admin_token") {
  const [token, setToken] = useState("");
  useEffect(() => {
    try {
      setToken(localStorage.getItem(key) || "");
    } catch {
      setToken("");
    }
  }, [key]);
  useEffect(() => {
    if (!token) return;
    try {
      localStorage.setItem(key, token);
    } catch {
      // ignore
    }
  }, [key, token]);
  return { token, setToken };
}

function pretty(x: Json) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function numOrNull(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type ProviderSource = "wattbuy";

type BatchRow = {
  offerId: string | null;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  tdspName: string | null;
  eflUrl: string | null;
  eflPdfSha256: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  validationStatus: string | null;
  finalValidationStatus?: string | null;
  parseConfidence: number | null;
  templateAction: string;
  queueReason?: string | null;
  finalQueueReason?: string | null;
  notes?: string | null;
};

type QueueItem = any;
type TemplateRow = any;

export default function FactCardOpsPage() {
  const { token, setToken } = useLocalToken();
  const ready = useMemo(() => Boolean(token), [token]);

  // Manual loader is rendered at the bottom; we prefill it from Queue/Templates/Batch via this state.
  const [manualPrefillUrl, setManualPrefillUrl] = useState("");
  const manualRef = useRef<HTMLDivElement | null>(null);

  function loadIntoManual(args: { eflUrl?: string | null }) {
    const u = (args.eflUrl ?? "").trim();
    if (!u) return;
    setManualPrefillUrl(u);
    setTimeout(() => {
      manualRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // ---------------- Provider batch runner (WattBuy today; future sources later) ----------------
  const [source, setSource] = useState<ProviderSource>("wattbuy");
  const [address, setAddress] = useState("9514 Santa Paula Dr");
  const [city, setCity] = useState("Fort Worth");
  const [state, setState] = useState("tx");
  const [zip, setZip] = useState("76116");
  const [wattkey, setWattkey] = useState("");

  const [offerLimit, setOfferLimit] = useState(500);
  const [startIndex, setStartIndex] = useState(0);
  const [runAll, setRunAll] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [forceReparseTemplates, setForceReparseTemplates] = useState(false);

  const [batchLoading, setBatchLoading] = useState(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const [batchRows, setBatchRows] = useState<BatchRow[] | null>(null);
  const [batchRaw, setBatchRaw] = useState<Json | null>(null);

  async function runBatch() {
    if (!token) {
      alert("Need admin token");
      return;
    }
    if (source !== "wattbuy") {
      alert("Only WattBuy source is implemented right now.");
      return;
    }

    const a = address.trim();
    const c = city.trim();
    const s = state.trim();
    const z = zip.trim();
    if (!a || !c || !s || !z) {
      alert("Provide full address (address, city, state, zip).");
      return;
    }

    setBatchLoading(true);
    setBatchNote(null);
    setBatchRows(null);
    setBatchRaw(null);

    const all: BatchRow[] = [];
    let next = startIndex;

    try {
      while (true) {
        const body = {
          address: { line1: a, city: c, state: s, zip: z },
          offerLimit,
          startIndex: next,
          // Secondary cap; primary safety is timeBudgetMs in the API
          processLimit: 500,
          timeBudgetMs: 240_000,
          dryRun,
          mode: dryRun ? "DRY_RUN" : "STORE_TEMPLATES_ON_PASS",
          forceReparseTemplates,
        };

        const res = await fetch("/api/admin/wattbuy/offers-batch-efl-parse", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify(body),
        });

        const data = await res.json();
        setBatchRaw(data);
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }

        const rows = Array.isArray(data.results) ? (data.results as BatchRow[]) : [];
        all.push(...rows);
        setBatchRows([...all]);

        if (typeof data.nextStartIndex === "number" && Number.isFinite(data.nextStartIndex)) {
          next = data.nextStartIndex;
          setStartIndex(next);
        }

        setBatchNote(
          [
            `Processed ${data.processedCount} EFLs (scanned ${data.scannedCount ?? data.processedCount} offers).`,
            data.truncated ? `Continuing… nextStartIndex=${data.nextStartIndex}.` : "Done.",
            forceReparseTemplates ? "forceReparseTemplates=true" : null,
            dryRun ? "DRY_RUN (no writes)" : "STORE_TEMPLATES_ON_PASS",
          ]
            .filter(Boolean)
            .join(" "),
        );

        if (!runAll) break;
        if (!data.truncated) break;
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (e: any) {
      setBatchNote(e?.message || "Batch failed.");
    } finally {
      setBatchLoading(false);
    }
  }

  // ---------------- EFL Probe (WattBuy -> EFL Engine) ----------------
  const [probeMode, setProbeMode] = useState<"test" | "live">("test");
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeRaw, setProbeRaw] = useState<Json | null>(null);
  const [probeNote, setProbeNote] = useState<string | null>(null);

  async function runProbe() {
    if (!token) {
      alert("Need admin token");
      return;
    }
    setProbeLoading(true);
    setProbeRaw(null);
    setProbeNote(null);
    try {
      const body: any = { mode: probeMode };
      if (wattkey.trim()) body.wattkey = wattkey.trim();
      else {
        body.address = address.trim();
        body.city = city.trim();
        body.state = state.trim();
        body.zip = zip.trim();
      }
      const res = await fetch("/api/admin/wattbuy/efl-probe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setProbeRaw(data);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setProbeNote("Probe complete. See Raw Output.");
    } catch (e: any) {
      setProbeNote(e?.message || "Probe failed.");
    } finally {
      setProbeLoading(false);
    }
  }

  // ---------------- Review Queue ----------------
  const [queueStatus, setQueueStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const [queueQ, setQueueQ] = useState("");
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueErr, setQueueErr] = useState<string | null>(null);

  async function loadQueue() {
    if (!token) {
      setQueueErr("Admin token required.");
      return;
    }
    setQueueLoading(true);
    setQueueErr(null);
    try {
      const params = new URLSearchParams({ status: queueStatus, limit: "200" });
      if (queueQ.trim()) params.set("q", queueQ.trim());
      const res = await fetch(`/api/admin/efl-review/list?${params.toString()}`, {
        headers: { "x-admin-token": token },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setQueueItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      setQueueErr(e?.message || "Failed to load queue.");
    } finally {
      setQueueLoading(false);
    }
  }

  async function resolveQueueItem(id: string) {
    if (!token) return;
    try {
      const res = await fetch("/api/admin/efl-review/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await loadQueue();
    } catch (e: any) {
      setQueueErr(e?.message || "Failed to resolve.");
    }
  }

  useEffect(() => {
    if (ready) void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, queueStatus]);

  // ---------------- Templates ----------------
  const [tplQ, setTplQ] = useState("");
  const [tplLimit, setTplLimit] = useState(200);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplErr, setTplErr] = useState<string | null>(null);
  const [tplRows, setTplRows] = useState<TemplateRow[]>([]);

  async function loadTemplates() {
    if (!token) {
      setTplErr("Admin token required.");
      return;
    }
    setTplLoading(true);
    setTplErr(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(tplLimit));
      if (tplQ.trim()) params.set("q", tplQ.trim());
      const res = await fetch(`/api/admin/wattbuy/templated-plans?${params.toString()}`, {
        headers: { "x-admin-token": token },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setTplRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e: any) {
      setTplErr(e?.message || "Failed to load templates.");
    } finally {
      setTplLoading(false);
    }
  }

  useEffect(() => {
    if (ready) void loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Fact Card Parsing Ops</h1>
        <div className="text-xs text-gray-600">
          One page for: provider batch parsing → review queue → templates → manual loader (URL / upload / text).
        </div>
      </header>

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="block text-sm mb-1">x-admin-token</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="paste admin token"
            />
          </div>
          <div className="min-w-[180px]">
            <label className="block text-sm mb-1">Source</label>
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={source}
              onChange={(e) => setSource(e.target.value as ProviderSource)}
            >
              <option value="wattbuy">WattBuy (implemented)</option>
            </select>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <h2 className="font-medium">Provider Batch Parser (safe auto-chunk)</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Address</label>
              <input className="w-full rounded-lg border px-3 py-2" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">City</label>
              <input className="w-full rounded-lg border px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">State</label>
              <input className="w-full rounded-lg border px-3 py-2" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">ZIP</label>
              <input className="w-full rounded-lg border px-3 py-2" value={zip} onChange={(e) => setZip(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">Offer limit</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                type="number"
                min={1}
                max={500}
                value={offerLimit}
                onChange={(e) => setOfferLimit(Math.max(1, Math.min(500, numOrNull(e.target.value) ?? 500)))}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              Dry run (no templates)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={runAll} onChange={(e) => setRunAll(e.target.checked)} />
              Run all (auto-continue)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={forceReparseTemplates}
                onChange={(e) => setForceReparseTemplates(e.target.checked)}
                disabled={dryRun}
              />
              Overwrite existing templates (force reparse)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600">Start index</span>
              <input
                className="w-24 rounded border px-2 py-1 text-xs"
                type="number"
                min={0}
                value={startIndex}
                onChange={(e) => setStartIndex(Math.max(0, numOrNull(e.target.value) ?? 0))}
              />
            </div>
          </div>

          <button
            className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60"
            onClick={() => void runBatch()}
            disabled={!ready || batchLoading}
          >
            {batchLoading ? "Running…" : "Run batch parse (safe)"}
          </button>

          {batchNote ? <div className="text-xs text-gray-700">{batchNote}</div> : null}
          {batchRows?.length ? (
            <div className="text-xs text-gray-600">
              Rows: <span className="font-mono">{batchRows.length}</span>. Tip: click “Load” on any row to prefill the manual loader.
            </div>
          ) : null}

          {batchRows?.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="px-2 py-2 text-left">Supplier</th>
                    <th className="px-2 py-2 text-left">Plan</th>
                    <th className="px-2 py-2 text-left">EFL</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Template</th>
                    <th className="px-2 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.slice(0, 100).map((r, idx) => {
                    const eflUrl = (r.eflUrl ?? "").trim();
                    const status = r.finalValidationStatus ?? r.validationStatus ?? "-";
                    return (
                      <tr key={`${r.offerId ?? "offer"}:${idx}`} className="border-t">
                        <td className="px-2 py-2">{r.supplier ?? "-"}</td>
                        <td className="px-2 py-2">{r.planName ?? "-"}</td>
                        <td className="px-2 py-2 max-w-[260px] truncate" title={eflUrl}>
                          {eflUrl || "—"}
                        </td>
                        <td className="px-2 py-2">{status}</td>
                        <td className="px-2 py-2">{r.templateAction ?? "-"}</td>
                        <td className="px-2 py-2">
                          <button
                            className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-60"
                            disabled={!eflUrl}
                            onClick={() => loadIntoManual({ eflUrl })}
                          >
                            Load
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {batchRows.length > 100 ? (
                <div className="px-3 py-2 text-xs text-gray-600">
                  Showing first 100 rows (total {batchRows.length}).
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <h2 className="font-medium">EFL PlanRules Probe (WattBuy → EFL Engine)</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">wattkey (optional)</label>
              <input className="w-full rounded-lg border px-3 py-2" value={wattkey} onChange={(e) => setWattkey(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">Mode</label>
              <select className="w-full rounded-lg border px-3 py-2" value={probeMode} onChange={(e) => setProbeMode(e.target.value as any)}>
                <option value="test">test (no DB writes)</option>
                <option value="live">live (best-effort)</option>
              </select>
            </div>
          </div>
          <button
            className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60"
            onClick={() => void runProbe()}
            disabled={!ready || probeLoading}
          >
            {probeLoading ? "Running…" : "Run EFL probe"}
          </button>
          {probeNote ? <div className="text-xs text-gray-700">{probeNote}</div> : null}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">EFL Parse Review Queue</h2>
          <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void loadQueue()} disabled={!ready || queueLoading}>
            {queueLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={queueStatus === "OPEN"} onChange={() => setQueueStatus("OPEN")} /> Open
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={queueStatus === "RESOLVED"} onChange={() => setQueueStatus("RESOLVED")} /> Resolved
          </label>
          <input className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-sm" placeholder="Search supplier / plan / offer / sha / version" value={queueQ} onChange={(e) => setQueueQ(e.target.value)} />
          <button className="px-3 py-2 rounded-lg border hover:bg-gray-50" onClick={() => void loadQueue()} disabled={!ready || queueLoading}>
            Apply
          </button>
        </div>
        {queueErr ? <div className="text-sm text-red-700">{queueErr}</div> : null}

        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="px-2 py-2 text-left">Supplier</th>
                <th className="px-2 py-2 text-left">Plan</th>
                <th className="px-2 py-2 text-left">Offer</th>
                <th className="px-2 py-2 text-left">Ver</th>
                <th className="px-2 py-2 text-left">Reason</th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queueItems.map((it: any) => {
                const eflUrl = (it?.eflUrl ?? "").trim();
                return (
                  <tr key={it.id} className="border-t">
                    <td className="px-2 py-2">{it.supplier ?? "-"}</td>
                    <td className="px-2 py-2">{it.planName ?? "-"}</td>
                    <td className="px-2 py-2">{it.offerId ?? "-"}</td>
                    <td className="px-2 py-2">{it.eflVersionCode ?? "-"}</td>
                    <td className="px-2 py-2 max-w-[420px] truncate" title={it.queueReason ?? ""}>
                      {it.queueReason ?? "-"}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-60"
                          disabled={!eflUrl}
                          onClick={() => loadIntoManual({ eflUrl })}
                        >
                          Load
                        </button>
                        {queueStatus === "OPEN" ? (
                          <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => void resolveQueueItem(String(it.id))}>
                            Resolve
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {queueItems.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={6}>
                    No items.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Templates (RatePlan.rateStructure stored)</h2>
          <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void loadTemplates()} disabled={!ready || tplLoading}>
            {tplLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-sm" placeholder="Search supplier / plan / cert / version / sha…" value={tplQ} onChange={(e) => setTplQ(e.target.value)} />
          <input className="w-28 rounded-lg border px-3 py-2 text-sm" type="number" min={1} max={1000} value={tplLimit} onChange={(e) => setTplLimit(Math.max(1, Math.min(1000, numOrNull(e.target.value) ?? 200)))} />
          <button className="px-3 py-2 rounded-lg border hover:bg-gray-50" onClick={() => void loadTemplates()} disabled={!ready || tplLoading}>
            Apply
          </button>
        </div>
        {tplErr ? <div className="text-sm text-red-700">{tplErr}</div> : null}

        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="px-2 py-2 text-left">Supplier</th>
                <th className="px-2 py-2 text-left">Plan</th>
                <th className="px-2 py-2 text-right">Term</th>
                <th className="px-2 py-2 text-right">500</th>
                <th className="px-2 py-2 text-right">1000</th>
                <th className="px-2 py-2 text-right">2000</th>
                <th className="px-2 py-2 text-left">Ver</th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tplRows.map((r: any) => {
                const eflUrl = (r?.eflUrl ?? "").trim();
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-2">{r.supplier ?? "-"}</td>
                    <td className="px-2 py-2">{r.planName ?? "-"}</td>
                    <td className="px-2 py-2 text-right">{typeof r.termMonths === "number" ? `${r.termMonths} mo` : "-"}</td>
                    <td className="px-2 py-2 text-right">{typeof r.rate500 === "number" ? r.rate500.toFixed(3) : "—"}</td>
                    <td className="px-2 py-2 text-right">{typeof r.rate1000 === "number" ? r.rate1000.toFixed(3) : "—"}</td>
                    <td className="px-2 py-2 text-right">{typeof r.rate2000 === "number" ? r.rate2000.toFixed(3) : "—"}</td>
                    <td className="px-2 py-2">{r.eflVersionCode ?? "-"}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-60" disabled={!eflUrl} onClick={() => loadIntoManual({ eflUrl })}>
                          Load
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {tplRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={8}>
                    No templates.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <h2 className="font-medium">Raw Output (last run)</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-xs text-gray-600 mb-1">Probe raw</div>
            <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-72">{probeRaw ? pretty(probeRaw) : "—"}</pre>
          </div>
          <div>
            <div className="text-xs text-gray-600 mb-1">Batch raw (last chunk)</div>
            <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-72">{batchRaw ? pretty(batchRaw) : "—"}</pre>
          </div>
        </div>
      </section>

      {/* Manual loader lives at the bottom (per ops workflow) */}
      <section ref={manualRef} className="rounded-2xl border bg-white p-4">
        <ManualFactCardLoader adminToken={token} prefillEflUrl={manualPrefillUrl} />
      </section>
    </div>
  );
}


