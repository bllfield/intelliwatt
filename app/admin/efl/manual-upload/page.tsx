/**
 * Manual Fact Card Loader — upload an EFL PDF, run deterministic extraction,
 * and generate the AI prompt for PlanRules creation.
 */
"use client";

import React, { useState, FormEvent } from "react";

type UploadResponse = {
  ok: true;
  eflPdfSha256: string;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  warnings: string[];
  prompt: string;
  rawTextPreview: string;
  rawTextLength: number;
  rawTextTruncated: boolean;
  // Best-effort AI outputs so admins can see which endpoint fields the parser fills.
  planRules?: unknown;
  rateStructure?: unknown;
  parseConfidence?: number;
  parseWarnings?: string[];
  validation?: {
    isValid: boolean;
    requiresManualReview: boolean;
    issues: { code: string; message: string; severity: "ERROR" | "WARNING" }[];
  } | null;
};

type UploadError = {
  ok: false;
  error: string;
};

export default function ManualFactCardLoaderPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>("No file selected");
  const [pastedText, setPastedText] = useState("");
  const [isProcessingText, setIsProcessingText] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

      const response = await fetch("/api/admin/efl/manual-upload", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as UploadResponse | UploadError;

      if (!response.ok || !data.ok) {
        throw new Error(
          "error" in data ? data.error : "Unexpected error while processing PDF.",
        );
      }

      setResult(data);
    } catch (err) {
      console.error("[ManualFactCardLoader] upload failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Upload failed. Please try again with a valid EFL PDF.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleProcessText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const trimmed = pastedText.trim();
    if (!trimmed) {
      setError("Paste the visible EFL text before processing.");
      return;
    }

    setIsProcessingText(true);

    try {
      const response = await fetch("/api/admin/efl/manual-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rawText: trimmed }),
      });

      const data = (await response.json()) as UploadResponse | UploadError;

      if (!response.ok || !data.ok) {
        throw new Error(
          "error" in data ? data.error : "Unexpected error while processing pasted text.",
        );
      }

      setResult(data);
    } catch (err) {
      console.error("[ManualFactCardLoader] manual text processing failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Processing pasted text failed. Please try again with valid EFL content.",
      );
    } finally {
      setIsProcessingText(false);
    }
  }

  async function handleCopy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setFileLabel(`${label} copied to clipboard.`);
      setTimeout(() => setFileLabel(result ? "Upload complete" : "Ready for upload"), 1500);
    } catch (err) {
      console.error("[ManualFactCardLoader] copy failed:", err);
      setError("Unable to copy to clipboard in this browser.");
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-brand-navy">Manual Fact Card Loader</h1>
        <p className="mt-2 text-sm text-brand-navy/70">
          Upload an official EFL PDF{" "}
          <span className="font-semibold">or paste the EFL text</span>, review the deterministic
          extract, and copy the AI prompt required to generate a{" "}
          <code className="rounded bg-brand-navy/5 px-1 py-0.5">PlanRules</code> JSON. No data is
          persisted — results are shown only in this browser session.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-brand-blue/20 bg-brand-white p-6 shadow-lg"
          encType="multipart/form-data"
        >
          <div>
            <label className="block text-sm font-medium text-brand-navy mb-2">
              EFL PDF
            </label>
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
            className="inline-flex items-center rounded-md border border-brand-blue bg-brand-blue/10 px-3 py-1.5 text-sm font-medium text-brand-navy transition hover:bg-brand-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Processing…" : "Process Fact Card"}
          </button>
        </form>

        <form
          onSubmit={handleProcessText}
          className="space-y-3 rounded-lg border border-dashed border-brand-blue/25 bg-brand-blue/5 p-6 shadow-sm"
        >
          <div>
            <label className="block text-sm font-medium text-brand-navy mb-1">
              Or paste EFL text
            </label>
            <p className="mb-2 text-xs text-brand-navy/70">
              If pdf-parse fails or you only have a screenshot, open the EFL, select all visible
              text, copy, and paste it here. We&apos;ll run the same deterministic extractor over
              this text.
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
            disabled={isProcessingText}
            className="inline-flex items-center rounded-md border border-brand-blue bg-brand-blue/10 px-3 py-1.5 text-sm font-medium text-brand-navy transition hover:bg-brand-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isProcessingText ? "Processing text…" : "Process Pasted Text"}
          </button>
        </form>
      </div>

      <section className="space-y-3 rounded-lg border border-dashed border-brand-blue/30 bg-brand-blue/5 p-6">
        <h2 className="text-base font-semibold text-brand-navy">
          PlanRules &amp; RateStructure Field Checklist
        </h2>
        <p className="text-xs text-brand-navy/70">
          This is the complete contract the EFL parser can populate. Use it to compare different
          Fact Cards (Just Energy Free Nights, Reliant tiers, Rhythm/Gexa bill credits, etc.) and
          confirm we&apos;re capturing all the structures you care about.
        </p>
        <div className="grid gap-4 md:grid-cols-2 text-xs text-brand-navy/80">
          <div>
            <h3 className="mb-1 font-semibold text-brand-navy">PlanRules fields (EFL side)</h3>
            <ul className="space-y-1">
              <li>
                <span className="font-mono text-[11px]">planType</span> — flat / tou / free-nights /
                free-weekends / solar-buyback / other
              </li>
              <li>
                <span className="font-mono text-[11px]">defaultRateCentsPerKwh</span> — fallback
                energy charge when no TOU band applies
              </li>
              <li>
                <span className="font-mono text-[11px]">baseChargePerMonthCents</span> — REP base
                charge cents/month
              </li>
              <li>
                <span className="font-mono text-[11px]">rateType</span> — FIXED / VARIABLE /
                TIME_OF_USE (aligned with RateStructure)
              </li>
              <li>
                <span className="font-mono text-[11px]">variableIndexType</span> — ERCOT / FUEL /
                OTHER for indexed plans
              </li>
              <li>
                <span className="font-mono text-[11px]">currentBillEnergyRateCents</span> — current
                VARIABLE bill&apos;s rate when listed
              </li>
              <li className="mt-1 font-semibold text-brand-navy">timeOfUsePeriods[]</li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">label</span> — e.g. &quot;Free Nights&quot;,
                &quot;On-Peak&quot;
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">startHour / endHour</span> — 0–23, supports
                cross‑midnight windows
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">daysOfWeek</span> — 0–6 (Sun–Sat)
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">months</span> — optional 1–12 list for
                seasonal windows
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">rateCentsPerKwh</span> — band‑specific
                import rate, or null when isFree
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">isFree</span> — true for free nights /
                weekends
              </li>
              <li className="mt-1 font-semibold text-brand-navy">usageTiers[]</li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">minKwh / maxKwh</span> — kWh tier bounds
                (e.g., 0–1000, &gt;1000)
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">rateCentsPerKwh</span> — tier energy charge
              </li>
              <li className="mt-1 font-semibold text-brand-navy">solarBuyback</li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">hasBuyback</span>,{" "}
                <span className="font-mono text-[11px]">creditCentsPerKwh</span>,{" "}
                <span className="font-mono text-[11px]">matchesImportRate</span>,{" "}
                <span className="font-mono text-[11px]">maxMonthlyExportKwh</span>,{" "}
                <span className="font-mono text-[11px]">notes</span>
              </li>
              <li className="mt-1 font-semibold text-brand-navy">billCredits[]</li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">label</span> — usage vs behavioral credit
                description
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">creditDollars</span> — dollar credit amount
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">thresholdKwh</span> — kWh trigger for usage
                credits (Rhythm, Gexa, etc.)
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">monthsOfYear</span> — seasonal credit
                windows when present
              </li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">type</span> — USAGE_THRESHOLD / BEHAVIOR /
                OTHER
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-brand-navy">RateStructure fields (engine side)</h3>
            <ul className="space-y-1">
              <li>
                <span className="font-mono text-[11px]">type</span> — FIXED / VARIABLE / TIME_OF_USE
              </li>
              <li>
                <span className="font-mono text-[11px]">baseMonthlyFeeCents</span> — carried through
                from EFL
              </li>
              <li className="mt-1 font-semibold text-brand-navy">FIXED</li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">energyRateCents</span> — single blended
                energy rate
              </li>
              <li className="mt-1 font-semibold text-brand-navy">VARIABLE</li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">currentBillEnergyRateCents</span>,{" "}
                <span className="font-mono text-[11px]">indexType</span>,{" "}
                <span className="font-mono text-[11px]">variableNotes</span>
              </li>
              <li className="mt-1 font-semibold text-brand-navy">TIME_OF_USE tiers[]</li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">label</span>,{" "}
                <span className="font-mono text-[11px]">priceCents</span>,{" "}
                <span className="font-mono text-[11px]">startTime</span>,{" "}
                <span className="font-mono text-[11px]">endTime</span>,{" "}
                <span className="font-mono text-[11px]">daysOfWeek</span>,{" "}
                <span className="font-mono text-[11px]">monthsOfYear</span>
              </li>
              <li className="mt-1 font-semibold text-brand-navy">billCredits.rules[]</li>
              <li className="ml-3">
                <span className="font-mono text-[11px]">label</span>,{" "}
                <span className="font-mono text-[11px]">creditAmountCents</span>,{" "}
                <span className="font-mono text-[11px]">minUsageKWh</span>,{" "}
                <span className="font-mono text-[11px]">maxUsageKWh</span>,{" "}
                <span className="font-mono text-[11px]">monthsOfYear</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <section className="space-y-6 rounded-lg border border-brand-blue/20 bg-brand-white p-6 shadow-lg">
          <header className="space-y-1">
            <h2 className="text-xl font-semibold text-brand-navy">Deterministic Extract</h2>
            <p className="text-sm text-brand-navy/70">
              Copy the metadata below into the database when creating a new rate card. The prompt
              should be fed to the AI extraction layer to produce the authoritative{" "}
              <code className="rounded bg-brand-navy/5 px-1 py-0.5">PlanRules</code>.
            </p>
          </header>

          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-brand-navy/70">
                PDF SHA-256
              </dt>
              <dd className="mt-1 break-all rounded-md bg-brand-blue/5 px-2 py-1 text-sm text-brand-navy">
                {result.eflPdfSha256}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-brand-navy/70">
                REP PUCT Certificate
              </dt>
              <dd className="mt-1 rounded-md bg-brand-blue/5 px-2 py-1 text-sm text-brand-navy">
                {result.repPuctCertificate ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-brand-navy/70">
                EFL Version Code (Ver. #)
              </dt>
              <dd className="mt-1 rounded-md bg-brand-blue/5 px-2 py-1 text-sm text-brand-navy">
                {result.eflVersionCode ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-brand-navy/70">
                Warnings
              </dt>
              <dd className="mt-1 rounded-md bg-brand-blue/5 px-2 py-1 text-sm text-brand-navy">
                {result.warnings.length > 0
                  ? result.warnings.join("; ")
                  : "None"}
              </dd>
            </div>
          </dl>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-brand-navy">PlanRules Prompt</h3>
              <button
                type="button"
                onClick={() => handleCopy(result.prompt, "PlanRules prompt")}
                className="text-xs font-medium text-brand-blue hover:text-brand-navy transition"
              >
                Copy Prompt
              </button>
            </div>
            <textarea
              readOnly
              value={result.prompt}
              rows={12}
              className="w-full rounded-md border border-brand-blue/30 bg-brand-blue/5 p-3 text-xs text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
            />
          </section>

          {/* Parsed Plan snapshot (PlanRules + RateStructure) */}
          <section className="space-y-3 rounded-md border border-brand-blue/20 bg-brand-blue/5 p-4">
            <header className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-brand-navy">
                  Parsed Plan Snapshot (AI EFL Parser)
                </h3>
                <p className="text-xs text-brand-navy/70">
                  These fields show how the EFL parser would populate the shared{" "}
                  <span className="font-mono text-[11px]">PlanRules</span> and{" "}
                  <span className="font-mono text-[11px]">RateStructure</span> contracts used by the
                  database endpoints.
                </p>
              </div>
              {typeof result.parseConfidence === "number" ? (
                <div className="text-right text-xs text-brand-navy/70">
                  <div>
                    <span className="font-semibold text-brand-navy">Confidence:</span>{" "}
                    {(result.parseConfidence * 100).toFixed(0)}%
                  </div>
                  {result.validation ? (
                    <div>
                      <span className="font-semibold text-brand-navy">Requires manual review:</span>{" "}
                      {result.validation.requiresManualReview ? "Yes" : "No"}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </header>

            {!result.planRules && !result.rateStructure ? (
              <p className="text-xs text-brand-navy/70">
                The AI EFL parser did not return a{" "}
                <span className="font-mono text-[11px]">PlanRules</span> object. Check warnings above
                (for example, missing{" "}
                <span className="font-mono text-[11px]">
                  OPENAI_IntelliWatt_Fact_Card_Parser
                </span>
                ) or try again later.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 text-xs text-brand-navy/80">
                {/* PlanRules field values */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-brand-navy">PlanRules (EFL side)</h4>
                  <dl className="grid grid-cols-[minmax(0,170px),minmax(0,1fr)] gap-x-3 gap-y-1">
                    <dt className="font-mono text-[11px] text-brand-navy/80">planType</dt>
                    <dd className="truncate">
                      {(result.planRules as any)?.planType ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">rateType</dt>
                    <dd className="truncate">
                      {(result.planRules as any)?.rateType ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">variableIndexType</dt>
                    <dd className="truncate">
                      {(result.planRules as any)?.variableIndexType ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      defaultRateCentsPerKwh
                    </dt>
                    <dd className="truncate">
                      {(result.planRules as any)?.defaultRateCentsPerKwh ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      baseChargePerMonthCents
                    </dt>
                    <dd className="truncate">
                      {(result.planRules as any)?.baseChargePerMonthCents ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      currentBillEnergyRateCents
                    </dt>
                    <dd className="truncate">
                      {(result.planRules as any)?.currentBillEnergyRateCents ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      timeOfUsePeriods count
                    </dt>
                    <dd className="truncate">
                      {Array.isArray((result.planRules as any)?.timeOfUsePeriods)
                        ? (result.planRules as any).timeOfUsePeriods.length
                        : 0}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      usageTiers count
                    </dt>
                    <dd className="truncate">
                      {Array.isArray((result.planRules as any)?.usageTiers)
                        ? (result.planRules as any).usageTiers.length
                        : 0}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      billCredits count
                    </dt>
                    <dd className="truncate">
                      {Array.isArray((result.planRules as any)?.billCredits)
                        ? (result.planRules as any).billCredits.length
                        : 0}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      solarBuyback.hasBuyback
                    </dt>
                    <dd className="truncate">
                      {(result.planRules as any)?.solarBuyback?.hasBuyback ?? "—"}
                    </dd>
                  </dl>
                </div>

                {/* RateStructure field values */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-brand-navy">RateStructure (engine side)</h4>
                  <dl className="grid grid-cols-[minmax(0,170px),minmax(0,1fr)] gap-x-3 gap-y-1">
                    <dt className="font-mono text-[11px] text-brand-navy/80">type</dt>
                    <dd className="truncate">
                      {(result.rateStructure as any)?.type ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      baseMonthlyFeeCents
                    </dt>
                    <dd className="truncate">
                      {(result.rateStructure as any)?.baseMonthlyFeeCents ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      billCredits.hasBillCredit
                    </dt>
                    <dd className="truncate">
                      {(result.rateStructure as any)?.billCredits?.hasBillCredit ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      billCredits.rules count
                    </dt>
                    <dd className="truncate">
                      {Array.isArray((result.rateStructure as any)?.billCredits?.rules)
                        ? (result.rateStructure as any).billCredits.rules.length
                        : 0}
                    </dd>

                    {/* FIXED-specific */}
                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      energyRateCents (FIXED)
                    </dt>
                    <dd className="truncate">
                      {(result.rateStructure as any)?.energyRateCents ?? "—"}
                    </dd>

                    {/* VARIABLE-specific */}
                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      currentBillEnergyRateCents (VARIABLE)
                    </dt>
                    <dd className="truncate">
                      {(result.rateStructure as any)?.currentBillEnergyRateCents ?? "—"}
                    </dd>

                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      indexType (VARIABLE)
                    </dt>
                    <dd className="truncate">
                      {(result.rateStructure as any)?.indexType ?? "—"}
                    </dd>

                    {/* TIME_OF_USE-specific */}
                    <dt className="font-mono text-[11px] text-brand-navy/80">
                      TIME_OF_USE tiers count
                    </dt>
                    <dd className="truncate">
                      {Array.isArray((result.rateStructure as any)?.tiers)
                        ? (result.rateStructure as any).tiers.length
                        : 0}
                    </dd>
                  </dl>
                </div>
              </div>
            )}

            {/* Validation issues, if any */}
            {result.validation && result.validation.issues.length > 0 ? (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <div className="mb-1 font-semibold">Validation issues</div>
                <ul className="space-y-0.5">
                  {result.validation.issues.map((issue, idx) => (
                    <li key={`${issue.code}-${idx}`}>
                      <span className="font-mono text-[11px]">{issue.severity}</span>{" "}
                      <span className="font-mono text-[11px]">{issue.code}</span> —{" "}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Full PlanRules + RateStructure endpoint fields (arrays and nested objects) */}
            <section className="mt-4 space-y-4 text-xs text-brand-navy/80">
              {/* PlanRules.timeOfUsePeriods[] */}
              <div className="space-y-1">
                <h4 className="font-semibold text-brand-navy">
                  PlanRules.timeOfUsePeriods[] (label, hours, days, months, rate, isFree)
                </h4>
                <div className="overflow-auto rounded-md border border-brand-blue/20 bg-brand-blue/5">
                  <table className="min-w-full border-separate border-spacing-x-0 border-spacing-y-0.5 text-[11px]">
                    <thead className="bg-brand-blue/10 text-brand-navy/80">
                      <tr>
                        <th className="px-2 py-1 text-left font-mono font-normal">#</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">label</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">startHour</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">endHour</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">daysOfWeek</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">months</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">rateCentsPerKwh</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">isFree</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray((result.planRules as any)?.timeOfUsePeriods) &&
                      (result.planRules as any).timeOfUsePeriods.length > 0 ? (
                        (result.planRules as any).timeOfUsePeriods.map(
                          (p: any, idx: number) => (
                            <tr key={`tou-${idx}`} className="odd:bg-brand-blue/0 even:bg-brand-blue/5">
                              <td className="px-2 py-1 align-top">{idx + 1}</td>
                              <td className="px-2 py-1 align-top break-words">{p?.label ?? "—"}</td>
                              <td className="px-2 py-1 align-top">{p?.startHour ?? "—"}</td>
                              <td className="px-2 py-1 align-top">{p?.endHour ?? "—"}</td>
                              <td className="px-2 py-1 align-top">
                                {Array.isArray(p?.daysOfWeek) && p.daysOfWeek.length > 0
                                  ? p.daysOfWeek.join(",")
                                  : "—"}
                              </td>
                              <td className="px-2 py-1 align-top">
                                {Array.isArray(p?.months) && p.months.length > 0
                                  ? p.months.join(",")
                                  : "—"}
                              </td>
                              <td className="px-2 py-1 align-top">
                                {p?.rateCentsPerKwh ?? "—"}
                              </td>
                              <td className="px-2 py-1 align-top">
                                {typeof p?.isFree === "boolean" ? String(p.isFree) : "—"}
                              </td>
                            </tr>
                          ),
                        )
                      ) : (
                        <tr>
                          <td
                            className="px-2 py-2 text-center text-brand-navy/50"
                            colSpan={8}
                          >
                            No time-of-use periods on this EFL.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* PlanRules.usageTiers[] */}
              <div className="space-y-1">
                <h4 className="font-semibold text-brand-navy">
                  PlanRules.usageTiers[] (minKwh, maxKwh, rateCentsPerKwh)
                </h4>
                <div className="overflow-auto rounded-md border border-brand-blue/20 bg-brand-blue/5">
                  <table className="min-w-full border-separate border-spacing-x-0 border-spacing-y-0.5 text-[11px]">
                    <thead className="bg-brand-blue/10 text-brand-navy/80">
                      <tr>
                        <th className="px-2 py-1 text-left font-mono font-normal">#</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">minKwh</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">maxKwh</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">rateCentsPerKwh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray((result.planRules as any)?.usageTiers) &&
                      (result.planRules as any).usageTiers.length > 0 ? (
                        (result.planRules as any).usageTiers.map((t: any, idx: number) => (
                          <tr key={`tier-${idx}`} className="odd:bg-brand-blue/0 even:bg-brand-blue/5">
                            <td className="px-2 py-1 align-top">{idx + 1}</td>
                            <td className="px-2 py-1 align-top">{t?.minKwh ?? "—"}</td>
                            <td className="px-2 py-1 align-top">
                              {t?.maxKwh === null || typeof t?.maxKwh === "undefined"
                                ? "—"
                                : t.maxKwh}
                            </td>
                            <td className="px-2 py-1 align-top">
                              {t?.rateCentsPerKwh ?? "—"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            className="px-2 py-2 text-center text-brand-navy/50"
                            colSpan={4}
                          >
                            No kWh usage tiers on this EFL.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* PlanRules.billCredits[] */}
              <div className="space-y-1">
                <h4 className="font-semibold text-brand-navy">
                  PlanRules.billCredits[] (label, creditDollars, thresholdKwh, monthsOfYear, type)
                </h4>
                <div className="overflow-auto rounded-md border border-brand-blue/20 bg-brand-blue/5">
                  <table className="min-w-full border-separate border-spacing-x-0 border-spacing-y-0.5 text-[11px]">
                    <thead className="bg-brand-blue/10 text-brand-navy/80">
                      <tr>
                        <th className="px-2 py-1 text-left font-mono font-normal">#</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">label</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">creditDollars</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">thresholdKwh</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">monthsOfYear</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray((result.planRules as any)?.billCredits) &&
                      (result.planRules as any).billCredits.length > 0 ? (
                        (result.planRules as any).billCredits.map((c: any, idx: number) => (
                          <tr key={`credit-${idx}`} className="odd:bg-brand-blue/0 even:bg-brand-blue/5">
                            <td className="px-2 py-1 align-top">{idx + 1}</td>
                            <td className="px-2 py-1 align-top break-words">{c?.label ?? "—"}</td>
                            <td className="px-2 py-1 align-top">{c?.creditDollars ?? "—"}</td>
                            <td className="px-2 py-1 align-top">
                              {c?.thresholdKwh === null || typeof c?.thresholdKwh === "undefined"
                                ? "—"
                                : c.thresholdKwh}
                            </td>
                            <td className="px-2 py-1 align-top">
                              {Array.isArray(c?.monthsOfYear) && c.monthsOfYear.length > 0
                                ? c.monthsOfYear.join(",")
                                : "—"}
                            </td>
                            <td className="px-2 py-1 align-top">{c?.type ?? "—"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            className="px-2 py-2 text-center text-brand-navy/50"
                            colSpan={6}
                          >
                            No bill credit rules on this EFL.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* PlanRules.solarBuyback */}
              <div className="space-y-1">
                <h4 className="font-semibold text-brand-navy">PlanRules.solarBuyback</h4>
                <dl className="grid grid-cols-[minmax(0,170px),minmax(0,1fr)] gap-x-3 gap-y-1">
                  <dt className="font-mono text-[11px] text-brand-navy/80">hasBuyback</dt>
                  <dd className="truncate">
                    {(result.planRules as any)?.solarBuyback?.hasBuyback ?? "—"}
                  </dd>

                  <dt className="font-mono text-[11px] text-brand-navy/80">
                    creditCentsPerKwh
                  </dt>
                  <dd className="truncate">
                    {(result.planRules as any)?.solarBuyback?.creditCentsPerKwh ?? "—"}
                  </dd>

                  <dt className="font-mono text-[11px] text-brand-navy/80">matchesImportRate</dt>
                  <dd className="truncate">
                    {(result.planRules as any)?.solarBuyback?.matchesImportRate ?? "—"}
                  </dd>

                  <dt className="font-mono text-[11px] text-brand-navy/80">
                    maxMonthlyExportKwh
                  </dt>
                  <dd className="truncate">
                    {(result.planRules as any)?.solarBuyback?.maxMonthlyExportKwh ?? "—"}
                  </dd>

                  <dt className="font-mono text-[11px] text-brand-navy/80">notes</dt>
                  <dd className="truncate">
                    {(result.planRules as any)?.solarBuyback?.notes ?? "—"}
                  </dd>
                </dl>
              </div>

              {/* RateStructure.TIME_OF_USE tiers[] */}
              <div className="space-y-1">
                <h4 className="font-semibold text-brand-navy">
                  RateStructure.tiers[] (TIME_OF_USE tiers: label, priceCents, startTime, endTime,
                  daysOfWeek, monthsOfYear)
                </h4>
                <div className="overflow-auto rounded-md border border-brand-blue/20 bg-brand-blue/5">
                  <table className="min-w-full border-separate border-spacing-x-0 border-spacing-y-0.5 text-[11px]">
                    <thead className="bg-brand-blue/10 text-brand-navy/80">
                      <tr>
                        <th className="px-2 py-1 text-left font-mono font-normal">#</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">label</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">priceCents</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">startTime</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">endTime</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">daysOfWeek</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">monthsOfYear</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray((result.rateStructure as any)?.tiers) &&
                      (result.rateStructure as any).tiers.length > 0 ? (
                        (result.rateStructure as any).tiers.map((t: any, idx: number) => (
                          <tr key={`rs-tier-${idx}`} className="odd:bg-brand-blue/0 even:bg-brand-blue/5">
                            <td className="px-2 py-1 align-top">{idx + 1}</td>
                            <td className="px-2 py-1 align-top break-words">{t?.label ?? "—"}</td>
                            <td className="px-2 py-1 align-top">{t?.priceCents ?? "—"}</td>
                            <td className="px-2 py-1 align-top">{t?.startTime ?? "—"}</td>
                            <td className="px-2 py-1 align-top">{t?.endTime ?? "—"}</td>
                            <td className="px-2 py-1 align-top">
                              {Array.isArray(t?.daysOfWeek) && t.daysOfWeek.length > 0
                                ? t.daysOfWeek.join(",")
                                : "—"}
                            </td>
                            <td className="px-2 py-1 align-top">
                              {Array.isArray(t?.monthsOfYear) && t.monthsOfYear.length > 0
                                ? t.monthsOfYear.join(",")
                                : "—"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            className="px-2 py-2 text-center text-brand-navy/50"
                            colSpan={7}
                          >
                            No TIME_OF_USE tiers on this RateStructure.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* RateStructure.billCredits.rules[] */}
              <div className="space-y-1">
                <h4 className="font-semibold text-brand-navy">
                  RateStructure.billCredits.rules[] (label, creditAmountCents, minUsageKWh,
                  maxUsageKWh, monthsOfYear)
                </h4>
                <div className="overflow-auto rounded-md border border-brand-blue/20 bg-brand-blue/5">
                  <table className="min-w-full border-separate border-spacing-x-0 border-spacing-y-0.5 text-[11px]">
                    <thead className="bg-brand-blue/10 text-brand-navy/80">
                      <tr>
                        <th className="px-2 py-1 text-left font-mono font-normal">#</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">label</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">
                          creditAmountCents
                        </th>
                        <th className="px-2 py-1 text-left font-mono font-normal">minUsageKWh</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">maxUsageKWh</th>
                        <th className="px-2 py-1 text-left font-mono font-normal">monthsOfYear</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray((result.rateStructure as any)?.billCredits?.rules) &&
                      (result.rateStructure as any).billCredits.rules.length > 0 ? (
                        (result.rateStructure as any).billCredits.rules.map(
                          (r: any, idx: number) => (
                            <tr
                              key={`rs-credit-${idx}`}
                              className="odd:bg-brand-blue/0 even:bg-brand-blue/5"
                            >
                              <td className="px-2 py-1 align-top">{idx + 1}</td>
                              <td className="px-2 py-1 align-top break-words">
                                {r?.label ?? "—"}
                              </td>
                              <td className="px-2 py-1 align-top">
                                {r?.creditAmountCents ?? "—"}
                              </td>
                              <td className="px-2 py-1 align-top">{r?.minUsageKWh ?? "—"}</td>
                              <td className="px-2 py-1 align-top">
                                {r?.maxUsageKWh === null ||
                                typeof r?.maxUsageKWh === "undefined"
                                  ? "—"
                                  : r.maxUsageKWh}
                              </td>
                              <td className="px-2 py-1 align-top">
                                {Array.isArray(r?.monthsOfYear) && r.monthsOfYear.length > 0
                                  ? r.monthsOfYear.join(",")
                                  : "—"}
                              </td>
                            </tr>
                          ),
                        )
                      ) : (
                        <tr>
                          <td
                            className="px-2 py-2 text-center text-brand-navy/50"
                            colSpan={6}
                          >
                            No RateStructure bill credit rules.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-brand-navy">
                Raw Text Preview ({result.rawTextLength.toLocaleString()} characters
                {result.rawTextTruncated ? ", truncated" : ""})
              </h3>
              <button
                type="button"
                onClick={() => handleCopy(result.rawTextPreview, "Raw text preview")}
                className="text-xs font-medium text-brand-blue hover:text-brand-navy transition"
              >
                Copy Preview
              </button>
            </div>
            <details className="rounded-md border border-brand-blue/20 bg-brand-blue/5">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-brand-blue hover:text-brand-navy">
                Toggle raw text preview
              </summary>
              <pre className="max-h-[420px] overflow-auto px-3 py-2 text-xs leading-relaxed text-brand-navy">
                {result.rawTextPreview}
                {result.rawTextTruncated ? "\n\n[…truncated…]" : ""}
              </pre>
            </details>
          </section>
        </section>
      ) : null}
    </div>
  );
}

