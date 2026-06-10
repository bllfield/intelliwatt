"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAdminUserByEmail } from "@/lib/admin/manualGapfillClient";
import {
  fetchValidationDayPolicySnapshot,
  previewValidationDayPolicyForEmail,
  resetValidationDayPolicy,
  saveValidationDayPolicy,
} from "@/lib/admin/validationDayPolicyClient";

type PolicySnapshot = {
  policyRevision: string;
  policyLayer: string;
  policyHash: string;
  defaults: { selectionMode: string; validationDayCount: number; surface: string };
  activePolicy: {
    selectionMode: string;
    validationDayCount: number;
    overrideSource: string;
    envOverrideApplied: boolean;
    surface: string;
  };
  storedPolicy: {
    selectionMode: string;
    validationDayCount: number;
    surface: string;
    updatedAt: string;
    updatedBy: string | null;
  } | null;
  modeCatalog: Array<{
    mode: string;
    title: string;
    summary: string;
    howItSelects: string;
    bestFor: string;
  }>;
  guardrails: Array<{ id: string; title: string; detail: string }>;
  wiredSurfaces: string[];
  confirmationKeyword: string;
};

type PreviewResult = {
  policyHash: string;
  selectionMode: string;
  validationDayCount: number;
  selectedValidationDateKeys: string[];
  diagnostics: {
    windowStart: string;
    windowEnd: string;
    candidateDateKeyCount: number;
    excludedTravelDateKeyCount: number;
    selectionDiagnostics: Record<string, unknown>;
    sharedPolicySelectorOwner: string;
  };
  warnings: string[];
  previewContext?: { email: string | null; userId: string; houseId: string };
};

const AUTO_MODES = [
  "stratified_weather_balanced",
  "customer_style_seasonal_mix",
  "random_simple",
] as const;

export function ValidationDayPolicyAdmin() {
  const [snapshot, setSnapshot] = useState<PolicySnapshot | null>(null);
  const [draftMode, setDraftMode] = useState("stratified_weather_balanced");
  const [draftCount, setDraftCount] = useState("14");
  const [draftSurface, setDraftSurface] = useState<"admin_lab" | "user_site">("admin_lab");
  const [confirmation, setConfirmation] = useState("");
  const [previewEmail, setPreviewEmail] = useState("");
  const [previewHouseId, setPreviewHouseId] = useState("");
  const [previewHouses, setPreviewHouses] = useState<Array<{ id: string; label: string; esiid: string | null }>>(
    []
  );
  const [previewUseDraft, setPreviewUseDraft] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);

  const loadSnapshot = useCallback(async () => {
    setError(null);
    const result = await fetchValidationDayPolicySnapshot();
    if (!result.ok) {
      setError(result.message ?? result.error);
      return;
    }
    const json = result.data as PolicySnapshot;
    setSnapshot(json);
    setDraftMode(json.activePolicy.selectionMode);
    setDraftCount(String(json.activePolicy.validationDayCount));
    setDraftSurface(json.activePolicy.surface === "user_site" ? "user_site" : "admin_lab");
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const draftDirty = useMemo(() => {
    if (!snapshot) return false;
    return (
      draftMode !== snapshot.activePolicy.selectionMode ||
      String(snapshot.activePolicy.validationDayCount) !== draftCount ||
      draftSurface !== (snapshot.activePolicy.surface === "user_site" ? "user_site" : "admin_lab")
    );
  }, [snapshot, draftMode, draftCount, draftSurface]);

  const lookupPreviewHouses = useCallback(async () => {
    const email = previewEmail.trim();
    if (!email) {
      setError("Enter a user email to load houses for preview.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminUserByEmail(email);
      if (!result.ok) {
        setError(result.error ?? "User lookup failed.");
        setPreviewHouses([]);
        return;
      }
      if (!result.data?.ok) {
        const payload = result.data as { message?: string; error?: string } | undefined;
        setError(payload?.message ?? payload?.error ?? "User lookup failed.");
        setPreviewHouses([]);
        return;
      }
      const houses = Array.isArray(result.data.houses) ? result.data.houses : [];
      setPreviewHouses(
        houses.map((house) => ({
          id: String(house.id),
          label: String(house.label ?? house.id),
          esiid: house.esiid ? String(house.esiid) : null,
        }))
      );
      const primary = houses.find((house) => house.isPrimary) ?? houses[0];
      setPreviewHouseId(primary ? String(primary.id) : "");
      setStatus(`Loaded ${houses.length} house(s) for ${result.data.email}.`);
    } finally {
      setLoading(false);
    }
  }, [previewEmail]);

  const runPreview = useCallback(async () => {
    const email = previewEmail.trim();
    if (!email) {
      setError("User email is required. Admin tools resolve homes by email — not houseId or userId.");
      return;
    }
    if (!previewHouseId) {
      setError("Select a house after email lookup.");
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const result = await previewValidationDayPolicyForEmail({
        email,
        houseId: previewHouseId,
        useDraft: previewUseDraft,
        draftSelectionMode: draftMode,
        draftValidationDayCount: Number.isFinite(Number(draftCount)) ? Number(draftCount) : undefined,
      });
      if (!result.ok) {
        setError(result.message ?? result.error);
        setPreview(null);
        return;
      }
      setPreview(result.data as PreviewResult);
      const keys = (result.data as PreviewResult).selectedValidationDateKeys ?? [];
      setStatus(
        `Preview selected ${keys.length} compare day(s) using ${previewUseDraft ? "draft" : "active"} policy.`
      );
    } finally {
      setLoading(false);
    }
  }, [previewEmail, previewHouseId, previewUseDraft, draftMode, draftCount]);

  const savePolicy = useCallback(async () => {
    setPolicyBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await saveValidationDayPolicy({
        selectionMode: draftMode,
        validationDayCount: Number(draftCount) || 14,
        surface: draftSurface,
        confirmation,
      });
      if (!result.ok) {
        setError(result.message ?? result.error);
        return;
      }
      await loadSnapshot();
      setConfirmation("");
      setStatus("Global compare-day policy saved. All wired sim-vs-actual compare surfaces will use it.");
    } finally {
      setPolicyBusy(false);
    }
  }, [confirmation, draftCount, draftMode, draftSurface, loadSnapshot]);

  const resetPolicy = useCallback(async () => {
    setPolicyBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await resetValidationDayPolicy({ confirmation, surface: draftSurface });
      if (!result.ok) {
        setError(result.message ?? result.error);
        return;
      }
      await loadSnapshot();
      setConfirmation("");
      setStatus("Admin-saved policy cleared. Active policy reverts to code defaults unless env override is set.");
    } finally {
      setPolicyBusy(false);
    }
  }, [confirmation, draftSurface, loadSnapshot]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Compare Day Policy</h1>
        <p className="mt-2 text-sm text-slate-600">
          Global control plane for which calendar days are scored when simulated usage is compared against actual
          interval usage. Owner:{" "}
          <code className="rounded bg-slate-100 px-1">lib/usage/validationDayPolicy.ts</code> →{" "}
          <code className="rounded bg-slate-100 px-1">selectValidationDayKeys</code>.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          <strong>Home lookup rule:</strong> preview and admin tooling resolve houses by{" "}
          <strong>user email</strong> via <code className="rounded bg-slate-100 px-1">/api/admin/houses/by-email</code>.
          Do not ask operators to paste raw houseId or userId.
        </p>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {status ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{status}</div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-brand-navy">Current active policy</h2>
        {snapshot ? (
          <dl className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
            <div>
              <dt className="font-semibold">Mode / count</dt>
              <dd>
                {snapshot.activePolicy.selectionMode} · {snapshot.activePolicy.validationDayCount} days
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Surface</dt>
              <dd>{snapshot.activePolicy.surface}</dd>
            </div>
            <div>
              <dt className="font-semibold">Override source</dt>
              <dd>{snapshot.activePolicy.overrideSource}</dd>
            </div>
            <div>
              <dt className="font-semibold">Policy hash</dt>
              <dd className="break-all font-mono text-xs">{snapshot.policyHash}</dd>
            </div>
            <div>
              <dt className="font-semibold">Code defaults</dt>
              <dd>
                {snapshot.defaults.selectionMode} · {snapshot.defaults.validationDayCount}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Admin saved</dt>
              <dd>
                {snapshot.storedPolicy
                  ? `${snapshot.storedPolicy.selectionMode} · ${snapshot.storedPolicy.validationDayCount} (${snapshot.storedPolicy.updatedAt})`
                  : "none"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Loading policy snapshot…</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-brand-navy">Wired surfaces</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {(snapshot?.wiredSurfaces ?? []).map((surface) => (
            <li key={surface}>{surface}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-brand-navy">Selection modes</h2>
        <div className="mt-4 space-y-4">
          {(snapshot?.modeCatalog ?? []).map((entry) => (
            <div key={entry.mode} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-brand-navy">
                {entry.title}{" "}
                <span className="font-mono text-xs font-normal text-slate-500">({entry.mode})</span>
              </div>
              <p className="mt-1 text-sm text-slate-700">{entry.summary}</p>
              <p className="mt-2 text-xs text-slate-600">
                <span className="font-semibold">How it selects:</span> {entry.howItSelects}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                <span className="font-semibold">Best for:</span> {entry.bestFor}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-brand-navy">Guardrails</h2>
        <div className="mt-4 space-y-3">
          {(snapshot?.guardrails ?? []).map((guardrail) => (
            <div key={guardrail.id} className="rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">{guardrail.title}</div>
              <p className="mt-1 text-xs text-slate-600">{guardrail.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-brand-blue/20 bg-brand-blue/5 p-4">
        <h2 className="text-lg font-semibold text-brand-navy">Change global policy</h2>
        <p className="mt-2 text-sm text-slate-600">
          Saves to the admin FeatureFlag store and applies to every wired compare/validation surface. Deploy env{" "}
          <code className="rounded bg-white px-1">VALIDATION_DAY_POLICY_OVERRIDE_JSON</code> still wins when set.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-brand-navy">Selection mode</span>
            <select className="rounded border px-3 py-2" value={draftMode} onChange={(e) => setDraftMode(e.target.value)}>
              {AUTO_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-brand-navy">Validation day count</span>
            <input
              className="rounded border px-3 py-2"
              value={draftCount}
              onChange={(e) => setDraftCount(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-brand-navy">Surface owner</span>
            <select
              className="rounded border px-3 py-2"
              value={draftSurface}
              onChange={(e) => setDraftSurface(e.target.value as "admin_lab" | "user_site")}
            >
              <option value="admin_lab">admin_lab</option>
              <option value="user_site">user_site</option>
            </select>
          </label>
        </div>
        <label className="mt-4 grid gap-1 text-sm">
          <span className="font-semibold text-brand-navy">
            Confirmation ({snapshot?.confirmationKeyword ?? "APPLY"})
          </span>
          <input
            className="rounded border px-3 py-2"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={snapshot?.confirmationKeyword ?? "APPLY"}
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={policyBusy || confirmation !== (snapshot?.confirmationKeyword ?? "APPLY") || !draftDirty}
            onClick={() => void savePolicy()}
            className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {policyBusy ? "Saving…" : "Save global policy"}
          </button>
          <button
            type="button"
            disabled={policyBusy || confirmation !== (snapshot?.confirmationKeyword ?? "APPLY")}
            onClick={() => void resetPolicy()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50"
          >
            Reset to code defaults
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-brand-navy">Preview selected days on a real home</h2>
        <p className="mt-2 text-sm text-slate-600">
          Load houses with the customer email, then preview how the active (or draft) policy selects compare days.
          Selected keys are bounded to the canonical coverage window and exclude travel dates.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="font-semibold text-brand-navy">User email</span>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded border px-3 py-2"
                value={previewEmail}
                onChange={(e) => setPreviewEmail(e.target.value)}
                placeholder="customer@example.com"
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => void lookupPreviewHouses()}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy"
              >
                Load houses
              </button>
            </div>
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="font-semibold text-brand-navy">House</span>
            <select
              className="rounded border px-3 py-2"
              value={previewHouseId}
              onChange={(e) => setPreviewHouseId(e.target.value)}
              disabled={previewHouses.length === 0}
            >
              <option value="">Select a house after email lookup</option>
              {previewHouses.map((house) => (
                <option key={house.id} value={house.id}>
                  {house.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={previewUseDraft}
            onChange={(e) => setPreviewUseDraft(e.target.checked)}
          />
          Preview using draft settings above (does not save until you click Save global policy)
        </label>
        <button
          type="button"
          disabled={loading}
          onClick={() => void runPreview()}
          className="mt-4 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Previewing…" : "Preview validation days"}
        </button>
        {preview ? (
          <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div>
              Policy: {preview.selectionMode} · {preview.validationDayCount} days · hash{" "}
              <span className="font-mono text-xs">{preview.policyHash}</span>
            </div>
            <div>
              Window: {preview.diagnostics.windowStart} → {preview.diagnostics.windowEnd}
            </div>
            <div>
              Candidates: {preview.diagnostics.candidateDateKeyCount} · Travel excluded:{" "}
              {preview.diagnostics.excludedTravelDateKeyCount}
            </div>
            <div>
              Selected ({preview.selectedValidationDateKeys.length}):{" "}
              <span className="font-mono text-xs">{preview.selectedValidationDateKeys.join(", ")}</span>
            </div>
            {preview.warnings.length > 0 ? (
              <div className="text-xs text-amber-800">{preview.warnings.join(" ")}</div>
            ) : null}
            <details>
              <summary className="cursor-pointer font-semibold text-brand-navy">Selection diagnostics</summary>
              <pre className="mt-2 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                {JSON.stringify(preview.diagnostics.selectionDiagnostics, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </section>

      <p className="text-xs text-slate-500">
        Related: <Link href="/admin/tools/one-path-sim">One Path Sim</Link> ·{" "}
        <Link href="/admin/tools/manual-gapfill">Manual GapFill</Link> ·{" "}
        <Link href="/admin/tools/gapfill-lab">GapFill Lab</Link>
      </p>
    </div>
  );
}
