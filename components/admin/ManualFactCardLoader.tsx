/**
 * Manual Fact Card Loader — unified component
 * - Run from URL (server fetch + parse)
 * - Upload PDF (manual upload pipeline)
 * - Paste EFL text (manual text pipeline)
 * - Shows deterministic extract metadata + prompt + field checklist + raw text preview
 */
"use client";

import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { introspectPlanFromRateStructure } from "@/lib/plan-engine/introspectPlanFromRateStructure";

type UploadResponse = {
  ok: true;
  build?: { vercelGitCommitSha?: string | null; vercelEnv?: string | null };
  eflUrl?: string;
  eflPdfSha256: string;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  warnings: string[];
  prompt: string;
  rawTextPreview: string;
  rawTextLength: number;
  rawTextTruncated: boolean;
  extractorMethod?: "pdf-parse" | "pdfjs" | "vision" | "pdftotext";
  planRules?: unknown;
  rateStructure?: unknown;
  parseConfidence?: number;
  parseWarnings?: string[];
  validation?: any | null;
  derivedForValidation?: any | null;
  passStrength?: "STRONG" | "WEAK" | "INVALID" | null;
  passStrengthReasons?: string[];
  passStrengthOffPointDiffs?: Array<{
    usageKwh: number;
    expectedInterp: number;
    modeled: number | null;
    diff: number | null;
    ok: boolean;
  }> | null;
  templatePersisted?: boolean;
  persistedRatePlanId?: string | null;
  autoResolvedQueueCount?: number;
  persistAttempted?: boolean;
  persistUsedDerived?: boolean;
  persistNotes?: string | null;
  queueAutoResolveAttempted?: boolean;
  queueAutoResolveCriteria?: any;
  queueAutoResolveOpenMatchesCount?: number;
  queueAutoResolveOpenMatchesPreview?: any[];
  queueAutoResolveUpdatedCount?: number;
  ai?: { enabled: boolean; hasKey: boolean; used: boolean; reason?: string };
};

type UploadError = { ok: false; error: any };

function pretty(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ManualFactCardLoader(props: {
  adminToken?: string;
  prefillEflUrl?: string;
  prefillOfferId?: string;
  onPrefillConsumed?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"url" | "upload" | "text">("url");
  const [eflUrl, setEflUrl] = useState("");
  const [offerId, setOfferId] = useState("");
  const [overridePdfUrl, setOverridePdfUrl] = useState("");
  const [forceReparse, setForceReparse] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>("No file selected");
  const [pastedText, setPastedText] = useState("");
  // Default ON: admins want to see the "fact-card-like" text output immediately.
  const [showRawPreview, setShowRawPreview] = useState(true);

  const lastPrefillRef = useRef<string>("");
  useEffect(() => {
    const next = (props.prefillEflUrl ?? "").trim();
    if (!next) return;
    if (next === lastPrefillRef.current) return;
    lastPrefillRef.current = next;
    setActiveTab("url");
    setEflUrl(next);
    setOverridePdfUrl("");
    setOfferId((props.prefillOfferId ?? "").trim());
    props.onPrefillConsumed?.();
  }, [props.prefillEflUrl, props]);

  const headerToken = useMemo(() => (props.adminToken ?? "").trim(), [props.adminToken]);

  async function handleSubmitUrl(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const u = eflUrl.trim();
    if (!u) {
      setError("Paste an EFL URL first.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/efl/manual-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(headerToken ? { "x-admin-token": headerToken } : {}),
        },
        body: JSON.stringify({
          eflUrl: u,
          forceReparse,
          offerId: offerId.trim() || undefined,
          overridePdfUrl: overridePdfUrl.trim() || undefined,
        }),
      });
      const data = (await res.json()) as UploadResponse | UploadError;
      if (!res.ok || !(data as any)?.ok) {
        throw new Error(
          typeof (data as any)?.error === "string"
            ? (data as any).error
            : `HTTP ${res.status}`,
        );
      }
      setResult(data as UploadResponse);
    } catch (err: any) {
      setError(err?.message || "Run from URL failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file) {
      setError("Please choose an EFL PDF to upload.");
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const url = forceReparse ? "/api/admin/efl/manual-upload?force=1" : "/api/admin/efl/manual-upload";
      const response = await fetch(url, {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as UploadResponse | UploadError;
      if (!response.ok || !(data as any)?.ok) {
        throw new Error(
          typeof (data as any)?.error === "string"
            ? (data as any).error
            : "Unexpected error while processing PDF.",
        );
      }
      setResult(data as UploadResponse);
    } catch (err: any) {
      setError(err?.message || "Upload failed. Please try again with a valid EFL PDF.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmitText(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const trimmed = pastedText.trim();
    if (!trimmed) {
      setError("Paste the visible EFL text before processing.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/efl/manual-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: trimmed }),
      });

      const data = (await response.json()) as UploadResponse | UploadError;
      if (!response.ok || !(data as any)?.ok) {
        throw new Error(
          typeof (data as any)?.error === "string"
            ? (data as any).error
            : "Unexpected error while processing pasted text.",
        );
      }
      setResult(data as UploadResponse);
    } catch (err: any) {
      setError(err?.message || "Processing pasted text failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const derived = result?.derivedForValidation ?? null;
  const derivedText = derived ? pretty(derived) : null;
  const planEngineView = useMemo(() => {
    const rs = (result as any)?.rateStructure ?? null;
    if (!rs) return null;
    try {
      return introspectPlanFromRateStructure({ rateStructure: rs });
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }, [result]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold text-brand-navy">Manual Fact Card Loader</h2>
        <p className="text-sm text-brand-navy/70">
          Upload an official EFL PDF, paste an EFL URL, or paste EFL text. Review the deterministic extract and
          copy the AI prompt required to generate authoritative PlanRules.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`px-3 py-1.5 rounded-lg border text-sm ${activeTab === "url" ? "bg-brand-blue/10 border-brand-blue/40" : "bg-white"}`}
          onClick={() => setActiveTab("url")}
        >
          EFL URL
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 rounded-lg border text-sm ${activeTab === "upload" ? "bg-brand-blue/10 border-brand-blue/40" : "bg-white"}`}
          onClick={() => setActiveTab("upload")}
        >
          Upload PDF
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 rounded-lg border text-sm ${activeTab === "text" ? "bg-brand-blue/10 border-brand-blue/40" : "bg-white"}`}
          onClick={() => setActiveTab("text")}
        >
          Paste text
        </button>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs text-brand-navy/70">
          <input
            type="checkbox"
            checked={forceReparse}
            onChange={(e) => setForceReparse(e.target.checked)}
            className="h-4 w-4 rounded border-brand-blue text-brand-blue focus:ring-brand-blue"
          />
          Force reparse (recommended)
        </label>
        <label className="flex items-center gap-2 text-xs text-brand-navy/70">
          <span className="text-[11px]">
            Pipeline: deterministic extract → AI assist (optional) → validator → solver (validation-only)
          </span>
        </label>
      </div>

      {activeTab === "url" ? (
        <form onSubmit={handleSubmitUrl} className="space-y-3 rounded-lg border border-brand-blue/20 bg-brand-white p-4">
          <div>
            <label className="block text-sm font-medium text-brand-navy mb-1">EFL URL</label>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={eflUrl}
              onChange={(e) => setEflUrl(e.target.value)}
              placeholder="https://.../electricity-facts-label.pdf"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-brand-navy mb-1">offerId (optional)</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                value={offerId}
                onChange={(e) => setOfferId(e.target.value)}
                placeholder="wbdb-..."
              />
              <div className="mt-1 text-[11px] text-brand-navy/60">
                If provided, successful template persistence will auto-resolve matching OPEN quarantine rows by offerId.
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-navy mb-1">Override EFL PDF URL (optional)</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={overridePdfUrl}
                onChange={(e) => setOverridePdfUrl(e.target.value)}
                placeholder="https://ohm-gridlink.smartgridcis.net/Documents/Download.aspx?ProductDocumentID=..."
              />
              <div className="mt-1 text-[11px] text-brand-navy/60">
                Use this when the EFL URL is a WattBuy enrollment page blocked by WAF. Paste the “Electricity Facts Label”
                direct PDF link instead.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center rounded-md border border-brand-blue bg-brand-blue/10 px-3 py-1.5 text-sm font-medium text-brand-navy transition hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {isSubmitting ? "Processing…" : "Process Fact Card"}
            </button>
            <button
              type="button"
              disabled={!eflUrl.trim()}
              className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
              onClick={async () => {
                const ok = await copyToClipboard(eflUrl.trim());
                if (!ok) setError("Unable to copy URL to clipboard.");
              }}
            >
              Copy URL
            </button>
            <button
              type="button"
              disabled={!eflUrl.trim()}
              className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
              onClick={() => {
                const u = eflUrl.trim();
                if (!u) return;
                window.open(u, "_blank", "noopener,noreferrer");
              }}
            >
              Open
            </button>
          </div>
        </form>
      ) : null}

      {activeTab === "upload" ? (
        <form
          onSubmit={handleSubmitUpload}
          className="space-y-4 rounded-lg border border-brand-blue/20 bg-brand-white p-4"
          encType="multipart/form-data"
        >
          <div>
            <label className="block text-sm font-medium text-brand-navy mb-2">EFL PDF</label>
            <input
              type="file"
              name="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                setFileLabel(file ? file.name : "No file selected");
              }}
              className="block w-full text-sm text-brand-navy file:mr-4 file:rounded-md file:border-0 file:bg-brand-blue/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-navy hover:file:bg-brand-blue/20"
            />
            <p className="mt-1 text-xs text-brand-navy/60">{fileLabel}</p>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center rounded-md border border-brand-blue bg-brand-blue/10 px-3 py-1.5 text-sm font-medium text-brand-navy transition hover:bg-brand-blue/20 disabled:opacity-60"
          >
            {isSubmitting ? "Processing…" : "Process Fact Card"}
          </button>
        </form>
      ) : null}

      {activeTab === "text" ? (
        <form onSubmit={handleSubmitText} className="space-y-3 rounded-lg border border-dashed border-brand-blue/25 bg-brand-blue/5 p-4">
          <div>
            <label className="block text-sm font-medium text-brand-navy mb-1">Or paste EFL text</label>
            <p className="mb-2 text-xs text-brand-navy/70">
              If you only have a screenshot, open the EFL, select all visible text, copy, and paste it here.
            </p>
            <textarea
              className="h-40 w-full resize-none rounded-md border border-brand-blue/30 bg-white px-3 py-2 text-xs font-mono text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="Paste the full EFL text here…"
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center rounded-md border border-brand-blue bg-brand-blue/10 px-3 py-1.5 text-sm font-medium text-brand-navy transition hover:bg-brand-blue/20 disabled:opacity-60"
          >
            {isSubmitting ? "Processing…" : "Process Pasted Text"}
          </button>
        </form>
      ) : null}

      {error ? <div className="text-sm text-red-700">{error}</div> : null}

      {result ? (
        <div className="space-y-4 rounded-lg border border-brand-blue/20 bg-brand-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-brand-navy/80">
              <span className="font-semibold">PDF SHA-256</span>{" "}
              <span className="font-mono text-[12px]">{result.eflPdfSha256}</span>
            </div>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
              onClick={async () => {
                const meta = [
                  "Deterministic Extract",
                  "Copy the metadata below into the database when creating a new rate card. The prompt should be fed to the AI extraction layer to produce the authoritative PlanRules.",
                  "",
                  "PDF SHA-256",
                  result.eflPdfSha256,
                  "REP PUCT Certificate",
                  result.repPuctCertificate ?? "—",
                  "EFL Version Code (Ver. #)",
                  result.eflVersionCode ?? "—",
                  "Extraction Method",
                  result.extractorMethod ?? "pdftotext",
                  "Warnings",
                  (result.warnings ?? []).join(" "),
                  "PlanRules Prompt",
                  "Copy Prompt",
                  result.prompt,
                ].join("\n");
                const ok = await copyToClipboard(meta);
                if (!ok) setError("Unable to copy metadata.");
              }}
            >
              Copy metadata + prompt
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 text-xs text-brand-navy/80">
            <div>
              <div className="font-semibold text-brand-navy mb-1">Build</div>
              <div className="font-mono">
                {result.build?.vercelEnv ?? "—"}{" "}
                {result.build?.vercelGitCommitSha
                  ? `(${String(result.build.vercelGitCommitSha).slice(0, 8)})`
                  : ""}
              </div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">REP PUCT Certificate</div>
              <div className="font-mono">{result.repPuctCertificate ?? "—"}</div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">EFL Version Code</div>
              <div className="font-mono">{result.eflVersionCode ?? "—"}</div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Extractor</div>
              <div className="font-mono">{result.extractorMethod ?? "pdftotext"}</div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Confidence</div>
              <div className="font-mono">
                {typeof result.parseConfidence === "number" ? `${Math.round(result.parseConfidence * 100)}%` : "—"}
              </div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">PASS strength</div>
              <div className="font-mono">
                {result.passStrength ?? "—"}
                {Array.isArray(result.passStrengthReasons) && result.passStrengthReasons.length
                  ? ` (${result.passStrengthReasons.join(",")})`
                  : ""}
              </div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Template persisted</div>
              <div className="font-mono">
                {typeof result.templatePersisted === "boolean"
                  ? result.templatePersisted
                    ? "YES"
                    : "NO"
                  : "—"}
                {result.persistedRatePlanId ? ` (RatePlan.id=${result.persistedRatePlanId})` : ""}
              </div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy mb-1">Queue auto-resolved</div>
              <div className="font-mono">
                {typeof result.autoResolvedQueueCount === "number"
                  ? String(result.autoResolvedQueueCount)
                  : "—"}
              </div>
            </div>
          </div>

          {Array.isArray(result.passStrengthOffPointDiffs) && result.passStrengthOffPointDiffs.length ? (
            <details className="rounded-lg border bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand-navy">
                Off-point diffs (750 / 1250 / 1500 kWh)
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="text-gray-700">
                    <tr className="h-9 border-b bg-gray-50">
                      <th className="px-2 text-left">kWh</th>
                      <th className="px-2 text-right">expected (interp)</th>
                      <th className="px-2 text-right">modeled</th>
                      <th className="px-2 text-right">diff</th>
                      <th className="px-2 text-left">ok</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.passStrengthOffPointDiffs.map((d) => (
                      <tr key={d.usageKwh} className="border-b">
                        <td className="px-2 py-2 font-mono">{d.usageKwh}</td>
                        <td className="px-2 py-2 text-right font-mono">
                          {Number.isFinite(d.expectedInterp) ? d.expectedInterp.toFixed(3) : "—"}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {typeof d.modeled === "number" && Number.isFinite(d.modeled)
                            ? d.modeled.toFixed(3)
                            : "—"}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {typeof d.diff === "number" && Number.isFinite(d.diff)
                            ? d.diff.toFixed(3)
                            : "—"}
                        </td>
                        <td className="px-2 py-2 font-mono">{d.ok ? "true" : "false"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-brand-navy">Raw Text Preview ({result.rawTextLength.toLocaleString()} chars)</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs underline text-brand-navy/70"
                  onClick={() => setShowRawPreview((v) => !v)}
                >
                  {showRawPreview ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  className="text-xs underline text-brand-navy/70"
                  onClick={async () => {
                    const ok = await copyToClipboard(result.rawTextPreview ?? "");
                    if (!ok) setError("Unable to copy preview.");
                  }}
                >
                  Copy Preview
                </button>
              </div>
            </div>
            {showRawPreview ? (
              <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-72">{result.rawTextPreview}</pre>
            ) : null}
          </div>

          <details className="rounded-lg border bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-brand-navy">
              Parsed Plan Snapshot (EFL pipeline output)
            </summary>
            <pre className="mt-2 text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">
              {pretty({
                planRules: result.planRules ?? null,
                rateStructure: result.rateStructure ?? null,
                parseWarnings: result.parseWarnings ?? null,
                validation: result.validation ?? null,
                ai: result.ai ?? null,
                passStrength: (result as any).passStrength ?? null,
                passStrengthReasons: (result as any).passStrengthReasons ?? null,
                passStrengthOffPointDiffs: (result as any).passStrengthOffPointDiffs ?? null,
                templatePersisted: (result as any).templatePersisted ?? null,
                persistedRatePlanId: (result as any).persistedRatePlanId ?? null,
                autoResolvedQueueCount: (result as any).autoResolvedQueueCount ?? null,
                persistAttempted: (result as any).persistAttempted ?? null,
                persistUsedDerived: (result as any).persistUsedDerived ?? null,
                persistNotes: (result as any).persistNotes ?? null,
                queueAutoResolveAttempted: (result as any).queueAutoResolveAttempted ?? null,
                queueAutoResolveCriteria: (result as any).queueAutoResolveCriteria ?? null,
                queueAutoResolveOpenMatchesCount: (result as any).queueAutoResolveOpenMatchesCount ?? null,
                queueAutoResolveOpenMatchesPreview: (result as any).queueAutoResolveOpenMatchesPreview ?? null,
                queueAutoResolveUpdatedCount: (result as any).queueAutoResolveUpdatedCount ?? null,
              })}
            </pre>
          </details>

          {planEngineView ? (
            <details className="rounded-lg border bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Plan Engine View (introspection)</summary>
              {"planCalc" in (planEngineView as any) ? (
                <div className="mt-2 space-y-3">
                  <div className="grid gap-2 md:grid-cols-2 text-xs">
                    <div className="rounded border bg-gray-50 p-2">
                      <div className="font-semibold text-brand-navy">Computability (dashboard-safe)</div>
                      <div className="mt-1 font-mono">
                        status={(planEngineView as any).planCalc.planCalcStatus}{" "}
                        reason={(planEngineView as any).planCalc.planCalcReasonCode}
                      </div>
                    </div>
                    <div className="rounded border bg-gray-50 p-2">
                      <div className="font-semibold text-brand-navy">Required buckets</div>
                      <div className="mt-1 font-mono break-all">
                        {Array.isArray((planEngineView as any).requiredBucketKeys)
                          ? (planEngineView as any).requiredBucketKeys.join(", ")
                          : "—"}
                      </div>
                    </div>
                  </div>

                  {(planEngineView as any)?.indexed?.isIndexed ? (
                    <div className="rounded border bg-gray-50 p-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold text-brand-navy">Indexed / Variable</div>
                        {(planEngineView as any)?.indexed?.approxPossible ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                            Approx possible (anchors present)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">
                            No anchors found
                          </span>
                        )}
                      </div>
                      <div className="mt-1 font-mono break-all">
                        kind={(planEngineView as any)?.indexed?.kind ?? "—"}{" "}
                        500={(planEngineView as any)?.indexed?.anchors?.centsPerKwhAt500 ?? "—"}{" "}
                        1000={(planEngineView as any)?.indexed?.anchors?.centsPerKwhAt1000 ?? "—"}{" "}
                        2000={(planEngineView as any)?.indexed?.anchors?.centsPerKwhAt2000 ?? "—"}
                      </div>
                    </div>
                  ) : null}

                  {(planEngineView as any)?.tiered?.ok && Array.isArray((planEngineView as any)?.tiered?.schedule?.tiers) ? (
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-brand-navy">Deterministic tiered schedule</div>
                      <div className="overflow-x-auto rounded border">
                        <table className="min-w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-1 text-left">start (kWh)</th>
                              <th className="px-2 py-1 text-left">end (kWh)</th>
                              <th className="px-2 py-1 text-right">¢/kWh</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(planEngineView as any).tiered.schedule.tiers.map((t: any, i: number) => (
                              <tr key={i} className="border-t">
                                <td className="px-2 py-1 font-mono">{String(t?.startKwhInclusive ?? "")}</td>
                                <td className="px-2 py-1 font-mono">{t?.endKwhExclusive == null ? "∞" : String(t?.endKwhExclusive)}</td>
                                <td className="px-2 py-1 text-right font-mono">
                                  {typeof t?.repEnergyCentsPerKwh === "number" ? t.repEnergyCentsPerKwh.toFixed(4) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {(planEngineView as any)?.tou?.schedule?.periods?.length ? (
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-brand-navy">Deterministic TOU schedule</div>
                      <div className="overflow-x-auto rounded border">
                        <table className="min-w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-1 text-left">dayType</th>
                              <th className="px-2 py-1 text-left">window</th>
                              <th className="px-2 py-1 text-left">months</th>
                              <th className="px-2 py-1 text-right">¢/kWh</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(planEngineView as any).tou.schedule.periods.map((p: any, i: number) => (
                              <tr key={i} className="border-t">
                                <td className="px-2 py-1 font-mono">{String(p?.dayType ?? "")}</td>
                                <td className="px-2 py-1 font-mono">
                                  {String(p?.startHHMM ?? "")}-{String(p?.endHHMM ?? "")}
                                </td>
                                <td className="px-2 py-1 font-mono">
                                  {Array.isArray(p?.months) && p.months.length > 0 ? p.months.join(",") : "—"}
                                </td>
                                <td className="px-2 py-1 text-right font-mono">
                                  {typeof p?.repEnergyCentsPerKwh === "number" ? p.repEnergyCentsPerKwh.toFixed(4) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600">
                      TOU schedule: {(planEngineView as any)?.tou?.reasonCode ? String((planEngineView as any).tou.reasonCode) : "—"}
                    </div>
                  )}

                  <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">{pretty(planEngineView)}</pre>
                </div>
              ) : (
                <pre className="mt-2 text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">{pretty(planEngineView)}</pre>
              )}
            </details>
          ) : null}

          {derivedText ? (
            <details className="rounded-lg border bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Derived for validation (gap solver)</summary>
              <pre className="mt-2 text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">{derivedText}</pre>
            </details>
          ) : null}
        </div>
      ) : null}

      <details className="space-y-3 rounded-lg border border-dashed border-brand-blue/30 bg-brand-blue/5 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-brand-navy">
          PlanRules &amp; RateStructure Field Checklist
        </summary>
        <div className="grid gap-4 md:grid-cols-2 text-xs text-brand-navy/80">
          <div>
            <h3 className="mb-1 font-semibold text-brand-navy">PlanRules fields (EFL side)</h3>
            <ul className="space-y-1">
              <li><span className="font-mono text-[11px]">planType</span> — flat / tou / free-nights / free-weekends / solar-buyback / other</li>
              <li><span className="font-mono text-[11px]">defaultRateCentsPerKwh</span> — fallback energy charge when no TOU band applies</li>
              <li><span className="font-mono text-[11px]">baseChargePerMonthCents</span> — REP base charge cents/month</li>
              <li><span className="font-mono text-[11px]">rateType</span> — FIXED / VARIABLE / TIME_OF_USE</li>
              <li><span className="font-mono text-[11px]">variableIndexType</span> — ERCOT / FUEL / OTHER</li>
              <li><span className="font-mono text-[11px]">currentBillEnergyRateCents</span> — current VARIABLE bill's rate when listed</li>
              <li><span className="font-mono text-[11px]">timeOfUsePeriods[]</span> — label, startHour/endHour, daysOfWeek, months, rateCentsPerKwh, isFree</li>
              <li><span className="font-mono text-[11px]">usageTiers[]</span> — minKwh/maxKwh, rateCentsPerKwh</li>
              <li><span className="font-mono text-[11px]">solarBuyback</span> — hasBuyback, creditCentsPerKwh, matchesImportRate, maxMonthlyExportKwh, notes</li>
              <li><span className="font-mono text-[11px]">billCredits[]</span> — label, creditDollars, thresholdKwh, monthsOfYear, type</li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-brand-navy">RateStructure fields (engine side)</h3>
            <ul className="space-y-1">
              <li><span className="font-mono text-[11px]">type</span> — FIXED / VARIABLE / TIME_OF_USE</li>
              <li><span className="font-mono text-[11px]">baseMonthlyFeeCents</span> — carried through from EFL</li>
              <li><span className="font-mono text-[11px]">FIXED.energyRateCents</span> — single blended energy rate</li>
              <li><span className="font-mono text-[11px]">VARIABLE.currentBillEnergyRateCents</span>, <span className="font-mono text-[11px]">indexType</span>, <span className="font-mono text-[11px]">variableNotes</span></li>
              <li><span className="font-mono text-[11px]">TIME_OF_USE.tiers[]</span> — label, priceCents, startTime/endTime, daysOfWeek, monthsOfYear</li>
              <li><span className="font-mono text-[11px]">billCredits.rules[]</span> — label, creditAmountCents, minUsageKWh, maxUsageKWh, monthsOfYear</li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}


