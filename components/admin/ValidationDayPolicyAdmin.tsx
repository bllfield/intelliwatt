"use client";

import { useCallback, useEffect, useState } from "react";

type PolicySnapshot = {
  policyRevision: string;
  policyLayer: string;
  policyHash: string;
  defaults: {
    selectionMode: string;
    validationDayCount: number;
    surface: string;
  };
  activePolicy: {
    selectionMode: string;
    validationDayCount: number;
    overrideSource: string;
    envOverrideApplied: boolean;
  };
  envOverride: Record<string, unknown> | null;
};

type PreviewResult = {
  policyRevision: string;
  policyHash: string;
  selectionMode: string;
  validationDayCount: number;
  selectedValidationDateKeys: string[];
  diagnostics: {
    candidateDateKeyCount: number;
    excludedTravelDateKeyCount: number;
    localGapFillSelectorUsed: false;
    sharedPolicySelectorOwner: string;
  };
  warnings: string[];
};

export function ValidationDayPolicyAdmin() {
  const [snapshot, setSnapshot] = useState<PolicySnapshot | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [houseId, setHouseId] = useState("");
  const [userId, setUserId] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [validationDayCount, setValidationDayCount] = useState("");
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSnapshot = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/tools/validation-day-policy?surface=admin_lab", {
      method: "GET",
      credentials: "include",
    });
    const json = (await res.json().catch(() => ({}))) as PolicySnapshot & { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to load validation-day policy.");
      return;
    }
    setSnapshot(json);
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const runPreview = useCallback(async () => {
    if (!houseId.trim() || !userId.trim()) {
      setError("houseId and userId are required for preview.");
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const body: Record<string, unknown> = {
        houseId: houseId.trim(),
        userId: userId.trim(),
      };
      if (windowStart && windowEnd) body.window = { startDate: windowStart, endDate: windowEnd };
      if (mode.trim()) body.mode = mode.trim();
      if (validationDayCount.trim()) body.validationDayCount = Number(validationDayCount);
      const res = await fetch("/api/admin/tools/validation-day-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as PreviewResult & { error?: string; message?: string };
      if (!res.ok) {
        setError(json.message ?? json.error ?? "Preview failed.");
        setPreview(null);
        return;
      }
      setPreview(json);
      setStatus(`Preview selected ${json.selectedValidationDateKeys?.length ?? 0} validation days.`);
    } finally {
      setLoading(false);
    }
  }, [houseId, userId, windowStart, windowEnd, mode, validationDayCount]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Compare Day Policy</h1>
        <p className="mt-2 text-sm text-slate-600">
          Global owner for which calendar days are used when surfaces compare interval usage by day. Shared module:{" "}
          <code className="rounded bg-slate-100 px-1">lib/usage/validationDayPolicy.ts</code> →{" "}
          <code className="rounded bg-slate-100 px-1">selectValidationDayKeys</code>.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>
            <strong>Wired:</strong> Manual GapFill (MG-2+), One Path manual runs when they use global validation policy.
          </li>
          <li>
            <strong>Not wired:</strong> GapFill Lab local compare-day selectors (legacy; unchanged until retirement).
          </li>
          <li>
            <strong>Runtime changes today:</strong> code defaults in{" "}
            <code className="rounded bg-slate-100 px-1">pastValidationPolicy.ts</code>, or deploy env{" "}
            <code className="rounded bg-slate-100 px-1">VALIDATION_DAY_POLICY_OVERRIDE_JSON</code>. This page previews
            selection; it does not persist a new global policy to the database yet.
          </li>
        </ul>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {status ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{status}</div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-brand-navy">Active policy</h2>
        {snapshot ? (
          <dl className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
            <div>
              <dt className="font-semibold">Revision</dt>
              <dd>{snapshot.policyRevision}</dd>
            </div>
            <div>
              <dt className="font-semibold">Layer</dt>
              <dd>{snapshot.policyLayer}</dd>
            </div>
            <div>
              <dt className="font-semibold">Hash</dt>
              <dd className="break-all font-mono text-xs">{snapshot.policyHash}</dd>
            </div>
            <div>
              <dt className="font-semibold">Active mode / count</dt>
              <dd>
                {snapshot.activePolicy.selectionMode} · {snapshot.activePolicy.validationDayCount}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Override source</dt>
              <dd>{snapshot.activePolicy.overrideSource}</dd>
            </div>
            <div>
              <dt className="font-semibold">Env override</dt>
              <dd>{snapshot.activePolicy.envOverrideApplied ? "applied" : "none"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Loading policy snapshot…</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-brand-navy">Preview selected days</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">House ID</span>
            <input className="rounded border px-3 py-2" value={houseId} onChange={(e) => setHouseId(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">User ID</span>
            <input className="rounded border px-3 py-2" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Window start (optional)</span>
            <input className="rounded border px-3 py-2" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Window end (optional)</span>
            <input className="rounded border px-3 py-2" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Mode override (optional)</span>
            <input className="rounded border px-3 py-2" value={mode} onChange={(e) => setMode(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Day count override (optional)</span>
            <input
              className="rounded border px-3 py-2"
              value={validationDayCount}
              onChange={(e) => setValidationDayCount(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void runPreview()}
          className="mt-4 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Previewing…" : "Preview validation days"}
        </button>
        {preview ? (
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <div>
              Policy hash: <span className="font-mono text-xs">{preview.policyHash}</span>
            </div>
            <div>
              Selected ({preview.selectedValidationDateKeys.length}):{" "}
              <span className="font-mono text-xs">{preview.selectedValidationDateKeys.join(", ")}</span>
            </div>
            <div>
              Candidates: {preview.diagnostics.candidateDateKeyCount} · Travel excluded:{" "}
              {preview.diagnostics.excludedTravelDateKeyCount} · Selector:{" "}
              {preview.diagnostics.sharedPolicySelectorOwner}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
