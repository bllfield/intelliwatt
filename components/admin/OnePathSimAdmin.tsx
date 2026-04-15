"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppliancesClient } from "@/components/appliances/AppliancesClient";
import { HomeDetailsClient } from "@/components/home/HomeDetailsClient";
import { ManualUsageEntry } from "@/components/manual/ManualUsageEntry";

type LookupResponse = {
  ok: true;
  email: string;
  userId: string;
  houses: Array<{ id: string; label: string; esiid: string | null }>;
  selectedHouse: { id: string; label: string; esiid: string | null };
  scenarios: Array<{ id: string; name: string }>;
  sourceContext: Record<string, unknown>;
};

type VariablePolicyResponse = {
  ok: true;
  confirmationKeyword: string;
  familyMeta: Record<string, { title: string; description: string }>;
  defaults: Record<string, unknown>;
  effectiveByMode: Record<string, Record<string, unknown>>;
  overrides: Record<string, unknown>;
};

const VALIDATION_SELECTION_OPTIONS = [
  { value: "manual", label: "manual" },
  { value: "random_simple", label: "random_simple" },
  { value: "customer_style_seasonal_mix", label: "customer_style_seasonal_mix" },
  { value: "stratified_weather_balanced", label: "stratified_weather_balanced" },
] as const;

function Modal(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-4xl rounded-3xl border border-brand-blue/15 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-brand-blue/10 px-6 py-4">
          <div className="text-sm font-semibold text-brand-navy">{props.title}</div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-full border border-brand-blue/20 bg-white px-3 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5"
          >
            Close
          </button>
        </div>
        <div className="max-h-[75vh] overflow-auto px-6 py-5">{props.children}</div>
      </div>
    </div>
  );
}

function SectionJson(props: { title: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-brand-navy">{props.title}</div>
      <pre className="mt-3 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
        {JSON.stringify(props.value, null, 2)}
      </pre>
    </div>
  );
}

export function OnePathSimAdmin() {
  const [email, setEmail] = useState("");
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [mode, setMode] = useState<"INTERVAL" | "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | "NEW_BUILD">("INTERVAL");
  const [weatherPreference, setWeatherPreference] = useState<"NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE">(
    "LAST_YEAR_WEATHER"
  );
  const [validationSelectionMode, setValidationSelectionMode] = useState("manual");
  const [validationDayCount, setValidationDayCount] = useState("14");
  const [persistRequested, setPersistRequested] = useState(true);
  const [runReason, setRunReason] = useState("one_path_admin_harness");
  const [travelRanges, setTravelRanges] = useState<Array<{ startDate: string; endDate: string }>>([]);
  const [travelOpen, setTravelOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const [applianceOpen, setApplianceOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<any | null>(null);
  const [variablePolicy, setVariablePolicy] = useState<VariablePolicyResponse | null>(null);
  const [variableFamilyOpen, setVariableFamilyOpen] = useState<string | null>(null);
  const [variableDraft, setVariableDraft] = useState("{}");
  const [variableConfirmation, setVariableConfirmation] = useState("");
  const [variableBusy, setVariableBusy] = useState(false);
  const [variableError, setVariableError] = useState<string | null>(null);

  const loadVariablePolicy = useCallback(async () => {
    const res = await fetch("/api/admin/tools/one-path-sim/variables");
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setVariableError(json?.error ?? `Variables load failed (${res.status})`);
      return;
    }
    setVariablePolicy(json);
    setVariableError(null);
  }, []);

  useEffect(() => {
    void loadVariablePolicy();
  }, [loadVariablePolicy]);

  const openVariableFamily = useCallback(
    (familyKey: string) => {
      setVariableFamilyOpen(familyKey);
      setVariableDraft(JSON.stringify((variablePolicy?.overrides?.[familyKey] as Record<string, unknown> | undefined) ?? {}, null, 2));
      setVariableConfirmation("");
      setVariableError(null);
    },
    [variablePolicy]
  );

  const saveVariableFamily = useCallback(async () => {
    if (!variableFamilyOpen) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(variableDraft || "{}");
    } catch {
      setVariableError("Override JSON is invalid.");
      return;
    }
    setVariableBusy(true);
    setVariableError(null);
    const res = await fetch("/api/admin/tools/one-path-sim/variables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family: variableFamilyOpen,
        override: parsed,
        confirmation: variableConfirmation,
      }),
    });
    const json = await res.json().catch(() => null);
    setVariableBusy(false);
    if (!res.ok || !json?.ok) {
      setVariableError(json?.error ?? `Override save failed (${res.status})`);
      return;
    }
    setVariablePolicy(json);
    setStatus(`Shared override saved for ${variableFamilyOpen}.`);
  }, [variableConfirmation, variableDraft, variableFamilyOpen]);

  const resetVariableFamily = useCallback(async () => {
    if (!variableFamilyOpen || !variablePolicy) return;
    if (variableConfirmation !== variablePolicy.confirmationKeyword) {
      setVariableError("Enter the OVERRIDE keyword to reset this family.");
      return;
    }
    setVariableDraft("{}");
    setVariableError(null);
    const nextOverrides = { ...(variablePolicy.overrides ?? {}), [variableFamilyOpen]: {} };
    setVariableBusy(true);
    const res = await fetch("/api/admin/tools/one-path-sim/variables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        overrides: nextOverrides,
        confirmation: variableConfirmation,
      }),
    });
    const json = await res.json().catch(() => null);
    setVariableBusy(false);
    if (!res.ok || !json?.ok) {
      setVariableError(json?.error ?? `Override reset failed (${res.status})`);
      return;
    }
    setVariablePolicy(json);
    setStatus(`Shared override reset for ${variableFamilyOpen}.`);
  }, [variableConfirmation, variableFamilyOpen, variablePolicy]);

  const effectiveHouseId = selectedHouseId || lookup?.selectedHouse?.id || "";
  const loadLookup = useCallback(
    async (houseIdOverride?: string) => {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setError("Enter a user email.");
        return;
      }
      setBusy(true);
      setError(null);
      setStatus("Loading user, houses, and source context...");
      const res = await fetch("/api/admin/tools/one-path-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "lookup",
          email: trimmedEmail,
          houseId: houseIdOverride ?? effectiveHouseId ?? "",
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setBusy(false);
        setStatus(null);
        setError(json?.error ?? `Lookup failed (${res.status})`);
        return;
      }
      setLookup(json);
      setSelectedHouseId(json.selectedHouse?.id ?? "");
      setSelectedScenarioId("");
      const sourceTravelRanges = Array.isArray((json.sourceContext?.travelRangesFromDb as any[]))
        ? (json.sourceContext.travelRangesFromDb as Array<{ startDate: string; endDate: string }>)
        : [];
      setTravelRanges(sourceTravelRanges);
      setBusy(false);
      setStatus("Lookup loaded.");
    },
    [email, effectiveHouseId]
  );

  const runSimulation = useCallback(async () => {
    if (!lookup || !effectiveHouseId) {
      setError("Load a user and select a house first.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(`Running canonical ${mode} through the shared producer pipeline...`);
    const res = await fetch("/api/admin/tools/one-path-sim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "run",
        email: lookup.email,
        houseId: effectiveHouseId,
        scenarioId: selectedScenarioId || null,
        mode,
        weatherPreference,
        validationSelectionMode,
        validationDayCount: Number(validationDayCount) || null,
        travelRanges,
        persistRequested,
        runReason,
      }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !json?.ok) {
      setStatus(null);
      setError(json?.error ?? `Run failed (${res.status})`);
      return;
    }
    setRunResult(json);
    setStatus("Shared run completed and read back from the canonical artifact/read-model path.");
  }, [
    effectiveHouseId,
    lookup,
    mode,
    persistRequested,
    runReason,
    selectedScenarioId,
    travelRanges,
    validationDayCount,
    validationSelectionMode,
    weatherPreference,
  ]);

  const manualTransport = useMemo(
    () => ({
      load: async (houseId: string) => {
        const res = await fetch("/api/admin/tools/one-path-sim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "load_manual",
            email: lookup?.email ?? email,
            houseId,
          }),
        });
        return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as any;
      },
      save: async (args: { houseId: string; payload: any }) => {
        const res = await fetch("/api/admin/tools/one-path-sim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_manual",
            email: lookup?.email ?? email,
            houseId: args.houseId,
            payload: args.payload,
          }),
        });
        return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as any;
      },
    }),
    [email, lookup?.email]
  );

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-2xl bg-brand-white p-6 shadow-lg">
          <div className="text-2xl font-semibold text-brand-navy">One Path Sim Admin</div>
          <p className="mt-2 max-w-4xl text-sm text-slate-600">
            Thin admin harness for the canonical shared simulation path. All four modes adapt into one shared producer
            pipeline, persist one artifact family, and render from the shared read model only.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <div className="grid gap-4 lg:grid-cols-4">
            <label className="text-sm text-slate-700 lg:col-span-2">
              <div className="font-semibold text-brand-navy">User email lookup</div>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="customer@example.com"
              />
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">House</div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={effectiveHouseId}
                onChange={(event) => setSelectedHouseId(event.target.value)}
              >
                <option value="">Select house</option>
                {(lookup?.houses ?? []).map((house) => (
                  <option key={house.id} value={house.id}>
                    {house.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void loadLookup()}
                disabled={busy}
                className="w-full rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy disabled:opacity-60"
              >
                Lookup and Load
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-4">
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Mode</div>
              <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={mode} onChange={(event) => setMode(event.target.value as any)}>
                <option value="INTERVAL">INTERVAL</option>
                <option value="MANUAL_MONTHLY">MANUAL_MONTHLY</option>
                <option value="MANUAL_ANNUAL">MANUAL_ANNUAL</option>
                <option value="NEW_BUILD">NEW_BUILD</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Scenario</div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={selectedScenarioId}
                onChange={(event) => setSelectedScenarioId(event.target.value)}
              >
                <option value="">Baseline</option>
                {(lookup?.scenarios ?? []).map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Weather preference</div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={weatherPreference}
                onChange={(event) => setWeatherPreference(event.target.value as any)}
              >
                <option value="LAST_YEAR_WEATHER">LAST_YEAR_WEATHER</option>
                <option value="LONG_TERM_AVERAGE">LONG_TERM_AVERAGE</option>
                <option value="NONE">NONE</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Validation day count</div>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={validationDayCount}
                onChange={(event) => setValidationDayCount(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Validation selection mode</div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={validationSelectionMode}
                onChange={(event) => setValidationSelectionMode(event.target.value)}
              >
                {VALIDATION_SELECTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Run reason</div>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={runReason}
                onChange={(event) => setRunReason(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={persistRequested} onChange={(event) => setPersistRequested(event.target.checked)} />
              Persist requested
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setHomeOpen(true)}
              disabled={!effectiveHouseId}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50"
            >
              Home Details popup
            </button>
            <button
              type="button"
              onClick={() => setApplianceOpen(true)}
              disabled={!effectiveHouseId}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50"
            >
              Appliance Details popup
            </button>
            <button
              type="button"
              onClick={() => setTravelOpen(true)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy"
            >
              Travel/Vacant Dates popup
            </button>
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              disabled={!effectiveHouseId}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50"
            >
              Manual Usage Entry popup
            </button>
            <button
              type="button"
              onClick={() => void runSimulation()}
              disabled={busy || !lookup || !effectiveHouseId}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Run shared producer
            </button>
          </div>

          <div className="mt-6 rounded-xl border border-brand-blue/10 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-brand-navy">Shared calculation variable popups</div>
            <p className="mt-1 text-xs text-slate-600">
              These edit the shared module variables directly. A change here affects the shared calculation owners that read this policy.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {Object.entries(variablePolicy?.familyMeta ?? {}).map(([familyKey, meta]) => (
                <button
                  key={familyKey}
                  type="button"
                  onClick={() => openVariableFamily(familyKey)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy"
                >
                  {meta.title} variables
                </button>
              ))}
            </div>
          </div>

          {status ? <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{status}</div> : null}
          {error ? <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionJson title="Loaded source context" value={lookup?.sourceContext ?? null} />
          <SectionJson
            title="Harness controls snapshot"
            value={{
              email: lookup?.email ?? email,
              selectedHouseId: effectiveHouseId || null,
              selectedScenarioId: selectedScenarioId || null,
              mode,
              weatherPreference,
              validationSelectionMode,
              validationDayCount,
              persistRequested,
              runReason,
              travelRanges,
            }}
          />
          <SectionJson title="Shared simulation variable overrides" value={variablePolicy?.overrides ?? null} />
          <SectionJson title="Shared simulation variable defaults" value={variablePolicy?.defaults ?? null} />
          <SectionJson title={`Shared simulation variables for ${mode}`} value={variablePolicy?.effectiveByMode?.[mode] ?? null} />
        </div>

        {runResult ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionJson title="Canonical engine input" value={runResult.engineInput} />
            <SectionJson title="Canonical artifact" value={runResult.artifact} />
            <SectionJson title="Canonical read model" value={runResult.readModel} />
            <SectionJson title="Read model dataset summary" value={runResult.readModel?.dataset?.summary ?? null} />
            <SectionJson title="Effective Variables Used By Last Run" value={runResult.readModel?.effectiveSimulationVariablesUsed ?? null} />
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-brand-navy">Effective Variables Used By Last Run</div>
              <p className="mt-2 text-xs text-slate-600">
                Value sources are resolved in the shared canonical read model only. Labels include default, mode override,
                and explicit admin override.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <Modal open={homeOpen} title="Home Details popup/editor" onClose={() => setHomeOpen(false)}>
        {effectiveHouseId ? (
          <HomeDetailsClient
            houseId={effectiveHouseId}
            loadUrl="/api/admin/tools/one-path-sim/home-profile"
            saveUrl="/api/admin/tools/one-path-sim/home-profile"
            prefillUrl="/api/admin/tools/one-path-sim/home-profile/prefill"
            awardEntries={false}
            onSaved={async () => {
              await loadLookup(effectiveHouseId);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={applianceOpen} title="Appliance Details popup/editor" onClose={() => setApplianceOpen(false)}>
        {effectiveHouseId ? (
          <AppliancesClient
            houseId={effectiveHouseId}
            loadUrl="/api/admin/tools/one-path-sim/appliances"
            saveUrl="/api/admin/tools/one-path-sim/appliances"
            awardEntries={false}
            onSaved={async () => {
              await loadLookup(effectiveHouseId);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={manualOpen} title="Manual Usage Entry popup/editor" onClose={() => setManualOpen(false)}>
        {effectiveHouseId ? (
          <ManualUsageEntry
            houseId={effectiveHouseId}
            transport={manualTransport}
            showMonthlyDateSourceControls
            onSaved={async () => {
              await loadLookup(effectiveHouseId);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={travelOpen} title="Travel/Vacant Dates popup/editor" onClose={() => setTravelOpen(false)}>
        <div className="space-y-3">
          {travelRanges.map((range, index) => (
            <div key={`${index}:${range.startDate}:${range.endDate}`} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={range.startDate}
                onChange={(event) =>
                  setTravelRanges((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, startDate: event.target.value } : row)))
                }
                placeholder="YYYY-MM-DD"
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={range.endDate}
                onChange={(event) =>
                  setTravelRanges((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, endDate: event.target.value } : row)))
                }
                placeholder="YYYY-MM-DD"
              />
              <button
                type="button"
                onClick={() => setTravelRanges((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-brand-navy"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTravelRanges((current) => [...current, { startDate: "", endDate: "" }])}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-brand-navy"
          >
            Add travel range
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(variableFamilyOpen)}
        title={
          variableFamilyOpen
            ? `${variablePolicy?.familyMeta?.[variableFamilyOpen]?.title ?? variableFamilyOpen} variables`
            : "Shared variables"
        }
        onClose={() => {
          setVariableFamilyOpen(null);
          setVariableConfirmation("");
          setVariableError(null);
        }}
      >
        {variableFamilyOpen ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {variablePolicy?.familyMeta?.[variableFamilyOpen]?.description ?? "Shared module variables."}
            </div>
            <SectionJson title="Shared defaults" value={variablePolicy?.defaults?.[variableFamilyOpen] ?? null} />
            <SectionJson title={`Resolved values for ${mode}`} value={variablePolicy?.effectiveByMode?.[mode]?.[variableFamilyOpen] ?? null} />
            <SectionJson title="Current overrides" value={variablePolicy?.overrides?.[variableFamilyOpen] ?? {}} />
            <label className="block text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Editable override JSON</div>
              <textarea
                className="mt-1 min-h-[220px] w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                value={variableDraft}
                onChange={(event) => setVariableDraft(event.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">
                OVERRIDE field
              </div>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={variableConfirmation}
                onChange={(event) => setVariableConfirmation(event.target.value)}
                placeholder={variablePolicy?.confirmationKeyword ?? "OVERRIDE"}
              />
            </label>
            {variableError ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{variableError}</div> : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void saveVariableFamily()}
                disabled={variableBusy || variableConfirmation !== (variablePolicy?.confirmationKeyword ?? "OVERRIDE")}
                className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Save shared override
              </button>
              <button
                type="button"
                onClick={() => void resetVariableFamily()}
                disabled={variableBusy || variableConfirmation !== (variablePolicy?.confirmationKeyword ?? "OVERRIDE")}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60"
              >
                Reset this family
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
