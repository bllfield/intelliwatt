"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ManualFactCardLoader } from "@/components/admin/ManualFactCardLoader";

type Json = any;
type SortDir = "asc" | "desc";

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

function normStr(x: any): string {
  return String(x ?? "").trim();
}

function makeIdentityKeys(x: {
  offerId?: any;
  eflUrl?: any;
  eflPdfSha256?: any;
  repPuctCertificate?: any;
  eflVersionCode?: any;
}): string[] {
  const keys: string[] = [];
  const offerId = normStr(x.offerId);
  const url = normStr(x.eflUrl);
  const sha = normStr(x.eflPdfSha256);
  const cert = normStr(x.repPuctCertificate);
  const ver = normStr(x.eflVersionCode);
  if (offerId) keys.push(`offer:${offerId}`);
  if (sha) keys.push(`sha:${sha}`);
  if (url) keys.push(`url:${url}`);
  if (cert && ver) keys.push(`cv:${cert}::${ver}`);
  return keys;
}

function cmp(a: any, b: any, dir: SortDir): number {
  const d = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1 * d;
  if (b == null) return -1 * d;
  if (typeof a === "number" && typeof b === "number") return (a - b) * d;
  return String(a).localeCompare(String(b)) * d;
}

export default function FactCardOpsPage() {
  const { token, setToken } = useLocalToken();
  const ready = useMemo(() => Boolean(token), [token]);

  // Manual loader is rendered at the bottom; we prefill it from Queue/Templates/Batch via this state.
  const [manualPrefillUrl, setManualPrefillUrl] = useState("");
  const [manualPrefillOfferId, setManualPrefillOfferId] = useState<string>("");
  const manualRef = useRef<HTMLDivElement | null>(null);

  function loadIntoManual(args: { eflUrl?: string | null; offerId?: string | null }) {
    const u = (args.eflUrl ?? "").trim();
    if (!u) return;
    setManualPrefillUrl(u);
    setManualPrefillOfferId((args.offerId ?? "").trim());
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
    // Always start from the beginning. Chunking/continuation is handled automatically
    // via nextStartIndex returned from the API when runAll=true.
    let next = 0;

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
  const [queueTotalCount, setQueueTotalCount] = useState<number | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueErr, setQueueErr] = useState<string | null>(null);
  const [queueProcessLoading, setQueueProcessLoading] = useState(false);
  const [queueProcessNote, setQueueProcessNote] = useState<string | null>(null);
  const [queueSortKey, setQueueSortKey] = useState<
    "supplier" | "planName" | "offerId" | "eflVersionCode" | "queueReason"
  >("supplier");
  const [queueSortDir, setQueueSortDir] = useState<SortDir>("asc");

  async function loadQueue() {
    if (!token) {
      setQueueErr("Admin token required.");
      return;
    }
    setQueueLoading(true);
    setQueueErr(null);
    try {
      const params = new URLSearchParams({ status: queueStatus, limit: "200" });
      // Keep the OPEN queue self-healing: if a template already exists, the list API
      // can auto-resolve the queue row so admins only see true attention-needed items.
      if (queueStatus === "OPEN") params.set("autoResolve", "1");
      if (queueQ.trim()) params.set("q", queueQ.trim());
      const res = await fetch(`/api/admin/efl-review/list?${params.toString()}`, {
        headers: { "x-admin-token": token },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setQueueItems(Array.isArray(data.items) ? data.items : []);
      setQueueTotalCount(
        typeof data.totalCount === "number" && Number.isFinite(data.totalCount)
          ? data.totalCount
          : null,
      );
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

  async function processOpenQueue() {
    if (!token) {
      setQueueErr("Admin token required.");
      return;
    }
    if (queueStatus !== "OPEN") {
      setQueueErr("Switch to Open queue status first.");
      return;
    }
    setQueueProcessLoading(true);
    setQueueProcessNote(null);
    setQueueErr(null);
    try {
      let cursor: string | null = null;
      let totalProcessed = 0;
      let totalPersisted = 0;
      let totalResolved = 0;
      let totalFetchFailed = 0;

      while (true) {
        const res: Response = await fetch("/api/admin/efl-review/process-open", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify({
            cursor,
            limit: 50,
            timeBudgetMs: 240_000,
            dryRun: false,
            forceReparseTemplates,
          }),
        });
        const data: any = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

        totalProcessed += Number(data.processed ?? 0) || 0;
        totalPersisted += Number(data.persisted ?? 0) || 0;
        totalResolved += Number(data.resolved ?? 0) || 0;
        totalFetchFailed += Number(data.fetchFailed ?? 0) || 0;

        setQueueProcessNote(
          `Processed ${totalProcessed}. Persisted ${totalPersisted}. Resolved ${totalResolved}. Fetch failed ${totalFetchFailed}.` +
            (data.truncated ? " Continuing…" : " Done."),
        );

        cursor =
          typeof data.nextCursor === "string" && data.nextCursor.trim()
            ? data.nextCursor
            : null;
        if (!data.truncated || !cursor) break;
        await new Promise((r) => setTimeout(r, 150));
      }

      await loadQueue();
      await loadTemplates();
    } catch (e: any) {
      setQueueErr(e?.message || "Failed to process open queue.");
    } finally {
      setQueueProcessLoading(false);
    }
  }

  useEffect(() => {
    if (ready) void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, queueStatus]);

  const sortedQueueItems = useMemo(() => {
    const out = [...queueItems];
    out.sort((a: any, b: any) => {
      const av =
        queueSortKey === "supplier"
          ? a?.supplier
          : queueSortKey === "planName"
            ? a?.planName
            : queueSortKey === "offerId"
              ? a?.offerId
              : queueSortKey === "eflVersionCode"
                ? a?.eflVersionCode
                : a?.queueReason;
      const bv =
        queueSortKey === "supplier"
          ? b?.supplier
          : queueSortKey === "planName"
            ? b?.planName
            : queueSortKey === "offerId"
              ? b?.offerId
              : queueSortKey === "eflVersionCode"
                ? b?.eflVersionCode
                : b?.queueReason;
      return cmp(av ?? null, bv ?? null, queueSortDir);
    });
    return out;
  }, [queueItems, queueSortKey, queueSortDir]);

  function toggleQueueSort(k: typeof queueSortKey) {
    if (queueSortKey === k) {
      setQueueSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setQueueSortKey(k);
      setQueueSortDir("asc");
    }
  }

  // ---------------- Templates ----------------
  const [tplQ, setTplQ] = useState("");
  const [tplLimit, setTplLimit] = useState(200);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplErr, setTplErr] = useState<string | null>(null);
  const [tplRows, setTplRows] = useState<TemplateRow[]>([]);
  const [tplTotalCount, setTplTotalCount] = useState<number | null>(null);
  const [tplSortKey, setTplSortKey] = useState<
    "utilityId" | "supplier" | "planName" | "termMonths" | "rate500" | "rate1000" | "rate2000" | "eflVersionCode"
  >("supplier");
  const [tplSortDir, setTplSortDir] = useState<SortDir>("asc");

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
      setTplTotalCount(
        typeof data.totalCount === "number" && Number.isFinite(data.totalCount)
          ? data.totalCount
          : null,
      );
    } catch (e: any) {
      setTplErr(e?.message || "Failed to load templates.");
    } finally {
      setTplLoading(false);
    }
  }

  async function invalidateTemplate(id: string) {
    if (!token) {
      setTplErr("Admin token required.");
      return;
    }
    const ok = window.confirm(
      "Invalidate this template?\n\nThis will remove RatePlan.rateStructure (so it disappears from Templates) and mark it as requires manual review.",
    );
    if (!ok) return;
    try {
      const res = await fetch("/api/admin/efl/templates/invalidate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await loadTemplates();
    } catch (e: any) {
      setTplErr(e?.message || "Failed to invalidate template.");
    }
  }

  async function cleanupInvalidTemplates() {
    if (!token) {
      setTplErr("Admin token required.");
      return;
    }
    const ok = window.confirm(
      "Invalidate ALL templates that are missing supplier/planName/termMonths/eflVersionCode?\n\nRecommended: run this on Preview, not Production.",
    );
    if (!ok) return;
    try {
      const res = await fetch("/api/admin/efl/templates/cleanup-invalid", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ dryRun: false }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await loadTemplates();
    } catch (e: any) {
      setTplErr(e?.message || "Failed to cleanup invalid templates.");
    }
  }

  async function invalidateAllTemplates() {
    if (!token) {
      setTplErr("Admin token required.");
      return;
    }
    const phrase = window.prompt(
      'DANGER: This will invalidate ALL templates (clear rateStructure) so they must be re-parsed.\n\nType INVALIDATE_ALL_TEMPLATES to proceed.',
    );
    if (!phrase) return;
    try {
      const res = await fetch("/api/admin/efl/templates/invalidate-all", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ confirm: phrase }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await loadTemplates();
    } catch (e: any) {
      setTplErr(e?.message || "Failed to invalidate all templates.");
    }
  }

  useEffect(() => {
    if (ready) void loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const sortedTplRows = useMemo(() => {
    const out = [...tplRows];
    out.sort((a: any, b: any) => {
      const av =
        tplSortKey === "utilityId"
          ? a?.utilityId
          : tplSortKey === "supplier"
            ? a?.supplier
          : tplSortKey === "planName"
            ? a?.planName
            : tplSortKey === "termMonths"
              ? typeof a?.termMonths === "number"
                ? a.termMonths
                : null
              : tplSortKey === "rate500"
                ? typeof a?.rate500 === "number"
                  ? a.rate500
                  : null
                : tplSortKey === "rate1000"
                  ? typeof a?.rate1000 === "number"
                    ? a.rate1000
                    : null
                  : tplSortKey === "rate2000"
                    ? typeof a?.rate2000 === "number"
                      ? a.rate2000
                      : null
                    : a?.eflVersionCode;
      const bv =
        tplSortKey === "utilityId"
          ? b?.utilityId
          : tplSortKey === "supplier"
            ? b?.supplier
          : tplSortKey === "planName"
            ? b?.planName
            : tplSortKey === "termMonths"
              ? typeof b?.termMonths === "number"
                ? b.termMonths
                : null
              : tplSortKey === "rate500"
                ? typeof b?.rate500 === "number"
                  ? b.rate500
                  : null
                : tplSortKey === "rate1000"
                  ? typeof b?.rate1000 === "number"
                    ? b.rate1000
                    : null
                  : tplSortKey === "rate2000"
                    ? typeof b?.rate2000 === "number"
                      ? b.rate2000
                      : null
                    : b?.eflVersionCode;
      return cmp(av ?? null, bv ?? null, tplSortDir);
    });
    return out;
  }, [tplRows, tplSortKey, tplSortDir]);

  const reconciliation = useMemo(() => {
    const batch = Array.isArray(batchRows) ? batchRows : [];
    const queue = Array.isArray(queueItems) ? queueItems : [];
    const tpls = Array.isArray(tplRows) ? tplRows : [];

    const queueKeySet = new Set<string>();
    const tplKeySet = new Set<string>();

    for (const it of queue) {
      for (const k of makeIdentityKeys(it)) queueKeySet.add(k);
    }
    for (const it of tpls) {
      for (const k of makeIdentityKeys(it)) tplKeySet.add(k);
    }

    const missingFromBoth: Array<{
      offerId: string;
      supplier: string;
      planName: string;
      eflUrl: string;
      expectedBucket: "QUEUE" | "TEMPLATES";
      reason: string;
    }> = [];

    const inQueue = (r: BatchRow): boolean => makeIdentityKeys(r).some((k) => queueKeySet.has(k));
    const inTpl = (r: BatchRow): boolean => makeIdentityKeys(r).some((k) => tplKeySet.has(k));

    let accountedOffers = 0;
    for (const r of batch) {
      const offerId = normStr(r.offerId) || "—";
      const supplier = normStr(r.supplier) || "—";
      const planName = normStr(r.planName) || "—";
      const eflUrl = normStr(r.eflUrl) || "—";

      const status = normStr(r.finalValidationStatus ?? r.validationStatus) || "—";
      const templateAction = normStr(r.templateAction) || "—";
      const qReason = normStr(r.finalQueueReason ?? r.queueReason);

      const expectTemplates = templateAction === "CREATED" || templateAction === "TEMPLATE" || templateAction === "HIT";
      const expectQueue =
        !expectTemplates &&
        (status === "FAIL" ||
          status === "SKIP" ||
          // Any row with a queueReason is intended to be reviewable.
          Boolean(qReason));

      const foundTpl = inTpl(r);
      const foundQueue = inQueue(r);

      if (foundTpl || foundQueue) accountedOffers++;

      if (!foundTpl && !foundQueue && (expectTemplates || expectQueue)) {
        missingFromBoth.push({
          offerId,
          supplier,
          planName,
          eflUrl,
          expectedBucket: expectTemplates ? "TEMPLATES" : "QUEUE",
          reason:
            expectTemplates
              ? `Batch says templateAction=${templateAction} but template not visible in templates list.`
              : `Batch indicates review needed (status=${status}${qReason ? `, reason=${qReason}` : ""}) but item not visible in queue list.`,
        });
      }
    }

    // Detect duplicates in the OPEN queue by offerId (UI-level visibility).
    const dupOfferIds: Array<{ offerId: string; count: number }> = [];
    const counts = new Map<string, number>();
    for (const it of queue) {
      const oid = normStr(it?.offerId);
      if (!oid) continue;
      counts.set(oid, (counts.get(oid) ?? 0) + 1);
    }
    Array.from(counts.entries()).forEach(([offerId, count]) => {
      if (count > 1) dupOfferIds.push({ offerId, count });
    });

    return {
      batchCount: batch.length,
      queueCount: queue.length,
      templatesCount: tpls.length,
      accountedOffers,
      missingFromBoth,
      dupOfferIds,
    };
  }, [batchRows, queueItems, tplRows]);

  function toggleTplSort(k: typeof tplSortKey) {
    if (tplSortKey === k) {
      setTplSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTplSortKey(k);
      setTplSortDir("asc");
    }
  }

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
            <div className="rounded-xl border bg-gray-50 p-3 text-xs space-y-2">
              <div className="font-medium">Offer coverage (accounting)</div>
              <div className="text-gray-600">
                Note: <span className="font-mono">Templates rows</span> are unique stored templates, not a 1:1 list of offers.
                Coverage is computed by matching each batch row to either a queue row or a template (by offerId / sha / URL / cert+ver).
              </div>
              <div className="flex flex-wrap gap-3 text-gray-700">
                <div>
                  Batch rows: <span className="font-mono">{reconciliation.batchCount}</span>
                </div>
                <div>
                  Queue rows (visible): <span className="font-mono">{reconciliation.queueCount}</span>
                </div>
                <div>
                  Templates rows (visible): <span className="font-mono">{reconciliation.templatesCount}</span>
                </div>
                <div>
                  Offers accounted for:{" "}
                  <span className="font-mono">{reconciliation.accountedOffers}</span>
                </div>
                <div>
                  Missing (in neither):{" "}
                  <span className="font-mono">{reconciliation.missingFromBoth.length}</span>
                </div>
                <div>
                  Queue duplicates (by offerId):{" "}
                  <span className="font-mono">{reconciliation.dupOfferIds.length}</span>
                </div>
              </div>

              {reconciliation.missingFromBoth.length ? (
                <div className="overflow-x-auto rounded-lg border bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 text-gray-700">
                      <tr>
                        <th className="px-2 py-2 text-left">OfferId</th>
                        <th className="px-2 py-2 text-left">Supplier</th>
                        <th className="px-2 py-2 text-left">Plan</th>
                        <th className="px-2 py-2 text-left">Expected</th>
                        <th className="px-2 py-2 text-left">Reason</th>
                        <th className="px-2 py-2 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.missingFromBoth.slice(0, 20).map((m, idx) => (
                        <tr key={`${m.offerId}:${idx}`} className="border-t">
                          <td className="px-2 py-2 font-mono">{m.offerId}</td>
                          <td className="px-2 py-2">{m.supplier}</td>
                          <td className="px-2 py-2">{m.planName}</td>
                          <td className="px-2 py-2">{m.expectedBucket}</td>
                          <td className="px-2 py-2 max-w-[520px] truncate" title={m.reason}>
                            {m.reason}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-60"
                              disabled={!m.eflUrl || m.eflUrl === "—"}
                              onClick={() => loadIntoManual({ eflUrl: m.eflUrl === "—" ? "" : m.eflUrl, offerId: (m as any).offerId ?? null })}
                            >
                              Load
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reconciliation.missingFromBoth.length > 20 ? (
                    <div className="px-3 py-2 text-xs text-gray-600">
                      Showing first 20 missing rows (total {reconciliation.missingFromBoth.length}).
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-gray-700">No missing batch rows detected by current matching rules.</div>
              )}
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
                            onClick={() => loadIntoManual({ eflUrl, offerId: r.offerId ?? null })}
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
          <h2 className="font-medium">
            EFL Parse Review Queue{" "}
            <span className="text-xs text-gray-600">
              ({queueTotalCount ?? queueItems.length})
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void loadQueue()} disabled={!ready || queueLoading}>
              {queueLoading ? "Loading…" : "Refresh"}
            </button>
            <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void processOpenQueue()} disabled={!ready || queueLoading || queueProcessLoading || queueStatus !== "OPEN"}>
              {queueProcessLoading ? "Processing…" : "Process OPEN queue (auto)"}
            </button>
          </div>
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
        {queueProcessNote ? <div className="text-xs text-gray-700">{queueProcessNote}</div> : null}

        {/* ~5 visible rows + sticky header */}
        <div className="overflow-x-auto overflow-y-auto max-h-[280px] rounded-xl border">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
              <tr className="h-10">
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleQueueSort("supplier")}>
                  Supplier {queueSortKey === "supplier" ? (queueSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleQueueSort("planName")}>
                  Plan {queueSortKey === "planName" ? (queueSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleQueueSort("offerId")}>
                  Offer {queueSortKey === "offerId" ? (queueSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleQueueSort("eflVersionCode")}>
                  Ver {queueSortKey === "eflVersionCode" ? (queueSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleQueueSort("queueReason")}>
                  Reason {queueSortKey === "queueReason" ? (queueSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedQueueItems.map((it: any) => {
                const eflUrl = (it?.eflUrl ?? "").trim();
                return (
                  <tr key={it.id} className="border-t h-12">
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
                          onClick={() => loadIntoManual({ eflUrl, offerId: it.offerId ?? null })}
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
          <h2 className="font-medium">
            Templates (RatePlan.rateStructure stored){" "}
            <span className="text-xs text-gray-600">
              ({tplTotalCount ?? tplRows.length})
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void loadTemplates()} disabled={!ready || tplLoading}>
              {tplLoading ? "Loading…" : "Refresh"}
            </button>
            <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void cleanupInvalidTemplates()} disabled={!ready || tplLoading}>
              Cleanup missing fields
            </button>
            <button className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60" onClick={() => void invalidateAllTemplates()} disabled={!ready || tplLoading}>
              Invalidate ALL templates (danger)
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-sm" placeholder="Search supplier / plan / cert / version / sha…" value={tplQ} onChange={(e) => setTplQ(e.target.value)} />
          <input className="w-28 rounded-lg border px-3 py-2 text-sm" type="number" min={1} max={1000} value={tplLimit} onChange={(e) => setTplLimit(Math.max(1, Math.min(1000, numOrNull(e.target.value) ?? 200)))} />
          <button className="px-3 py-2 rounded-lg border hover:bg-gray-50" onClick={() => void loadTemplates()} disabled={!ready || tplLoading}>
            Apply
          </button>
        </div>
        {tplErr ? <div className="text-sm text-red-700">{tplErr}</div> : null}

        {/* ~5 visible rows + sticky header */}
        <div className="overflow-x-auto overflow-y-auto max-h-[280px] rounded-xl border">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
              <tr className="h-10">
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("utilityId")}>
                  Utility {tplSortKey === "utilityId" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("supplier")}>
                  Supplier {tplSortKey === "supplier" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("planName")}>
                  Plan {tplSortKey === "planName" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-right cursor-pointer select-none" onClick={() => toggleTplSort("termMonths")}>
                  Term {tplSortKey === "termMonths" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-right cursor-pointer select-none" onClick={() => toggleTplSort("rate500")}>
                  500 {tplSortKey === "rate500" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-right cursor-pointer select-none" onClick={() => toggleTplSort("rate1000")}>
                  1000 {tplSortKey === "rate1000" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-right cursor-pointer select-none" onClick={() => toggleTplSort("rate2000")}>
                  2000 {tplSortKey === "rate2000" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("eflVersionCode")}>
                  Ver {tplSortKey === "eflVersionCode" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedTplRows.map((r: any) => {
                const eflUrl = (r?.eflUrl ?? "").trim();
                return (
                  <tr key={r.id} className="border-t h-12">
                    <td className="px-2 py-2">{r.utilityId ?? "-"}</td>
                    <td className="px-2 py-2">{r.supplier ?? "-"}</td>
                    <td className="px-2 py-2">{r.planName ?? "-"}</td>
                    <td className="px-2 py-2 text-right">{typeof r.termMonths === "number" ? `${r.termMonths} mo` : "-"}</td>
                    <td className="px-2 py-2 text-right">{typeof r.rate500 === "number" ? r.rate500.toFixed(3) : "—"}</td>
                    <td className="px-2 py-2 text-right">{typeof r.rate1000 === "number" ? r.rate1000.toFixed(3) : "—"}</td>
                    <td className="px-2 py-2 text-right">{typeof r.rate2000 === "number" ? r.rate2000.toFixed(3) : "—"}</td>
                    <td className="px-2 py-2">{r.eflVersionCode ?? "-"}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-60" disabled={!eflUrl} onClick={() => loadIntoManual({ eflUrl, offerId: (r as any)?.offerId ?? null })}>
                          Load
                        </button>
                        <button className="px-2 py-1 rounded border hover:bg-red-50 text-red-700 border-red-200" onClick={() => void invalidateTemplate(String(r.id))}>
                          Invalidate
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {tplRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={9}>
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
        <ManualFactCardLoader adminToken={token} prefillEflUrl={manualPrefillUrl} prefillOfferId={manualPrefillOfferId} />
      </section>
    </div>
  );
}


