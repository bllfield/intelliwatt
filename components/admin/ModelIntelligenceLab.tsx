"use client";

import { useCallback, useMemo, useState } from "react";
import {
  defaultModelIntelligenceManualGapfillOptions,
  defaultModelIntelligenceOnePathOptions,
  defaultModelIntelligenceOrchestrationFlags,
  defaultModelIntelligenceSelectedRuns,
  fetchModelIntelligenceContext,
  fetchModelIntelligenceHouses,
  fetchModelIntelligenceSequencePreview,
  MODEL_INTELLIGENCE_RUN_MODE_LABELS,
} from "@/lib/admin/modelIntelligenceClient";
import type { AdminHouseLookupRow } from "@/lib/admin/adminHouseLookup";
import type {
  ModelIntelligenceLabContext,
  ModelIntelligenceModeAvailability,
  ModelIntelligenceRunMode,
  ModelIntelligenceSequencePreview,
} from "@/modules/modelIntelligence/types";
import { MODEL_INTELLIGENCE_RUN_MODES } from "@/modules/modelIntelligence/types";

const TABS = [
  "Orchestrate Runs",
  "Results Matrix",
  "Miss Explorer",
  "Cohort Intelligence",
  "Tuning Queue",
  "Export / AI Copy Bundle",
  "Simulation Code Map",
] as const;

type TabId = (typeof TABS)[number];

function RunModeCheckbox(props: {
  mode: ModelIntelligenceRunMode;
  checked: boolean;
  availability: ModelIntelligenceModeAvailability | undefined;
  onChange: (checked: boolean) => void;
}) {
  const gbDisabled = props.mode === "GREEN_BUTTON_TRUTH" && props.availability && !props.availability.available;
  return (
    <label
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${gbDisabled ? "border-slate-200 bg-slate-50 opacity-80" : "border-slate-300 bg-white"}`}
      title={props.availability?.unavailableReason ?? undefined}
    >
      <input
        type="checkbox"
        checked={props.checked}
        disabled={Boolean(gbDisabled)}
        onChange={(event) => props.onChange(event.target.checked)}
        className="mt-1"
      />
      <span>
        <span className="font-semibold text-brand-navy">{MODEL_INTELLIGENCE_RUN_MODE_LABELS[props.mode]}</span>
        {props.availability && !props.availability.available ? (
          <span className="mt-1 block text-xs text-amber-700">{props.availability.unavailableReason}</span>
        ) : null}
      </span>
    </label>
  );
}

function PlaceholderTab(props: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
      <div className="font-semibold text-brand-navy">{props.title}</div>
      <p className="mt-2">{props.detail}</p>
    </div>
  );
}

export function ModelIntelligenceLab() {
  const [activeTab, setActiveTab] = useState<TabId>("Orchestrate Runs");
  const [email, setEmail] = useState("brian@intellipath-solutions.com");
  const [houses, setHouses] = useState<AdminHouseLookupRow[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [userId, setUserId] = useState("");
  const [context, setContext] = useState<ModelIntelligenceLabContext | null>(null);
  const [modeAvailability, setModeAvailability] = useState<ModelIntelligenceModeAvailability[]>([]);
  const [preview, setPreview] = useState<ModelIntelligenceSequencePreview | null>(null);
  const [selectedRuns, setSelectedRuns] = useState(defaultModelIntelligenceSelectedRuns);
  const [onePathOptions, setOnePathOptions] = useState(defaultModelIntelligenceOnePathOptions);
  const [manualGapfillOptions, setManualGapfillOptions] = useState(defaultModelIntelligenceManualGapfillOptions);
  const [flags, setFlags] = useState(defaultModelIntelligenceOrchestrationFlags);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const availabilityByMode = useMemo(() => {
    const rows = preview?.modeAvailability?.length ? preview.modeAvailability : modeAvailability;
    return new Map(rows.map((row) => [row.mode, row]));
  }, [modeAvailability, preview?.modeAvailability]);

  const loadHouses = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    setPreview(null);
    setContext(null);
    setModeAvailability([]);
    const result = await fetchModelIntelligenceHouses(email.trim());
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setHouses(result.data.houses);
    setUserId(result.data.userId);
    const primary = result.data.houses.find((house) => house.isPrimary) ?? result.data.houses[0] ?? null;
    setSelectedHouseId(primary?.id ?? "");
    setStatus(`Loaded ${result.data.houses.length} house(s) for ${result.data.email}.`);
  }, [email]);

  const loadContext = useCallback(async () => {
    if (!email.trim() || !selectedHouseId) {
      setError("Load houses and select a house first.");
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    const house = houses.find((row) => row.id === selectedHouseId);
    const result = await fetchModelIntelligenceContext({
      email: email.trim(),
      houseId: selectedHouseId,
      esiid: house?.esiid,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setContext(result.data.context);
    setHouses(result.data.houses);
    setModeAvailability(result.data.modeAvailability ?? []);
    setStatus("Source context loaded. No simulation has run.");
  }, [email, houses, selectedHouseId]);

  const previewSequence = useCallback(async () => {
    if (!email.trim() || !selectedHouseId) {
      setError("Load houses and select a house first.");
      return;
    }
    setLoading(true);
    setError(null);
    const house = houses.find((row) => row.id === selectedHouseId);
    const result = await fetchModelIntelligenceSequencePreview({
      email: email.trim(),
      houseId: selectedHouseId,
      esiid: house?.esiid,
      selectedRuns,
      onePathOptions,
      manualGapfillOptions,
      flags,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setContext(result.data.context);
    setPreview(result.data.preview);
    setModeAvailability(result.data.preview.modeAvailability);
    setStatus("Sequence preview ready. Phase 1 does not execute simulations.");
    setActiveTab("Orchestrate Runs");
  }, [email, flags, houses, manualGapfillOptions, onePathOptions, selectedHouseId, selectedRuns]);

  const clearResults = useCallback(() => {
    setPreview(null);
    setStatus("Cleared preview/results.");
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Model Intelligence Lab</h1>
        <p className="mt-2 max-w-4xl text-sm text-slate-600">
          Orchestrate One Path masked simulations, compare results using shared diagnostics, analyze cohorts, and manage
          tuning recommendations. Phase 1: context load, options, and sequence preview only.
        </p>
      </div>

      <div className="sticky top-0 z-20 rounded-xl border border-brand-navy/20 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-brand-navy">Control panel</div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[240px] flex-1 text-sm">
              <span className="font-medium text-slate-700">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="user@example.com"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadHouses()}
              disabled={loading}
              className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Load Houses
            </button>
            <label className="block min-w-[280px] flex-1 text-sm">
              <span className="font-medium text-slate-700">House</span>
              <select
                value={selectedHouseId}
                onChange={(event) => setSelectedHouseId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                disabled={!houses.length}
              >
                <option value="">Select house…</option>
                {houses.map((house) => (
                  <option key={house.id} value={house.id}>
                    {house.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {context ? (
          <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="font-semibold text-brand-navy">Identity</div>
              <div>userId: {context.userId}</div>
              <div>sourceHouseId: {context.sourceHouseId}</div>
              <div>ESIID: {context.esiid ?? "—"}</div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy">Address / source</div>
              <div>{context.addressLabel ?? "—"}</div>
              <div>committed source: {context.committedUsageSource ?? "none"}</div>
              <div>actual source kind: {context.actualSourceKind}</div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy">Actual context</div>
              <div>actualContextHouseId: {context.actualContextHouseId}</div>
              <div>
                coverage: {context.coverageStart ?? "—"} → {context.coverageEnd ?? "—"}
              </div>
              <div>
                daily {context.dailyCount} · intervals {context.intervalCount} · annual{" "}
                {context.annualTotalKwh ?? "—"} kWh
              </div>
            </div>
            <div>
              <div className="font-semibold text-brand-navy">Lab test home</div>
              <div>labHouseId: {context.labTestHome.testHomeHouseId ?? "—"}</div>
              <div>pinned: {context.labTestHome.isPinnedToSource ? "yes" : "no"}</div>
              <div>status: {context.labTestHome.status}</div>
            </div>
          </div>
        ) : null}

        {context?.warnings?.length ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            {context.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Run selection</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {MODEL_INTELLIGENCE_RUN_MODES.map((mode) => (
                <RunModeCheckbox
                  key={mode}
                  mode={mode}
                  checked={selectedRuns[mode]}
                  availability={availabilityByMode.get(mode)}
                  onChange={(checked) => setSelectedRuns((current) => ({ ...current, [mode]: checked }))}
                />
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["runCompareDiagnostics", "Run compare diagnostics after each simulated run"],
                  ["buildCohortSnapshot", "Build cohort intelligence snapshot"],
                  ["updateTuningQueue", "Update tuning queue recommendations"],
                  ["includeAiExportBundle", "Include AI export bundle"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={flags[key]}
                    onChange={(event) => setFlags((current) => ({ ...current, [key]: event.target.checked }))}
                    className="mt-1"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">One Path options</div>
              <div className="mt-2 space-y-2 text-sm">
                <label className="block">
                  weatherPreference
                  <select
                    value={onePathOptions.weatherPreference}
                    onChange={(event) =>
                      setOnePathOptions((current) => ({
                        ...current,
                        weatherPreference: event.target.value as typeof current.weatherPreference,
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                  >
                    <option value="NONE">NONE</option>
                    <option value="LAST_YEAR_WEATHER">LAST_YEAR_WEATHER</option>
                    <option value="LONG_TERM_AVERAGE">LONG_TERM_AVERAGE</option>
                  </select>
                </label>
                <label className="block">
                  validationSelectionMode
                  <select
                    value={onePathOptions.validationSelectionMode}
                    onChange={(event) =>
                      setOnePathOptions((current) => ({
                        ...current,
                        validationSelectionMode: event.target.value as typeof current.validationSelectionMode,
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                  >
                    <option value="policy_default">policy_default</option>
                    <option value="fixed_count">fixed_count</option>
                    <option value="explicit_dates">explicit_dates</option>
                  </select>
                </label>
                <label className="block">
                  validationDayCount
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={onePathOptions.validationDayCount}
                    onChange={(event) =>
                      setOnePathOptions((current) => ({
                        ...current,
                        validationDayCount: Number(event.target.value) || 14,
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                  />
                </label>
                <label className="block">
                  actualContextHouseId override
                  <input
                    value={onePathOptions.actualContextHouseIdOverride ?? ""}
                    onChange={(event) =>
                      setOnePathOptions((current) => ({
                        ...current,
                        actualContextHouseIdOverride: event.target.value.trim() || null,
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                    placeholder="defaults to resolved actualContextHouseId"
                  />
                </label>
                {(
                  [
                    ["persistRequested", "persistRequested"],
                    ["includeDebugDiagnostics", "includeDebugDiagnostics"],
                    ["includeSimRunAudit", "includeSimRunAudit"],
                    ["includePosthocTopMissIntervalCurves", "includePosthocTopMissIntervalCurves"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={onePathOptions[key]}
                      onChange={(event) =>
                        setOnePathOptions((current) => ({ ...current, [key]: event.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
                <label className="block">
                  runReason
                  <input
                    value={onePathOptions.runReason}
                    onChange={(event) =>
                      setOnePathOptions((current) => ({ ...current, runReason: event.target.value }))
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual GapFill options</div>
              <div className="mt-2 space-y-2 text-sm">
                <label className="block">
                  manualGapfillMode
                  <select
                    value={manualGapfillOptions.manualGapfillMode}
                    onChange={(event) =>
                      setManualGapfillOptions((current) => ({
                        ...current,
                        manualGapfillMode: event.target.value as typeof current.manualGapfillMode,
                      }))
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                  >
                    <option value="MONTHLY_FROM_SOURCE_INTERVALS">MONTHLY_FROM_SOURCE_INTERVALS</option>
                    <option value="ANNUAL_FROM_SOURCE_INTERVALS">ANNUAL_FROM_SOURCE_INTERVALS</option>
                  </select>
                </label>
                <label className="block">
                  anchorEndDate
                  <input
                    value={manualGapfillOptions.anchorEndDate}
                    onChange={(event) =>
                      setManualGapfillOptions((current) => ({ ...current, anchorEndDate: event.target.value }))
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                    placeholder="optional YYYY-MM-DD"
                  />
                </label>
                {(
                  [
                    ["includeDiagnostics", "includeDiagnostics"],
                    ["includeDailyRows", "includeDailyRows"],
                    ["persistSeedToggle", "persistSeedToggle"],
                    ["includeIntervalCurveDiagnostics", "includeIntervalCurveDiagnostics"],
                    ["includeTopMissCurves", "includeTopMissCurves"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={manualGapfillOptions[key]}
                      onChange={(event) =>
                        setManualGapfillOptions((current) => ({ ...current, [key]: event.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadContext()}
            disabled={loading || !selectedHouseId}
            className="rounded-lg border border-brand-navy px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50"
          >
            Load Context
          </button>
          <button
            type="button"
            onClick={() => void previewSequence()}
            disabled={loading || !selectedHouseId}
            className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Preview Sequence
          </button>
          <button
            type="button"
            disabled
            title="Phase 2 — client-driven step runner"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-400"
          >
            Run Orchestrate
          </button>
          <button
            type="button"
            disabled
            title="Phase 2"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-400"
          >
            Cancel Running Sequence
          </button>
          <button
            type="button"
            disabled
            title="Phase 4"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-400"
          >
            Export AI Bundle
          </button>
          <button
            type="button"
            onClick={clearResults}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Clear Results
          </button>
        </div>

        {status ? <div className="mt-3 text-sm text-emerald-700">{status}</div> : null}
        {error ? <div className="mt-3 text-sm text-red-700">{error}</div> : null}
        {userId ? <div className="mt-2 text-xs text-slate-500">Resolved userId: {userId}</div> : null}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              activeTab === tab ? "bg-brand-navy text-white" : "bg-slate-100 text-brand-navy"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Orchestrate Runs" ? (
        <div className="space-y-4">
          {preview ? (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
                <div className="font-semibold text-brand-navy">Sequence preview</div>
                <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <div>Phase: {preview.phase}</div>
                  <div>Selected modes: {preview.summary.selectedModeCount}</div>
                  <div>Planned steps: {preview.summary.plannedStepCount}</div>
                  <div>Unavailable steps: {preview.summary.unavailableStepCount}</div>
                  <div>Simulation will run: {preview.summary.simulationWillRun ? "yes" : "no"}</div>
                  <div>Compare planned: {preview.summary.compareDiagnosticsPlanned ? "yes" : "no"}</div>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Kind</th>
                      <th className="px-3 py-2">Label</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.steps.map((step) => (
                      <tr key={step.stepId} className="border-t border-slate-100">
                        <td className="px-3 py-2">{step.order}</td>
                        <td className="px-3 py-2 font-mono text-xs">{step.kind}</td>
                        <td className="px-3 py-2">{step.label}</td>
                        <td className="px-3 py-2">{step.runMode ?? "—"}</td>
                        <td className="px-3 py-2">{step.status}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{step.unavailableReason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Raw preview JSON</summary>
                <pre className="mt-3 overflow-x-auto text-xs">{JSON.stringify(preview, null, 2)}</pre>
              </details>
            </>
          ) : (
            <PlaceholderTab
              title="No sequence preview yet"
              detail="Load context, select run modes, then click Preview Sequence. Phase 1 does not execute One Path simulations."
            />
          )}
        </div>
      ) : null}

      {activeTab === "Results Matrix" ? (
        <PlaceholderTab title="Results Matrix" detail="Phase 3 — side-by-side metrics for each selected run mode." />
      ) : null}
      {activeTab === "Miss Explorer" ? (
        <PlaceholderTab title="Diagnostics / Miss Explorer" detail="Phase 3 — worst days, weather buckets, interval curves from existing compare outputs." />
      ) : null}
      {activeTab === "Cohort Intelligence" ? (
        <PlaceholderTab title="Cohort Intelligence" detail="Phase 5 — aggregate cohort fingerprints and priors. Analytics only; no customer simulation." />
      ) : null}
      {activeTab === "Tuning Queue" ? (
        <PlaceholderTab title="Model Recommendation / Tuning Queue" detail="Phase 6 placeholder. Persistent admin DB queue with backlog/investigating/tuned statuses." />
      ) : null}
      {activeTab === "Export / AI Copy Bundle" ? (
        <PlaceholderTab title="Export / AI Copy Bundle" detail="Phase 4 — complete ChatGPT tuning payload after runs complete." />
      ) : null}
      {activeTab === "Simulation Code Map" ? (
        <PlaceholderTab title="Simulation Code Map" detail="Phase 4 — read-only module map with git commit, routes, and artifact hashes." />
      ) : null}
    </div>
  );
}
