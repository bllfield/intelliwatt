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

