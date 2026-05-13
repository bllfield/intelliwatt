"use client";

import { FormEvent, useMemo, useState } from "react";

type UploadTicketResponse = {
  ok?: boolean;
  error?: string;
  uploadUrl?: string;
  payload?: string;
  signature?: string;
  houseId?: string;
  utilityName?: string | null;
  maxBytes?: number;
  expiresAt?: string;
};

type DropletUploadResponse = {
  ok?: boolean;
  error?: string;
  rawId?: string;
  uploadId?: string;
  intervalsCreated?: number;
  totalKwh?: number;
  warnings?: string[];
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
};

type PipelineRunResult = {
  ok: boolean;
  ticket: UploadTicketResponse;
  upload: DropletUploadResponse;
  file: {
    name: string;
    sizeBytes: number;
    type: string | null;
  };
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
  const [result, setResult] = useState<PipelineRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = useMemo(() => {
    if (loading) return "Uploading to Droplet...";
    if (result?.ok) return "Droplet ingest passed";
    if (result && !result.ok) return "Droplet ingest failed";
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

    setLoading(true);
    try {
      const ticketResponse = await fetch("/api/admin/tools/one-path-sim/green-button/upload-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const ticket = (await ticketResponse.json().catch(() => null)) as UploadTicketResponse | null;
      if (!ticketResponse.ok || !ticket?.ok || !ticket.uploadUrl || !ticket.payload || !ticket.signature) {
        throw new Error(ticket?.error || `Unable to obtain Droplet upload ticket (${ticketResponse.status}).`);
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("payload", ticket.payload);
      formData.append("signature", ticket.signature);

      const uploadResponse = await fetch(ticket.uploadUrl, {
        method: "POST",
        body: formData,
        credentials: "omit",
      });
      const upload = (await uploadResponse.json().catch(() => null)) as DropletUploadResponse | null;
      const nextResult = {
        ok: Boolean(uploadResponse.ok && upload?.ok),
        ticket,
        upload: upload ?? { ok: false, error: `Droplet returned non-JSON response (${uploadResponse.status}).` },
        file: {
          name: file.name,
          sizeBytes: file.size,
          type: file.type || null,
        },
      };
      setResult(nextResult);

      if (!nextResult.ok) {
        throw new Error(nextResult.upload.error || `Droplet upload failed (${uploadResponse.status}).`);
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
          Upload a Green Button file directly to the Droplet ingest service using the same signed-ticket path as the
          customer and One Path admin flows. Vercel only mints the ticket; the file payload does not go through Vercel.
        </p>
      </div>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        This check writes only to the isolated One Path admin test home so the real Droplet ingest can run end to end.
        It does not use or overwrite the selected customer home.
      </section>

      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
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
              No email is required. The tool uses the admin test home ticket so the Droplet has a valid home target
              without touching a real user's home.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Uploading..." : "Run Droplet Ingest Check"}
            </button>
            <span className="text-sm font-medium text-slate-700">{statusLabel}</span>
          </div>
        </form>
      </section>

      {error ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      {result?.ok ? (
        <section className="mt-6 space-y-5">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-semibold text-emerald-800">Droplet ingest success</div>
            <div className="mt-1 text-sm text-emerald-700">
              Upload URL: <code>{result.ticket.uploadUrl}</code>. Test home: <code>{result.ticket.houseId}</code>.
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Metric label="File size" value={`${formatNumber(result.file.sizeBytes)} bytes`} />
            <Metric label="Intervals created" value={formatNumber(result.upload.intervalsCreated)} />
            <Metric label="Total kWh" value={formatKwh(result.upload.totalKwh)} />
            <Metric label="Warnings" value={formatNumber(result.upload.warnings?.length ?? 0)} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-brand-navy">Droplet Result</h2>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <span className="font-medium text-slate-700">Raw ID:</span> {result.upload.rawId ?? "-"}
              </div>
              <div>
                <span className="font-medium text-slate-700">Upload ID:</span> {result.upload.uploadId ?? "-"}
              </div>
              <div>
                <span className="font-medium text-slate-700">UTC range:</span>{" "}
                {result.upload.dateRangeStart ?? "-"} to {result.upload.dateRangeEnd ?? "-"}
              </div>
              <div>
                <span className="font-medium text-slate-700">Ticket expires:</span> {result.ticket.expiresAt ?? "-"}
              </div>
            </div>
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
