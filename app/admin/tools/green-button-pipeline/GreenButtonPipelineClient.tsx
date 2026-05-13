"use client";

import { FormEvent, useMemo, useState } from "react";

type PipelineResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  writeMode?: string;
  pipelineEntryPoint?: string;
  file?: {
    name: string;
    type?: string | null;
    sizeBytes: number;
    sha256: string;
  };
  parseSummary?: {
    format: string;
    totalRawReadings: number;
    normalizedIntervals: number;
    totalKwh: number;
    appliedWindowDays: number;
    coverageStartDateKey: string;
    coverageEndDateKey: string;
    warnings: string[];
  };
  diagnostics?: {
    rawReadings: number;
    normalizedIntervalsBeforeTrim: number;
    trimmedIntervals: number;
    intervalsDroppedByWindow: number;
    coverageStart: string;
    coverageEnd: string;
    coverageStartDateKey: string;
    coverageEndDateKey: string;
    warnings: string[];
    sampleIntervals: Array<{ timestamp: string; consumptionKwh: number; intervalMinutes: number }>;
    finalIntervals: Array<{ timestamp: string; consumptionKwh: number; intervalMinutes: number }>;
    sourceTitle?: string | null;
    meterSerialNumber?: string | null;
    timezoneOffsetSeconds?: number | null;
  };
  parsed?: {
    format: string;
    totalRawReadings: number;
    warnings: string[];
    errors: string[];
  } | null;
  normalizedIntervalsBeforeTrim?: number | null;
};

function formatNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatKwh(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)} kWh`;
}

export function GreenButtonPipelineClient() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = useMemo(() => {
    if (loading) return "Running pipeline...";
    if (result?.ok) return "Pipeline passed";
    if (result && !result.ok) return "Pipeline failed";
    return "Ready";
  }, [loading, result]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Choose a Green Button XML, CSV, or JSON file first.");
      return;
    }

    const formData = new FormData();
    formData.set("file", file);

    setLoading(true);
    try {
      const response = await fetch("/api/admin/tools/green-button-pipeline", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as PipelineResponse;
      setResult(payload);
      if (!response.ok || !payload.ok) {
        setError(payload.message || payload.error || "Pipeline check failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <a className="text-sm text-brand-blue underline" href="/admin">
          Back to admin
        </a>
        <h1 className="mt-3 text-3xl font-bold text-brand-navy">Green Button Pipeline Check</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Upload a Green Button file and run it through the shared parse, normalize, and Chicago-local coverage
          pipeline. This is a dry run: it does not create raw records, intervals, manual usage uploads, entries,
          buckets, or plan jobs.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-2 block text-sm font-semibold text-brand-navy" htmlFor="greenButtonFile">
              Green Button file
            </label>
            <input
              id="greenButtonFile"
              type="file"
              accept=".xml,.csv,.json,text/xml,application/xml,text/csv,application/json"
              className="block w-full rounded-md border border-slate-300 p-2 text-sm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="mt-2 text-xs text-slate-500">
              No home email is required because this stage validates the file-processing path before any home-scoped
              database writes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Running..." : "Run Pipeline Check"}
            </button>
            <span className="text-sm font-medium text-slate-700">{statusLabel}</span>
          </div>
        </form>
      </section>

      {error ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      {result?.ok && result.parseSummary && result.diagnostics ? (
        <section className="mt-6 space-y-5">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-semibold text-emerald-800">Dry-run success</div>
            <div className="mt-1 text-sm text-emerald-700">
              Entry point: <code>{result.pipelineEntryPoint}</code>. Write mode: <code>{result.writeMode}</code>.
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Metric label="Raw readings" value={formatNumber(result.diagnostics.rawReadings)} />
            <Metric label="Normalized before trim" value={formatNumber(result.diagnostics.normalizedIntervalsBeforeTrim)} />
            <Metric label="Persistable intervals" value={formatNumber(result.diagnostics.trimmedIntervals)} />
            <Metric label="Total kWh" value={formatKwh(result.parseSummary.totalKwh)} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-brand-navy">Coverage Window</h2>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <span className="font-medium text-slate-700">Date keys:</span>{" "}
                {result.diagnostics.coverageStartDateKey} to {result.diagnostics.coverageEndDateKey}
              </div>
              <div>
                <span className="font-medium text-slate-700">UTC range:</span>{" "}
                {result.diagnostics.coverageStart} to {result.diagnostics.coverageEnd}
              </div>
              <div>
                <span className="font-medium text-slate-700">Intervals dropped by window:</span>{" "}
                {formatNumber(result.diagnostics.intervalsDroppedByWindow)}
              </div>
              <div>
                <span className="font-medium text-slate-700">Format:</span> {result.parseSummary.format}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <IntervalTable title="First persisted intervals" rows={result.diagnostics.sampleIntervals} />
            <IntervalTable title="Final persisted intervals" rows={result.diagnostics.finalIntervals} />
          </div>

          <pre className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100">
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      ) : null}

      {result && !result.ok ? (
        <pre className="mt-6 max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-brand-navy">{value}</div>
    </div>
  );
}

function IntervalTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ timestamp: string; consumptionKwh: number; intervalMinutes: number }>;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-brand-navy">{title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2 pr-3">Timestamp</th>
              <th className="py-2 pr-3">kWh</th>
              <th className="py-2 pr-3">Minutes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.timestamp}-${row.consumptionKwh}`} className="border-t border-slate-100">
                <td className="py-2 pr-3 font-mono text-xs">{row.timestamp}</td>
                <td className="py-2 pr-3">{row.consumptionKwh}</td>
                <td className="py-2 pr-3">{row.intervalMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
