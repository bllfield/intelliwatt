"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ManualFactCardLoader } from "@/components/admin/ManualFactCardLoader";
import BackfillButton from "./BackfillButton";

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

type TerritoryPreset = {
  id: string;
  label: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
};

const TERRITORY_PRESETS: TerritoryPreset[] = [
  { id: "oncor_76108", label: "Oncor: 76108", line1: "", city: "", state: "tx", zip: "76108" },
  { id: "centerpoint_77373", label: "Centerpoint: 77373", line1: "", city: "", state: "tx", zip: "77373" },
  {
    id: "tnmp_lewisville_75067",
    label: "TNMP: 146 Valley View Dr, Apt 512, Lewisville, TX 75067",
    line1: "146 Valley View Dr, Apt 512",
    city: "Lewisville",
    state: "tx",
    zip: "75067",
  },
  { id: "aepcnt_78414", label: "AEPCNT: 78414", line1: "", city: "", state: "tx", zip: "78414" },
  { id: "aepnorth_79601", label: "AEP North: 79601", line1: "", city: "", state: "tx", zip: "79601" },
];

type BatchRow = {
  offerId: string | null;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  tdspName: string | null;
  tdspSlug?: string | null;
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
  planCalcStatus?: string | null;
  planCalcReasonCode?: string | null;
  requiredBucketKeys?: string[] | null;
  usagePreview?: any | null;
  usageEstimate?: any | null;
};

type QueueItem = any;
type TemplateRow = any;
type UnmappedTemplateRow = any;

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

function deriveTemplatePlanTypeLabel(r: any): string {
  const planTypeRaw = String(r?.planType ?? r?.planRules?.planType ?? "").trim();
  if (planTypeRaw) return planTypeRaw.toUpperCase().replace(/-/g, "_");

  const rateStructureTypeRaw = String(
    r?.rateStructureType ?? r?.rateStructure?.type ?? r?.rate_structure?.type ?? "",
  ).trim();
  if (rateStructureTypeRaw) return rateStructureTypeRaw.toUpperCase();

  return "—";
}

export default function FactCardOpsPage() {
  const { token, setToken } = useLocalToken();
  const ready = useMemo(() => Boolean(token), [token]);
  const [buildInfo, setBuildInfo] = useState<{ sha: string | null; ref: string | null } | null>(
    null,
  );

  // Manual loader is rendered at the bottom; we prefill it from Queue/Templates/Batch via this state.
  const [manualPrefillUrl, setManualPrefillUrl] = useState("");
  const [manualPrefillOfferId, setManualPrefillOfferId] = useState<string>("");
  const [manualPrefillRawText, setManualPrefillRawText] = useState<string>("");
  const manualRef = useRef<HTMLDivElement | null>(null);

  function loadIntoManual(args: { eflUrl?: string | null; offerId?: string | null; rawText?: string | null }) {
    const u = (args.eflUrl ?? "").trim();
    const rawText = String(args.rawText ?? "");
    if (!u && !rawText.trim()) return;
    setManualPrefillUrl(u);
    setManualPrefillOfferId((args.offerId ?? "").trim());
    setManualPrefillRawText(rawText);
    setTimeout(() => {
      manualRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // Deep-link prefill: /admin/efl/fact-cards?eflUrl=...&offerId=...
  // NOTE: Avoid next/navigation useSearchParams() here — it requires a Suspense boundary during prerender.
  // Since this page is client-only, we can safely read window.location after mount.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const u = (sp.get("eflUrl") ?? "").trim();
      const oid = (sp.get("offerId") ?? "").trim();

      // LocalStorage prefill: used by /admin/efl-review when queue items don't have an eflUrl (common for current-plan uploads).
      // This avoids passing long rawText through query params and still reuses the exact same manual runner/engine.
      const prefillLocal = (sp.get("prefill") ?? "").trim().toLowerCase() === "local";
      if (prefillLocal) {
        try {
          const raw = window.localStorage.getItem("iw_factcards_prefill_v1");
          if (raw) {
            const parsed = JSON.parse(raw) as any;
            const rawText = typeof parsed?.rawText === "string" ? parsed.rawText : "";
            const offerId = typeof parsed?.offerId === "string" ? parsed.offerId : (oid || null);
            if (rawText.trim()) {
              loadIntoManual({ rawText, offerId });
              window.localStorage.removeItem("iw_factcards_prefill_v1");
              return;
            }
          }
        } catch {
          // ignore
        }
      }

      if (!u) return;
      loadIntoManual({ eflUrl: u, offerId: oid || null });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deployment/version marker (helps debug "deploy went through but UI didn't change").
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/version");
        const data = (await res.json().catch(() => null)) as any;
        if (!cancelled && res.ok && data?.ok) {
          setBuildInfo({
            sha: typeof data.sha === "string" ? data.sha : null,
            ref: typeof data.ref === "string" ? data.ref : null,
          });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------- Provider batch runner (WattBuy today; future sources later) ----------------
  const [source, setSource] = useState<ProviderSource>("wattbuy");
  const [territoryPresetId, setTerritoryPresetId] = useState<string>("");
  const [address, setAddress] = useState("9514 Santa Paula Dr");
  const [city, setCity] = useState("Fort Worth");
  const [state, setState] = useState("tx");
  const [zip, setZip] = useState("76116");
  const [wattkey, setWattkey] = useState("");

  const [offerLimit, setOfferLimit] = useState(500);
  const [runAll, setRunAll] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [forceReparseTemplates, setForceReparseTemplates] = useState(false);
  const [computeUsageBuckets, setComputeUsageBuckets] = useState(false);
  const [usageEmail, setUsageEmail] = useState("bllfield32@gmail.com");

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
    const s = state.trim() || "tx";
    const z = zip.trim();

    // ZIP-only lookups are allowed; full address is optional.
    if (!z) {
      alert("Provide ZIP (or full address).");
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
            computeUsageBuckets,
            usageEmail: computeUsageBuckets ? usageEmail.trim() : undefined,
            usageMonths: 12,
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
              data?.usageContext?.computed?.rowsUpserted
                ? `Usage buckets: upserted ${data.usageContext.computed.rowsUpserted} rows (${data.usageContext.computed.monthsProcessed} months).`
                : computeUsageBuckets
                  ? `Usage buckets: ${data?.usageContext?.errors?.length ? "errors (see Raw Output)" : "not computed"}`
                  : null,
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
  // Default to ALL so ops can see both parse + quarantine items.
  // This matches how the customer site labels plans as QUEUED (often PLAN_CALC_QUARANTINE).
  const [queueKind, setQueueKind] = useState<"ALL" | "EFL_PARSE" | "PLAN_CALC_QUARANTINE">("ALL");
  const [queueQ, setQueueQ] = useState("");
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueTotalCount, setQueueTotalCount] = useState<number | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueErr, setQueueErr] = useState<string | null>(null);
  const [queueProcessLoading, setQueueProcessLoading] = useState(false);
  const [queueProcessNote, setQueueProcessNote] = useState<string | null>(null);
  const [queueEnqueueUnknownLoading, setQueueEnqueueUnknownLoading] = useState(false);
  const [queueEnqueueUnknownNote, setQueueEnqueueUnknownNote] = useState<string | null>(null);
  const [queueEnqueueQuarantineLoading, setQueueEnqueueQuarantineLoading] = useState(false);
  const [queueEnqueueQuarantineNote, setQueueEnqueueQuarantineNote] = useState<string | null>(null);
  const [queueUtilityId, setQueueUtilityId] = useState(""); // optional filter for enqueue helpers (e.g. "oncor")
  const [queueSortKey, setQueueSortKey] = useState<
    "tdspName" | "supplier" | "planName" | "offerId" | "eflVersionCode" | "queueReason"
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
      if (queueKind !== "ALL") params.set("kind", queueKind);
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

  async function enqueueQuarantinesFromMappings() {
    if (!token) {
      setQueueErr("Admin token required.");
      return;
    }
    setQueueEnqueueQuarantineLoading(true);
    setQueueEnqueueQuarantineNote(null);
    setQueueErr(null);
    try {
      const res = await fetch("/api/admin/efl-review/enqueue-quarantines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({
          utilityId: queueUtilityId.trim() ? queueUtilityId.trim() : undefined,
          limit: 800,
          forceReopen: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setQueueEnqueueQuarantineNote(
        `Enqueued quarantines: ${Number(data.upserted ?? 0) || 0} (scanned ${Number(data.scanned ?? 0) || 0})` +
          (data.utilityId ? ` for utilityId="${String(data.utilityId)}"` : "") +
          ".",
      );
      await loadQueue();
    } catch (e: any) {
      setQueueErr(e?.message || "Failed to enqueue quarantines.");
    } finally {
      setQueueEnqueueQuarantineLoading(false);
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
    if (queueKind !== "EFL_PARSE") {
      setQueueErr('This auto processor only applies to kind="EFL_PARSE". Switch Kind to EFL_PARSE, or use the quarantine processor.');
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

  async function processOpenQuarantineQueue() {
    if (!token) {
      setQueueErr("Admin token required.");
      return;
    }
    if (queueStatus !== "OPEN") {
      setQueueErr("Switch to Open queue status first.");
      return;
    }
    if (queueKind !== "PLAN_CALC_QUARANTINE") {
      setQueueErr('Switch Kind to PLAN_CALC_QUARANTINE first.');
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
        const res: Response = await fetch("/api/admin/efl-review/process-quarantine", {
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
      setQueueErr(e?.message || "Failed to process quarantine queue.");
    } finally {
      setQueueProcessLoading(false);
    }
  }

  async function enqueueUnknownUtilityTemplates() {
    if (!token) {
      setQueueErr("Admin token required.");
      return;
    }
    setQueueEnqueueUnknownLoading(true);
    setQueueEnqueueUnknownNote(null);
    setQueueErr(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "1000");
      // Reopen resolved parse items too so they show up immediately for triage.
      params.set("reopenResolved", "1");
      const res = await fetch(`/api/admin/efl-review/enqueue-unknown-utility?${params.toString()}`, {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const data: any = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setQueueEnqueueUnknownNote(
        `Queued UNKNOWN utilities: scanned=${data.scanned ?? 0} created=${data.created ?? 0} reopened=${data.reopened ?? 0} updated=${data.updated ?? 0} (quarantine skipped=${data.skippedHasQuarantine ?? 0}).`,
      );
      await loadQueue();
    } catch (e: any) {
      setQueueErr(e?.message || "Failed to enqueue unknown utilities.");
    } finally {
      setQueueEnqueueUnknownLoading(false);
    }
  }

  useEffect(() => {
    if (ready) void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, queueStatus, queueKind]);

  const sortedQueueItems = useMemo(() => {
    const out = [...queueItems];
    out.sort((a: any, b: any) => {
      const av =
        queueSortKey === "tdspName"
          ? a?.tdspName
          : queueSortKey === "supplier"
            ? a?.supplier
            : queueSortKey === "planName"
              ? a?.planName
              : queueSortKey === "offerId"
                ? a?.offerId
                : queueSortKey === "eflVersionCode"
                  ? a?.eflVersionCode
                  : a?.queueReason;
      const bv =
        queueSortKey === "tdspName"
          ? b?.tdspName
          : queueSortKey === "supplier"
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
  const [tplLimit, setTplLimit] = useState(1000);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplErr, setTplErr] = useState<string | null>(null);
  const [tplRows, setTplRows] = useState<TemplateRow[]>([]);
  const [tplTotalCount, setTplTotalCount] = useState<number | null>(null);
  const [tdspNote, setTdspNote] = useState<string | null>(null);
  const [tplIncludeLegacy, setTplIncludeLegacy] = useState(false);
  const [hygieneLoading, setHygieneLoading] = useState(false);
  const [hygieneErr, setHygieneErr] = useState<string | null>(null);
  const [hygieneRaw, setHygieneRaw] = useState<Json | null>(null);
  const [hygieneLimit, setHygieneLimit] = useState(500);
  const [tplHomeId, setTplHomeId] = useState("");
  const [tplUsageNote, setTplUsageNote] = useState<string | null>(null);
  const [tplAutoSort, setTplAutoSort] = useState(true);
  const [tplSimTdspSlug, setTplSimTdspSlug] = useState<string>("");
  const [tplSimAvgMonthlyKwh, setTplSimAvgMonthlyKwh] = useState<string>("1512");
  const [backfillIncludeNonStrong, setBackfillIncludeNonStrong] =
    useState(false);
  const [backfillOverwrite, setBackfillOverwrite] = useState(false);
  const [tplSortKey, setTplSortKey] = useState<
    | "bestForYou"
    | "utilityId"
    | "supplier"
    | "planName"
    | "planType"
    | "termMonths"
    | "queued"
    | "queuedReason"
    | "rate500"
    | "rate1000"
    | "rate2000"
    | "passStrength"
    | "eflVersionCode"
  >("rate1000");
  const [tplSortDir, setTplSortDir] = useState<SortDir>("asc");

  // ---------------- Unmapped Templates (orphan templates with no OfferIdRatePlanMap link) ----------------
  const [unmappedTplQ, setUnmappedTplQ] = useState("");
  const [unmappedTplLimit, setUnmappedTplLimit] = useState(200);
  const [unmappedTplLoading, setUnmappedTplLoading] = useState(false);
  const [unmappedTplErr, setUnmappedTplErr] = useState<string | null>(null);
  const [unmappedTplRows, setUnmappedTplRows] = useState<UnmappedTemplateRow[]>([]);
  const [unmappedTplTotalCount, setUnmappedTplTotalCount] = useState<number | null>(null);
  const [unmappedTplSortKey, setUnmappedTplSortKey] = useState<
    "utilityId" | "supplier" | "planName" | "termMonths" | "updatedAt" | "eflVersionCode"
  >("updatedAt");
  const [unmappedTplSortDir, setUnmappedTplSortDir] = useState<SortDir>("desc");

  async function loadUnmappedTemplates() {
    if (!token) {
      setUnmappedTplErr("Admin token required.");
      return;
    }
    setUnmappedTplLoading(true);
    setUnmappedTplErr(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(unmappedTplLimit));
      if (unmappedTplQ.trim()) params.set("q", unmappedTplQ.trim());
      const res = await fetch(`/api/admin/efl/templates/unmapped?${params.toString()}`, {
        headers: { "x-admin-token": token },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setUnmappedTplRows(Array.isArray(data.rows) ? data.rows : []);
      setUnmappedTplTotalCount(
        typeof data.totalCount === "number" && Number.isFinite(data.totalCount)
          ? data.totalCount
          : null,
      );
    } catch (e: any) {
      setUnmappedTplErr(e?.message || "Failed to load unmapped templates.");
    } finally {
      setUnmappedTplLoading(false);
    }
  }

  async function loadTemplates() {
    if (!token) {
      setTplErr("Admin token required.");
      return;
    }
    setTplLoading(true);
    setTplErr(null);
    setTplUsageNote(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(tplLimit));
      if (tplQ.trim()) params.set("q", tplQ.trim());
      if (tplIncludeLegacy) params.set("includeLegacy", "1");
      if (tplSimTdspSlug.trim()) {
        params.set("simulateTdspSlug", tplSimTdspSlug.trim());
        const kwh = Number(tplSimAvgMonthlyKwh);
        if (Number.isFinite(kwh) && kwh > 0) params.set("simulateAvgMonthlyKwh", String(Math.floor(kwh)));
        params.set("usageMonths", "12");
      } else if (tplHomeId.trim()) {
        params.set("homeId", tplHomeId.trim());
        params.set("usageMonths", "12");
      } else {
        // Default behavior: if any home in the DB has usage buckets, attach monthly estimates
        // so the Templates table can show "Best for you" pricing without manual setup.
        params.set("useDefaultHome", "1");
        params.set("usageMonths", "12");
      }
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

      const uc = (data as any)?.usageContext ?? null;
      if (uc && typeof uc === "object") {
        const monthsFound = typeof uc.monthsFound === "number" ? uc.monthsFound : null;
        const avgMonthlyKwh = typeof uc.avgMonthlyKwh === "number" ? uc.avgMonthlyKwh : null;
        const ctxHomeId = String(uc.homeId ?? "—");
        const base =
          monthsFound != null
            ? `Usage context: homeId=${ctxHomeId} monthsFound=${monthsFound}${avgMonthlyKwh != null ? ` avgMonthly=${avgMonthlyKwh.toFixed(0)} kWh` : ""}`
            : `Usage context: homeId=${ctxHomeId}`;
        const sim = tplSimTdspSlug.trim()
          ? ` (SIM: tdsp=${tplSimTdspSlug.trim()} avgMonthly=${Number(tplSimAvgMonthlyKwh || "0") || 0} kWh)`
          : "";
        setTplUsageNote(`${base}${sim}`);

        if (tplAutoSort) {
          if (monthsFound != null && monthsFound > 0) {
            setTplSortKey("bestForYou");
            setTplSortDir("asc");
          } else {
            setTplSortKey("rate1000");
            setTplSortDir("asc");
          }
        }
      } else if (tplAutoSort) {
        setTplSortKey("rate1000");
        setTplSortDir("asc");
      }
    } catch (e: any) {
      setTplErr(e?.message || "Failed to load templates.");
    } finally {
      setTplLoading(false);
    }
  }

  async function setTemplateComputableOverride(input: { ratePlanId: string; offerId?: string | null; enable: boolean }) {
    if (!token) {
      setTplErr("Admin token required.");
      return;
    }
    const ratePlanId = String(input.ratePlanId ?? "").trim();
    if (!ratePlanId) {
      setTplErr("Missing ratePlanId.");
      return;
    }
    setTplLoading(true);
    setTplErr(null);
    try {
      const res = await fetch("/api/admin/wattbuy/templated-plans/override-computable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({
          ratePlanId,
          offerId: input.offerId ?? null,
          mode: input.enable ? "FORCE_COMPUTABLE" : "RESET_DERIVED",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await loadTemplates();
      // Also refresh queue view (best-effort) since override resolves quarantines.
      try {
        await loadQueue();
      } catch {
        // ignore
      }
    } catch (e: any) {
      setTplErr(e?.message || "Failed to update computability override.");
    } finally {
      setTplLoading(false);
    }
  }

  async function refreshTdspSnapshots() {
    if (!token) {
      setTplErr("Admin token required.");
      return;
    }
    setTplLoading(true);
    setTplErr(null);
    setTdspNote(null);
    try {
      const res = await fetch("/api/admin/tdsp/rates/refresh", {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setTdspNote(
        `TDSP snapshot refresh: created=${data.createdCount ?? 0} keys=${Array.isArray(data.keys) ? data.keys.join(",") : "—"} source=${data.sourceUrl ?? "—"}`,
      );
      await loadTemplates();
    } catch (e: any) {
      setTplErr(e?.message || "Failed to refresh TDSP snapshots.");
    } finally {
      setTplLoading(false);
    }
  }

  async function backfillModeledProofIntoDb() {
    if (!token) {
      setTplErr("Admin token required.");
      return;
    }
    const ok = window.confirm(
      `Backfill modeled 500/1000/2000 kWh rates + validator proof into RatePlan columns?\n\nMode: ${
        backfillIncludeNonStrong
          ? "Include WEAK/FAIL (stores proof even when validation isn't STRONG)"
          : "PASS + STRONG only (default/safest)"
      }\nOverwrite: ${backfillOverwrite ? "YES" : "NO (fill missing only)"}\n\nThis refetches EFL PDFs and runs the full pipeline.`,
    );
    if (!ok) return;

    setTplLoading(true);
    setTplErr(null);
    setTdspNote(null);
    try {
      let cursorId: string | null = null;
      let loops = 0;
      let processed = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      while (loops < 500) {
        const qs = new URLSearchParams();
        qs.set("limit", "15");
        qs.set("timeBudgetMs", "110000");
        qs.set("onlyStrong", backfillIncludeNonStrong ? "0" : "1");
        if (backfillOverwrite) qs.set("overwrite", "1");
        if (cursorId) qs.set("cursorId", cursorId);

        const res = await fetch(`/api/admin/efl/templates/backfill-modeled?${qs.toString()}`, {
          method: "POST",
          headers: { "x-admin-token": token },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

        processed += Number(data.processedCount ?? 0) || 0;
        updated += Number(data.updatedCount ?? 0) || 0;
        skipped += Number(data.skippedCount ?? 0) || 0;
        errors += Number(data.errorsCount ?? 0) || 0;

        setTdspNote(
          `Modeled proof backfill: processed=${processed} updated=${updated} skipped=${skipped} errors=${errors} last=${data.lastCursorId ?? "—"}`,
        );

        if (!data.truncated || !data.nextCursorId) break;
        cursorId = String(data.nextCursorId);
        loops++;
      }

      await loadTemplates();
    } catch (e: any) {
      setTplErr(e?.message || "Failed to backfill modeled proof.");
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
      // Keep both tables in sync: invalidation removes rateStructure, so it should disappear
      // from both Templates and Unmapped Templates views.
      await Promise.all([loadTemplates(), loadUnmappedTemplates()]);
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

  async function revalidateTemplatesAndQuarantine() {
    if (!token) {
      setTplErr("Admin token required.");
      return;
    }
    const phrase = window.prompt(
      'Revalidate templates and quarantine any that fail new guardrails?\n\nThis will:\n- Recompute plan-calc for currently COMPUTABLE templates\n- If a template now fails, it will be removed (rateStructure cleared) and queued for review\n\nType REVALIDATE_TEMPLATES to proceed.',
    );
    if (!phrase) return;
    if (phrase.trim() !== "REVALIDATE_TEMPLATES") {
      setTplErr("Aborted (confirm phrase mismatch).");
      return;
    }

    setTplLoading(true);
    setTplErr(null);
    setTdspNote(null);
    try {
      let cursorId: string | null = null;
      let loops = 0;
      let processed = 0;
      let quarantined = 0;
      let kept = 0;
      let errors = 0;
      let quarantinedPlanCalc = 0;
      let quarantinedUnknownUtility = 0;
      let unknownUtilityQueued = 0;

      while (loops < 500) {
        const qs = new URLSearchParams();
        qs.set("limit", "200");
        qs.set("timeBudgetMs", "110000");
        if (cursorId) qs.set("cursorId", cursorId);

        const res = await fetch(`/api/admin/efl/templates/revalidate?${qs.toString()}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-admin-token": token },
          body: JSON.stringify({ confirm: "REVALIDATE_TEMPLATES", onlyComputable: true }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

        processed += Number(data.processedCount ?? 0) || 0;
        quarantined += Number(data.quarantinedCount ?? 0) || 0;
        kept += Number(data.keptCount ?? 0) || 0;
        errors += Number(data.errorsCount ?? 0) || 0;
        quarantinedPlanCalc += Number(data.quarantinedPlanCalcCount ?? 0) || 0;
        quarantinedUnknownUtility += Number(data.quarantinedUnknownUtilityCount ?? 0) || 0;
        unknownUtilityQueued += Number(data.unknownUtilityQueuedCount ?? 0) || 0;

        setTdspNote(
          `Revalidate templates: processed=${processed} quarantined=${quarantined} (planCalc=${quarantinedPlanCalc} unknownUtility=${quarantinedUnknownUtility} queuedUnknown=${unknownUtilityQueued}) kept=${kept} errors=${errors} last=${data.lastCursorId ?? "—"}`,
        );

        if (!data.truncated || !data.nextCursorId) break;
        cursorId = String(data.nextCursorId);
        loops++;
      }

      await loadTemplates();
    } catch (e: any) {
      setTplErr(e?.message || "Failed to revalidate templates.");
    } finally {
      setTplLoading(false);
    }
  }

  async function runTemplateHygiene(apply: boolean) {
    if (!token) {
      setHygieneErr("Admin token required.");
      return;
    }
    if (apply) {
      const phrase = window.prompt(
        'Invalidate ORPHAN junk templates only?\n\nThis will clear RatePlan.rateStructure for templates that are missing identity fields and have NO OfferIdRatePlanMap links.\n\nType INVALIDATE_ORPHAN_JUNK to proceed.',
      );
      if (!phrase) return;
      if (phrase.trim() !== "INVALIDATE_ORPHAN_JUNK") {
        setHygieneErr("Aborted (confirm phrase mismatch).");
        return;
      }
    }
    setHygieneLoading(true);
    setHygieneErr(null);
    try {
      const res = await fetch("/api/admin/efl/templates/hygiene", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ limit: hygieneLimit, apply }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setHygieneRaw(data);
      setTdspNote(
        `Template hygiene: scanned=${data?.summary?.scannedCandidates ?? 0} orphanJunk=${data?.summary?.orphanJunk ?? 0} linkedNeedsReparse=${data?.summary?.linkedNeedsReparse ?? 0} applied=${data?.summary?.appliedInvalidations ?? 0}`,
      );
      // Keep tables fresh after apply.
      if (apply) {
        await Promise.all([loadTemplates(), loadUnmappedTemplates()]);
      }
    } catch (e: any) {
      setHygieneErr(e?.message || "Failed to run template hygiene.");
    } finally {
      setHygieneLoading(false);
    }
  }

  useEffect(() => {
    if (ready) void loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (ready) void loadUnmappedTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const sortedUnmappedTplRows = useMemo(() => {
    const out = [...unmappedTplRows];
    out.sort((a: any, b: any) => {
      const av =
        unmappedTplSortKey === "utilityId"
          ? a?.utilityId
          : unmappedTplSortKey === "supplier"
            ? a?.supplier
            : unmappedTplSortKey === "planName"
              ? a?.planName
              : unmappedTplSortKey === "termMonths"
                ? typeof a?.termMonths === "number"
                  ? a.termMonths
                  : null
                : unmappedTplSortKey === "eflVersionCode"
                  ? a?.eflVersionCode
                  : a?.updatedAt;
      const bv =
        unmappedTplSortKey === "utilityId"
          ? b?.utilityId
          : unmappedTplSortKey === "supplier"
            ? b?.supplier
            : unmappedTplSortKey === "planName"
              ? b?.planName
              : unmappedTplSortKey === "termMonths"
                ? typeof b?.termMonths === "number"
                  ? b.termMonths
                  : null
                : unmappedTplSortKey === "eflVersionCode"
                  ? b?.eflVersionCode
                  : b?.updatedAt;
      return cmp(av ?? null, bv ?? null, unmappedTplSortDir);
    });
    return out;
  }, [unmappedTplRows, unmappedTplSortKey, unmappedTplSortDir]);

  function toggleUnmappedTplSort(k: typeof unmappedTplSortKey) {
    if (unmappedTplSortKey === k) {
      setUnmappedTplSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setUnmappedTplSortKey(k);
      setUnmappedTplSortDir("asc");
    }
  }

  const sortedTplRows = useMemo(() => {
    const out = [...tplRows];
    out.sort((a: any, b: any) => {
      const av =
        tplSortKey === "bestForYou"
          ? typeof (a as any)?.usageEstimate?.monthlyCostDollars === "number"
            ? (a as any).usageEstimate.monthlyCostDollars
            : null
          : tplSortKey === "utilityId"
            ? a?.utilityId
          : tplSortKey === "supplier"
            ? a?.supplier
          : tplSortKey === "planName"
            ? a?.planName
            : tplSortKey === "planType"
              ? deriveTemplatePlanTypeLabel(a)
            : tplSortKey === "termMonths"
              ? typeof a?.termMonths === "number"
                ? a.termMonths
                : null
              : tplSortKey === "queued"
                ? Boolean((a as any)?.queued)
                : tplSortKey === "queuedReason"
                  ? ((a as any)?.queuedReason ?? (a as any)?.planCalcReasonCode ?? null)
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
                    : tplSortKey === "passStrength"
                      ? a?.passStrength
                    : a?.eflVersionCode;
      const bv =
        tplSortKey === "bestForYou"
          ? typeof (b as any)?.usageEstimate?.monthlyCostDollars === "number"
            ? (b as any).usageEstimate.monthlyCostDollars
            : null
          : tplSortKey === "utilityId"
            ? b?.utilityId
          : tplSortKey === "supplier"
            ? b?.supplier
          : tplSortKey === "planName"
            ? b?.planName
            : tplSortKey === "planType"
              ? deriveTemplatePlanTypeLabel(b)
            : tplSortKey === "termMonths"
              ? typeof b?.termMonths === "number"
                ? b.termMonths
                : null
              : tplSortKey === "queued"
                ? Boolean((b as any)?.queued)
                : tplSortKey === "queuedReason"
                  ? ((b as any)?.queuedReason ?? (b as any)?.planCalcReasonCode ?? null)
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
                    : tplSortKey === "passStrength"
                      ? b?.passStrength
                    : b?.eflVersionCode;

      if (tplSortKey === "queued") {
        const an = av ? 1 : 0;
        const bn = bv ? 1 : 0;
        return cmp(an, bn, tplSortDir);
      }
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
    setTplAutoSort(false);
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

      <div className="mb-6">
        <BackfillButton />
      </div>

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
              <label className="block text-sm mb-1">Territory preset (optional)</label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={territoryPresetId}
                onChange={(e) => {
                  const id = String(e.target.value);
                  setTerritoryPresetId(id);
                  const p = TERRITORY_PRESETS.find((x) => x.id === id) ?? null;
                  if (!p) return;
                  setAddress(p.line1);
                  setCity(p.city);
                  setState(p.state);
                  setZip(p.zip);
                }}
              >
                <option value="">Custom / manual</option>
                {TERRITORY_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <div className="text-xs text-gray-500 mt-1">
                Selecting a preset fills the fields; you can still edit them after. ZIP-only is allowed for most territories.
              </div>
            </div>
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
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={computeUsageBuckets}
                onChange={(e) => setComputeUsageBuckets(e.target.checked)}
                disabled={dryRun}
              />
              Compute usage buckets for home (Phase 2 check)
            </label>
          </div>

          {computeUsageBuckets ? (
            <div className="grid gap-2 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">Home email (usage source)</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={usageEmail}
                  onChange={(e) => setUsageEmail(e.target.value)}
                  placeholder="bllfield@yahoo.com"
                />
                <div className="text-xs text-gray-600 mt-1">
                  This writes monthly bucket totals for that home (kwh.m.*) so you can audit TOU calculations while keeping TOU gated.
                </div>
              </div>
            </div>
          ) : null}

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
                        <th className="px-2 py-2 text-left">Details</th>
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
                          <td className="px-2 py-2">
                            {m.offerId && m.offerId !== "—" ? (
                              <a className="underline" href={`/admin/plans/${encodeURIComponent(m.offerId)}`} target="_blank" rel="noreferrer">
                                Details
                              </a>
                            ) : null}
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
                    <th className="px-2 py-2 text-left">PlanCalc</th>
                    <th className="px-2 py-2 text-left">Usage (annual)</th>
                    <th className="px-2 py-2 text-left">Actions</th>
                    <th className="px-2 py-2 text-left">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.slice(0, 100).map((r, idx) => {
                    const eflUrl = (r.eflUrl ?? "").trim();
                    const status = r.finalValidationStatus ?? r.validationStatus ?? "-";
                    const pc = String((r as any)?.planCalcReasonCode ?? (r as any)?.planCalcStatus ?? "").trim();
                    const annual = (r as any)?.usagePreview?.annualKwh;
                    return (
                      <tr key={`${r.offerId ?? "offer"}:${idx}`} className="border-t">
                        <td className="px-2 py-2">{r.supplier ?? "-"}</td>
                        <td className="px-2 py-2">{r.planName ?? "-"}</td>
                        <td className="px-2 py-2 max-w-[260px] truncate" title={eflUrl}>
                          {eflUrl || "—"}
                        </td>
                        <td className="px-2 py-2">{status}</td>
                        <td className="px-2 py-2">{r.templateAction ?? "-"}</td>
                        <td className="px-2 py-2 font-mono text-[11px]" title={pc}>
                          {pc || "—"}
                        </td>
                        <td className="px-2 py-2 font-mono text-[11px]" title={pretty((r as any)?.usagePreview ?? null)}>
                          {typeof annual === "number" && Number.isFinite(annual) ? annual.toFixed(0) : "—"}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-60"
                            disabled={!eflUrl}
                            onClick={() => loadIntoManual({ eflUrl, offerId: r.offerId ?? null })}
                          >
                            Load
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          {r.offerId ? (
                            <a className="underline" href={`/admin/plans/${encodeURIComponent(String(r.offerId))}`} target="_blank" rel="noreferrer">
                              Details
                            </a>
                          ) : null}
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
            {queueKind === "EFL_PARSE" ? (
              <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void processOpenQueue()} disabled={!ready || queueLoading || queueProcessLoading || queueStatus !== "OPEN"}>
                {queueProcessLoading ? "Processing…" : "Process OPEN parse queue (auto)"}
              </button>
            ) : queueKind === "PLAN_CALC_QUARANTINE" ? (
              <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void processOpenQuarantineQueue()} disabled={!ready || queueLoading || queueProcessLoading || queueStatus !== "OPEN"}>
                {queueProcessLoading ? "Processing…" : "Process OPEN quarantines (auto-fix)"}
              </button>
            ) : (
              <button
                className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60"
                onClick={() => setQueueErr('Pick Kind="EFL_PARSE" or "PLAN_CALC_QUARANTINE" to run an auto-processor.')}
                disabled={!ready || queueLoading || queueProcessLoading || queueStatus !== "OPEN"}
                title='Auto-processors run on a single Kind. Select a Kind first.'
              >
                Choose Kind to run processor
              </button>
            )}
          </div>
        </div>
        <div className="text-xs text-gray-600">
          {queueKind === "EFL_PARSE" ? (
            <>
              Auto processor runs the full EFL pipeline and persists templates on{" "}
              <span className="font-medium">PASS + STRONG</span>. It also registers required bucket definitions. Home monthly bucket totals are created later (on-demand) when you run an estimate for a specific home.
            </>
          ) : queueKind === "PLAN_CALC_QUARANTINE" ? (
            <>
              Quarantine processor re-runs the full EFL pipeline and will auto-resolve a quarantine item{" "}
              <span className="font-medium">only if</span> it can persist a safe template (PASS + STRONG, no manual-review gate).
            </>
          ) : (
            <>Showing <span className="font-medium">ALL</span> kinds. Select a specific Kind to see processor instructions.</>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={queueStatus === "OPEN"} onChange={() => setQueueStatus("OPEN")} /> Open
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={queueStatus === "RESOLVED"} onChange={() => setQueueStatus("RESOLVED")} /> Resolved
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <span className="text-gray-600">Kind</span>
            <select className="rounded-lg border px-2 py-2 text-sm" value={queueKind} onChange={(e) => setQueueKind(e.target.value as any)}>
              <option value="ALL">ALL</option>
              <option value="EFL_PARSE">EFL_PARSE</option>
              <option value="PLAN_CALC_QUARANTINE">PLAN_CALC_QUARANTINE</option>
            </select>
          </label>
          <input
            className="w-[140px] rounded-lg border px-3 py-2 text-sm"
            placeholder='utilityId (e.g. "oncor")'
            value={queueUtilityId}
            onChange={(e) => setQueueUtilityId(e.target.value)}
            title='Optional filter for enqueue helpers (matches RatePlan.utilityId). Leave blank for all.'
          />
          <input className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-sm" placeholder="Search supplier / plan / utility / offer / sha / version" value={queueQ} onChange={(e) => setQueueQ(e.target.value)} />
          <button className="px-3 py-2 rounded-lg border hover:bg-gray-50" onClick={() => void loadQueue()} disabled={!ready || queueLoading}>
            Apply
          </button>
          <button
            className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60"
            onClick={() => void enqueueQuarantinesFromMappings()}
            disabled={!ready || queueEnqueueQuarantineLoading}
            title='Backfill PLAN_CALC_QUARANTINE rows from OfferIdRatePlanMap + RatePlan planCalcStatus. Useful when the customer site shows many "QUEUED" plans but the queue is empty.'
          >
            {queueEnqueueQuarantineLoading ? "Enqueueing…" : "Enqueue quarantines"}
          </button>
          <button
            className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60"
            onClick={() => void enqueueUnknownUtilityTemplates()}
            disabled={!ready || queueEnqueueUnknownLoading}
            title='Find RatePlans with utilityId="UNKNOWN" and enqueue them into the EFL_PARSE queue for triage.'
          >
            {queueEnqueueUnknownLoading ? "Queueing…" : "Queue UNKNOWN utilities"}
          </button>
        </div>
        {queueErr ? <div className="text-sm text-red-700">{queueErr}</div> : null}
        {queueProcessNote ? <div className="text-xs text-gray-700">{queueProcessNote}</div> : null}
        {queueEnqueueUnknownNote ? <div className="text-xs text-gray-700">{queueEnqueueUnknownNote}</div> : null}
        {queueEnqueueQuarantineNote ? <div className="text-xs text-gray-700">{queueEnqueueQuarantineNote}</div> : null}

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
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleQueueSort("tdspName")}>
                  Utility {queueSortKey === "tdspName" ? (queueSortDir === "asc" ? "▲" : "▼") : ""}
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
                const runHref =
                  eflUrl
                    ? `/admin/efl/fact-cards?${new URLSearchParams({
                        eflUrl,
                        ...(it?.offerId ? { offerId: String(it.offerId) } : {}),
                      }).toString()}`
                    : "";
                return (
                  <tr key={it.id} className="border-t h-12">
                    <td className="px-2 py-2">{it.supplier ?? "-"}</td>
                    <td className="px-2 py-2">{it.planName ?? "-"}</td>
                    <td className="px-2 py-2">{it.tdspName ?? "-"}</td>
                    <td className="px-2 py-2">{it.offerId ?? "-"}</td>
                    <td className="px-2 py-2">{it.eflVersionCode ?? "-"}</td>
                    <td className="px-2 py-2 max-w-[420px] truncate" title={it.queueReason ?? ""}>
                      {it.queueReason ?? "-"}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-60"
                          disabled={!eflUrl && !String(it?.rawText ?? "").trim()}
                          onClick={() =>
                            loadIntoManual({
                              eflUrl,
                              offerId: it.offerId ?? null,
                              rawText: !eflUrl ? (it?.rawText ?? null) : null,
                            })
                          }
                          title={
                            eflUrl
                              ? "Load into manual runner (URL)"
                              : String(it?.rawText ?? "").trim()
                                ? "Load into manual runner (raw text)"
                                : "No EFL URL or raw text available"
                          }
                        >
                          Load
                        </button>
                        {eflUrl ? (
                          <a
                            className="px-2 py-1 rounded border hover:bg-gray-50"
                            href={eflUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            title="Open EFL URL in a new tab"
                          >
                            Open EFL
                          </a>
                        ) : null}
                        {runHref ? (
                          <a
                            className="px-2 py-1 rounded border hover:bg-gray-50"
                            href={runHref}
                            title="Deep link: prefill the manual runner on this page"
                          >
                            Run manual
                          </a>
                        ) : null}
                        {it?.offerId ? (
                          <a
                            className="px-2 py-1 rounded border hover:bg-gray-50"
                            href={`/admin/plans/${encodeURIComponent(String(it.offerId))}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open Plan Details"
                          >
                            Details
                          </a>
                        ) : runHref ? (
                          <a
                            className="px-2 py-1 rounded border hover:bg-gray-50"
                            href={runHref}
                            title="Details (no offerId): open the manual runner prefilled with this EFL"
                          >
                            Details
                          </a>
                        ) : (
                          <span
                            className="px-2 py-1 rounded border text-gray-400 border-gray-200 cursor-not-allowed"
                            title="No offerId or eflUrl available to open details."
                          >
                            Details
                          </span>
                        )}
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
                  <td className="px-2 py-3 text-gray-500" colSpan={7}>
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
            Unmapped Templates{" "}
            <span className="text-xs text-gray-600">
              ({unmappedTplTotalCount ?? unmappedTplRows.length})
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60"
              onClick={() => void loadUnmappedTemplates()}
              disabled={!ready || unmappedTplLoading}
              title='RatePlan rows with stored rateStructure but no OfferIdRatePlanMap.ratePlanId link'
            >
              {unmappedTplLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-600">
          These are stored templates that are not linked to any WattBuy{" "}
          <span className="font-mono">offer_id</span>. They will not show{" "}
          <span className="font-mono">templateAvailable=true</span> until a link exists.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-sm"
            placeholder="Search supplier / plan / cert / version / sha / utility…"
            value={unmappedTplQ}
            onChange={(e) => setUnmappedTplQ(e.target.value)}
          />
          <input
            className="w-28 rounded-lg border px-3 py-2 text-sm"
            type="number"
            min={1}
            max={1000}
            value={unmappedTplLimit}
            onChange={(e) =>
              setUnmappedTplLimit(Math.max(1, Math.min(1000, numOrNull(e.target.value) ?? 200)))
            }
          />
          <button
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
            onClick={() => void loadUnmappedTemplates()}
            disabled={!ready || unmappedTplLoading}
          >
            Apply
          </button>
        </div>
        {unmappedTplErr ? <div className="text-sm text-red-700">{unmappedTplErr}</div> : null}

        {/* ~5 visible rows + sticky header */}
        <div className="overflow-x-auto overflow-y-auto max-h-[280px] rounded-xl border">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
              <tr className="h-10">
                <th
                  className="px-2 py-2 text-left cursor-pointer select-none"
                  onClick={() => toggleUnmappedTplSort("utilityId")}
                >
                  Utility{" "}
                  {unmappedTplSortKey === "utilityId"
                    ? unmappedTplSortDir === "asc"
                      ? "▲"
                      : "▼"
                    : ""}
                </th>
                <th
                  className="px-2 py-2 text-left cursor-pointer select-none"
                  onClick={() => toggleUnmappedTplSort("supplier")}
                >
                  Supplier{" "}
                  {unmappedTplSortKey === "supplier"
                    ? unmappedTplSortDir === "asc"
                      ? "▲"
                      : "▼"
                    : ""}
                </th>
                <th
                  className="px-2 py-2 text-left cursor-pointer select-none"
                  onClick={() => toggleUnmappedTplSort("planName")}
                >
                  Plan{" "}
                  {unmappedTplSortKey === "planName"
                    ? unmappedTplSortDir === "asc"
                      ? "▲"
                      : "▼"
                    : ""}
                </th>
                <th
                  className="px-2 py-2 text-right cursor-pointer select-none"
                  onClick={() => toggleUnmappedTplSort("termMonths")}
                >
                  Term{" "}
                  {unmappedTplSortKey === "termMonths"
                    ? unmappedTplSortDir === "asc"
                      ? "▲"
                      : "▼"
                    : ""}
                </th>
                <th
                  className="px-2 py-2 text-left cursor-pointer select-none"
                  onClick={() => toggleUnmappedTplSort("eflVersionCode")}
                >
                  Ver{" "}
                  {unmappedTplSortKey === "eflVersionCode"
                    ? unmappedTplSortDir === "asc"
                      ? "▲"
                      : "▼"
                    : ""}
                </th>
                <th
                  className="px-2 py-2 text-left cursor-pointer select-none"
                  onClick={() => toggleUnmappedTplSort("updatedAt")}
                >
                  Updated{" "}
                  {unmappedTplSortKey === "updatedAt"
                    ? unmappedTplSortDir === "asc"
                      ? "▲"
                      : "▼"
                    : ""}
                </th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedUnmappedTplRows.map((r: any) => {
                const eflUrl = String(r?.eflUrl ?? "").trim();
                const runHref =
                  eflUrl
                    ? `/admin/efl/fact-cards?${new URLSearchParams({
                        eflUrl,
                      }).toString()}`
                    : "";
                const updatedAt =
                  r?.updatedAt ? String(r.updatedAt).slice(0, 19).replace("T", " ") : "-";
                return (
                  <tr key={String(r.id)} className="border-t h-12">
                    <td className="px-2 py-2">{r.utilityId ?? "-"}</td>
                    <td className="px-2 py-2">{r.supplier ?? "-"}</td>
                    <td className="px-2 py-2">{r.planName ?? "-"}</td>
                    <td className="px-2 py-2 text-right">
                      {typeof r.termMonths === "number" ? `${r.termMonths} mo` : "-"}
                    </td>
                    <td className="px-2 py-2">{r.eflVersionCode ?? "-"}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-gray-700">{updatedAt}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        {runHref ? (
                          <a
                            className="px-2 py-1 rounded border hover:bg-gray-50"
                            href={runHref}
                            title="Details: open manual runner prefilled with this EFL"
                          >
                            Details
                          </a>
                        ) : (
                          <span
                            className="px-2 py-1 rounded border text-gray-400 border-gray-200 cursor-not-allowed"
                            title="No eflUrl available to open details."
                          >
                            Details
                          </span>
                        )}
                        {eflUrl ? (
                          <a
                            className="px-2 py-1 rounded border hover:bg-gray-50"
                            href={eflUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Open EFL
                          </a>
                        ) : null}
                        <button
                          className="px-2 py-1 rounded border hover:bg-red-50 text-red-700 border-red-200"
                          onClick={() => void invalidateTemplate(String(r.id))}
                        >
                          Invalidate
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedUnmappedTplRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={7}>
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
              ({tplRows.length}
              {typeof tplTotalCount === "number" && Number.isFinite(tplTotalCount)
                ? ` / ${tplTotalCount}`
                : ""}
              )
            </span>
          </h2>
          {buildInfo ? (
            <div className="text-[11px] text-gray-500 font-mono">
              build: {buildInfo.ref ?? "—"}@{buildInfo.sha ? buildInfo.sha.slice(0, 7) : "—"}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void loadTemplates()} disabled={!ready || tplLoading}>
              {tplLoading ? "Loading…" : "Refresh"}
            </button>
            <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void refreshTdspSnapshots()} disabled={!ready || tplLoading}>
              Refresh TDSP snapshots
            </button>
            <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void backfillModeledProofIntoDb()} disabled={!ready || tplLoading}>
              Backfill modeled proof (DB)
            </button>
            <button
              className="px-3 py-2 rounded-lg border border-amber-200 text-amber-800 hover:bg-amber-50 disabled:opacity-60"
              onClick={() => void revalidateTemplatesAndQuarantine()}
              disabled={!ready || tplLoading}
              title="Recompute plan-calc + quarantine templates that fail new guardrails."
            >
              Revalidate + quarantine (guardrails)
            </button>
            <label className="flex items-center gap-2 text-xs text-gray-700 select-none">
              <input
                type="checkbox"
                checked={backfillIncludeNonStrong}
                onChange={(e) => setBackfillIncludeNonStrong(e.target.checked)}
                disabled={!ready || tplLoading}
              />
              Include WEAK/FAIL
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 select-none">
              <input
                type="checkbox"
                checked={backfillOverwrite}
                onChange={(e) => setBackfillOverwrite(e.target.checked)}
                disabled={!ready || tplLoading}
              />
              Overwrite existing
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 select-none" title="When off, hide legacy templates that lack canonical modeled validation proof (new-system only).">
              <input
                type="checkbox"
                checked={tplIncludeLegacy}
                onChange={(e) => setTplIncludeLegacy(e.target.checked)}
                disabled={!ready || tplLoading}
              />
              Include legacy
            </label>
            <button className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60" onClick={() => void cleanupInvalidTemplates()} disabled={!ready || tplLoading}>
              Cleanup missing fields
            </button>
            <button
              className="px-3 py-2 rounded-lg border border-blue-200 text-blue-800 hover:bg-blue-50 disabled:opacity-60"
              onClick={() => void runTemplateHygiene(false)}
              disabled={!ready || tplLoading || hygieneLoading}
              title="Scan templates that look like legacy/junk (missing identity fields) and report which are orphaned vs linked to offers."
            >
              {hygieneLoading ? "Hygiene…" : "Hygiene scan"}
            </button>
            <button
              className="px-3 py-2 rounded-lg border border-blue-200 text-blue-800 hover:bg-blue-50 disabled:opacity-60"
              onClick={() => void runTemplateHygiene(true)}
              disabled={!ready || tplLoading || hygieneLoading}
              title="Invalidate ONLY orphan junk templates (no OfferIdRatePlanMap link). Safe alternative to 'Cleanup missing fields'."
            >
              Invalidate orphan junk
            </button>
            <button className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60" onClick={() => void invalidateAllTemplates()} disabled={!ready || tplLoading}>
              Invalidate ALL templates (danger)
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-gray-700">
            Hygiene limit{" "}
            <input
              className="ml-2 w-24 rounded-lg border px-3 py-2 text-sm"
              type="number"
              min={1}
              max={5000}
              value={hygieneLimit}
              onChange={(e) =>
                setHygieneLimit(Math.max(1, Math.min(5000, numOrNull(e.target.value) ?? 500)))
              }
              disabled={!ready || hygieneLoading}
            />
          </label>
          {hygieneErr ? <div className="text-sm text-red-700">{hygieneErr}</div> : null}
        </div>
        {hygieneRaw ? (
          <details className="rounded-xl border bg-gray-50 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Hygiene report (click to expand)
            </summary>
            <pre className="mt-2 text-xs overflow-x-auto">{pretty(hygieneRaw)}</pre>
          </details>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <input className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-sm" placeholder="Search supplier / plan / cert / version / sha…" value={tplQ} onChange={(e) => setTplQ(e.target.value)} />
          <input className="w-28 rounded-lg border px-3 py-2 text-sm" type="number" min={1} max={1000} value={tplLimit} onChange={(e) => setTplLimit(Math.max(1, Math.min(1000, numOrNull(e.target.value) ?? 200)))} />
          <select
            className="w-[160px] rounded-lg border px-3 py-2 text-sm"
            value={tplSimTdspSlug}
            onChange={(e) => setTplSimTdspSlug(e.target.value)}
            title="Simulate a TDSP territory without needing a real home"
          >
            <option value="">Sim TDSP (off)</option>
            <option value="oncor">ONCOR</option>
            <option value="centerpoint">CENTERPOINT</option>
            <option value="aep_north">AEP_NORTH</option>
            <option value="aep_central">AEP_CENTRAL</option>
            <option value="tnmp">TNMP</option>
          </select>
          <input
            className="w-[180px] rounded-lg border px-3 py-2 text-sm"
            placeholder="Sim avg kWh/mo"
            value={tplSimAvgMonthlyKwh}
            onChange={(e) => setTplSimAvgMonthlyKwh(e.target.value)}
            disabled={!tplSimTdspSlug.trim()}
            title="Used only when Sim TDSP is set"
          />
          <input
            className="w-[260px] rounded-lg border px-3 py-2 text-sm font-mono"
            placeholder="homeId (usage context)"
            value={tplHomeId}
            onChange={(e) => setTplHomeId(e.target.value)}
            title="Optional: attach usage-based monthly estimates using this homeId (reads usage bucket tables)."
            disabled={tplSimTdspSlug.trim().length > 0}
          />
          <select
            className="rounded-lg border px-3 py-2 text-sm"
            value={tplSortKey}
            onChange={(e) => {
              setTplAutoSort(false);
              setTplSortKey(e.target.value as any);
              setTplSortDir("asc");
            }}
            title="Sort key"
          >
            <option value="bestForYou">Best for you (Est. $/mo)</option>
            <option value="rate1000">1000 kWh</option>
            <option value="rate500">500 kWh</option>
            <option value="rate2000">2000 kWh</option>
            <option value="supplier">Supplier</option>
            <option value="planName">Plan</option>
            <option value="utilityId">Utility</option>
            <option value="termMonths">Term</option>
            <option value="planType">Type</option>
            <option value="queued">Queued</option>
            <option value="queuedReason">Why</option>
            <option value="passStrength">Strength</option>
            <option value="eflVersionCode">Ver</option>
          </select>
          <button className="px-3 py-2 rounded-lg border hover:bg-gray-50" onClick={() => void loadTemplates()} disabled={!ready || tplLoading}>
            Apply
          </button>
        </div>
        {tplErr ? <div className="text-sm text-red-700">{tplErr}</div> : null}
        {tdspNote ? <div className="text-xs text-gray-600">{tdspNote}</div> : null}
        {tplUsageNote ? <div className="text-xs text-gray-600">{tplUsageNote}</div> : null}

        {/* ~5 visible rows + sticky header */}
        <div className="overflow-x-auto overflow-y-auto max-h-[280px] rounded-xl border">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
              <tr className="h-10">
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("bestForYou")}>
                  Best {tplSortKey === "bestForYou" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("utilityId")}>
                  Utility {tplSortKey === "utilityId" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("supplier")}>
                  Supplier {tplSortKey === "supplier" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("planName")}>
                  Plan {tplSortKey === "planName" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("planType")}>
                  Type {tplSortKey === "planType" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
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
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("passStrength")}>
                  Strength {tplSortKey === "passStrength" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("queued")}>
                  Queued {tplSortKey === "queued" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-2 py-2 text-left cursor-pointer select-none" onClick={() => toggleTplSort("queuedReason")}>
                  Why {tplSortKey === "queuedReason" ? (tplSortDir === "asc" ? "▲" : "▼") : ""}
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
                const offerId = String((r as any)?.offerId ?? "").trim();
                const pcStatus = String((r as any)?.planCalcStatus ?? "UNKNOWN").toUpperCase();
                const pcReason = String((r as any)?.planCalcReasonCode ?? "").trim();
                const isOverridden = pcReason === "ADMIN_OVERRIDE_COMPUTABLE";
                const runHref =
                  eflUrl
                    ? `/admin/efl/fact-cards?${new URLSearchParams({
                        eflUrl,
                        ...(offerId ? { offerId } : {}),
                      }).toString()}`
                    : "";
                const planTypeLabel = deriveTemplatePlanTypeLabel(r);
                const est = (r as any)?.usageEstimate ?? null;
                const estMonthly =
                  typeof est?.monthlyCostDollars === "number" && Number.isFinite(est.monthlyCostDollars)
                    ? est.monthlyCostDollars
                    : null;
                const estStatus = String(est?.status ?? "").trim();
                const estReason = String(est?.reason ?? "").trim();
                const avgMonthly =
                  typeof (r as any)?.usagePreview?.avgMonthlyKwhByKey?.["kwh.m.all.total"] === "number"
                    ? (r as any).usagePreview.avgMonthlyKwhByKey["kwh.m.all.total"]
                    : null;
                return (
                  <tr key={r.id} className="border-t h-12">
                    <td className="px-2 py-2">
                      {estMonthly != null ? (
                        <div className="font-mono">{`$${estMonthly.toFixed(2)}/mo`}</div>
                      ) : estStatus ? (
                        <div className="font-mono text-[11px] text-gray-500" title={estReason || estStatus}>
                          {estStatus}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">{r.utilityId ?? "-"}</td>
                    <td className="px-2 py-2">{r.supplier ?? "-"}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col gap-1">
                        <div>{r.planName ?? "-"}</div>
                        <div className="text-[11px] text-gray-600 font-mono">
                          calc: {pcStatus}
                          {pcReason ? ` (${pcReason})` : ""}
                        </div>
                        {avgMonthly != null ? (
                          <div className="text-[11px] text-gray-700">
                            {estMonthly != null
                              ? `Est. $${estMonthly.toFixed(2)}/mo · incl. TDSP · based on your historic usage of ${avgMonthly.toFixed(0)} kWh/mo`
                              : `Based on your historic usage of ${avgMonthly.toFixed(0)} kWh/mo${estStatus ? ` · est: ${estStatus}${estReason ? ` (${estReason})` : ""}` : ""}`}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-60"
                            disabled={!ready || tplLoading}
                            title="Force planCalcStatus=COMPUTABLE (sets reason ADMIN_OVERRIDE_COMPUTABLE)."
                            onClick={() =>
                              void setTemplateComputableOverride({
                                ratePlanId: String(r.id),
                                offerId: offerId || null,
                                enable: true,
                              })
                            }
                          >
                            Force COMPUTABLE
                          </button>
                          <button
                            className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-60"
                            disabled={!ready || tplLoading || !isOverridden}
                            title={
                              isOverridden
                                ? "Undo override and re-derive planCalcStatus/Reason from the template."
                                : "No override is set for this row."
                            }
                            onClick={() =>
                              void setTemplateComputableOverride({
                                ratePlanId: String(r.id),
                                offerId: offerId || null,
                                enable: false,
                              })
                            }
                          >
                            Reset derived
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px]">{planTypeLabel}</td>
                    <td className="px-2 py-2 text-right">{typeof r.termMonths === "number" ? `${r.termMonths} mo` : "-"}</td>
                    <td className="px-2 py-2 text-right">
                      <div className="font-mono">{typeof r.rate500 === "number" ? r.rate500.toFixed(3) : "—"}</div>
                      <div
                        className="font-mono text-[10px] text-gray-600"
                        title={
                          r?.modeledTdspCode
                            ? `Admin sanity check: adds TDSP delivery from snapshot (${r.modeledTdspCode} @ ${String(r.modeledTdspSnapshotAt ?? "").slice(0, 10) || "latest"}).`
                            : "Admin sanity check: modeled all-in rates require a TDSP snapshot; customer pricing uses TDSP from address."
                        }
                      >
                        {typeof r.modeledRate500 === "number"
                          ? `model ${r.modeledRate500.toFixed(3)}${r?.modeledTdspCode ? ` (${r.modeledTdspCode} ${String(r.modeledTdspSnapshotAt ?? "").slice(0, 10) || "latest"})` : ""}`
                          : "model —"}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="font-mono">{typeof r.rate1000 === "number" ? r.rate1000.toFixed(3) : "—"}</div>
                      <div
                        className="font-mono text-[10px] text-gray-600"
                        title={
                          r?.modeledTdspCode
                            ? `Admin sanity check: adds TDSP delivery from snapshot (${r.modeledTdspCode} @ ${String(r.modeledTdspSnapshotAt ?? "").slice(0, 10) || "latest"}).`
                            : "Admin sanity check: modeled all-in rates require a TDSP snapshot; customer pricing uses TDSP from address."
                        }
                      >
                        {typeof r.modeledRate1000 === "number"
                          ? `model ${r.modeledRate1000.toFixed(3)}${r?.modeledTdspCode ? ` (${r.modeledTdspCode} ${String(r.modeledTdspSnapshotAt ?? "").slice(0, 10) || "latest"})` : ""}`
                          : "model —"}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="font-mono">{typeof r.rate2000 === "number" ? r.rate2000.toFixed(3) : "—"}</div>
                      <div
                        className="font-mono text-[10px] text-gray-600"
                        title={
                          r?.modeledTdspCode
                            ? `Admin sanity check: adds TDSP delivery from snapshot (${r.modeledTdspCode} @ ${String(r.modeledTdspSnapshotAt ?? "").slice(0, 10) || "latest"}).`
                            : "Admin sanity check: modeled all-in rates require a TDSP snapshot; customer pricing uses TDSP from address."
                        }
                      >
                        {typeof r.modeledRate2000 === "number"
                          ? `model ${r.modeledRate2000.toFixed(3)}${r?.modeledTdspCode ? ` (${r.modeledTdspCode} ${String(r.modeledTdspSnapshotAt ?? "").slice(0, 10) || "latest"})` : ""}`
                          : "model —"}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={
                          (r as any)?.passStrength === "STRONG"
                            ? "inline-flex px-2 py-0.5 rounded-full bg-green-100 text-green-800"
                            : (r as any)?.passStrength === "WEAK"
                              ? "inline-flex px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800"
                              : (r as any)?.passStrength === "INVALID"
                                ? "inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-800"
                                : "inline-flex px-2 py-0.5 rounded-full bg-gray-100 text-gray-700"
                        }
                        title={
                          (r as any)?.validationStatus
                            ? `Validation: ${(r as any).validationStatus}`
                            : "Validation: —"
                        }
                      >
                        {(r as any)?.passStrength ?? "—"}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {Boolean((r as any)?.queued) ? (
                        <span
                          className="inline-flex px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
                          title={`planCalcStatus=${String((r as any)?.planCalcStatus ?? "UNKNOWN")}`}
                        >
                          YES
                        </span>
                      ) : (
                        <span
                          className="inline-flex px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800"
                          title={`planCalcStatus=${String((r as any)?.planCalcStatus ?? "COMPUTABLE")}`}
                        >
                          NO
                        </span>
                      )}
                    </td>
                    <td
                      className="px-2 py-2 font-mono text-[11px]"
                      title={String((r as any)?.queuedReason ?? (r as any)?.planCalcReasonCode ?? "")}
                    >
                      {Boolean((r as any)?.queued)
                        ? ((r as any)?.queuedReason ?? (r as any)?.planCalcReasonCode ?? "UNKNOWN")
                        : "—"}
                    </td>
                    <td className="px-2 py-2">{r.eflVersionCode ?? "-"}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        {offerId ? (
                          <a
                            className="px-2 py-1 rounded border hover:bg-gray-50"
                            href={`/admin/plans/${encodeURIComponent(offerId)}`}
                          >
                            Details
                          </a>
                        ) : runHref ? (
                          <a
                            className="px-2 py-1 rounded border hover:bg-gray-50"
                            href={runHref}
                            title="Details (no offerId): open the manual runner prefilled with this EFL"
                          >
                            Details
                          </a>
                        ) : (
                          <span
                            className="px-2 py-1 rounded border text-gray-400 border-gray-200 cursor-not-allowed"
                            title="No offerId or eflUrl available to open details."
                          >
                            Details
                          </span>
                        )}
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
                  <td className="px-2 py-3 text-gray-500" colSpan={14}>
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
        <ManualFactCardLoader
          adminToken={token}
          prefillEflUrl={manualPrefillUrl}
          prefillOfferId={manualPrefillOfferId}
          prefillRawText={manualPrefillRawText}
        />
      </section>
    </div>
  );
}

