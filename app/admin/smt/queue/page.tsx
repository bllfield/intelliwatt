"use client";

import React, { useEffect, useMemo, useState } from "react";

type QueueSummary = {
  ok: boolean;
  pending: number;
  active: number;
  averageSecondsPerFile: number;
  longestSecondsLastDay: number;
  longestSecondsLastWeek: number;
  activeJob: { id: string; filename: string; sizeBytes: number; startedAt?: number } | null;
  nextJob: { id: string; filename: string; sizeBytes: number; queuedAt?: number } | null;
  samplesRecorded: number;
};

function deriveSummaryUrl() {
  if (typeof window === "undefined") return null;
  const raw = process.env.NEXT_PUBLIC_SMT_UPLOAD_URL;
  if (!raw) return null;
  // Strip trailing /upload if present.
  const base = raw.replace(/\/?upload$/i, "").replace(/\/$/, "");
  return `${base}/queue/summary`;
}

export default function SmtQueuePage() {
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const summaryUrl = useMemo(() => deriveSummaryUrl(), []);

  useEffect(() => {
    if (!summaryUrl) {
      setError("NEXT_PUBLIC_SMT_UPLOAD_URL is not set; cannot load queue summary.");
      return undefined;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const resp = await fetch(summaryUrl, { cache: "no-store" });
        const json = await resp.json();
        if (!cancelled) {
          setSummary(json as QueueSummary);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(`Failed to load queue summary: ${err?.message || err}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = window.setInterval(load, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [summaryUrl]);

  return (
    <div className="p-6 space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">SMT Upload Queue</h1>
        <p className="text-sm text-gray-600">Live view of droplet queue load and processing times.</p>
      </div>

      {error ? (
        <div className="border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm rounded">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <InfoCard title="Pending" value={summary?.pending ?? "–"} loading={loading} />
        <InfoCard title="Active" value={summary?.active ?? "–"} loading={loading} />
        <InfoCard
          title="Avg sec/file"
          value={summary ? `${summary.averageSecondsPerFile}s` : "–"}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <InfoCard
          title="Longest (24h)"
          value={summary ? `${summary.longestSecondsLastDay || 0}s` : "–"}
          loading={loading}
        />
        <InfoCard
          title="Longest (7d)"
          value={summary ? `${summary.longestSecondsLastWeek || 0}s` : "–"}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DetailCard
          title="Active Job"
          loading={loading}
          body={
            summary?.activeJob ? (
              <div className="text-sm space-y-1">
                <div className="font-mono text-xs break-all">{summary.activeJob.filename}</div>
                <div className="text-gray-600 text-xs">ID: {summary.activeJob.id}</div>
                <div className="text-gray-600 text-xs">Size: {summary.activeJob.sizeBytes.toLocaleString()} bytes</div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">None</div>
            )
          }
        />
        <DetailCard
          title="Next In Line"
          loading={loading}
          body={
            summary?.nextJob ? (
              <div className="text-sm space-y-1">
                <div className="font-mono text-xs break-all">{summary.nextJob.filename}</div>
                <div className="text-gray-600 text-xs">ID: {summary.nextJob.id}</div>
                <div className="text-gray-600 text-xs">Size: {summary.nextJob.sizeBytes.toLocaleString()} bytes</div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">Queue empty</div>
            )
          }
        />
      </div>

      <div className="text-xs text-gray-500">
        Samples recorded: {summary?.samplesRecorded ?? 0}. Updates every 10 seconds.
      </div>
    </div>
  );
}

function InfoCard({
  title,
  value,
  loading,
}: {
  title: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <div className="border rounded p-3 bg-white shadow-sm">
      <div className="text-xs uppercase text-gray-500">{title}</div>
      <div className="text-xl font-semibold">{loading ? "…" : value}</div>
    </div>
  );
}

function DetailCard({
  title,
  loading,
  body,
}: {
  title: string;
  loading: boolean;
  body: React.ReactNode;
}) {
  return (
    <div className="border rounded p-3 bg-white shadow-sm">
      <div className="text-xs uppercase text-gray-500">{title}</div>
      <div className="mt-2">{loading ? <div className="text-sm text-gray-500">Loading…</div> : body}</div>
    </div>
  );
}
