"use client";

import { useMemo, useState } from "react";
import { AppliancesClient } from "@/components/appliances/AppliancesClient";
import { HomeDetailsClient } from "@/components/home/HomeDetailsClient";
import { ManualUsageEntry } from "@/components/manual/ManualUsageEntry";
import UsageDashboard from "@/components/usage/UsageDashboard";
import { ManualMonthlyReconciliationPanel } from "@/components/usage/ManualMonthlyReconciliationPanel";
import { buildManualMonthlyStageOneRows } from "@/modules/manualUsage/statementRanges";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

type HouseOption = {
  id: string;
  label: string;
  esiid?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
};

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function compactSummary(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "unavailable";
}

function SectionJson(props: { title: string; value: unknown; open?: boolean }) {
  return (
    <details className="rounded border border-slate-200 p-3" open={props.open}>
      <summary className="cursor-pointer font-semibold text-brand-navy">{props.title}</summary>
      <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson(props.value)}</pre>
    </details>
  );
}

function ModalShell(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 px-4 py-8">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-xl bg-brand-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-brand-navy">{props.title}</h2>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export default function ManualMonthlyLab() {
  const [adminToken, setAdminToken] = useState("");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [sourceUserId, setSourceUserId] = useState<string | null>(null);
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualEntryKey, setManualEntryKey] = useState(0);
  const [lookupJson, setLookupJson] = useState<any>(null);
  const [loadJson, setLoadJson] = useState<any>(null);
  const [saveJson, setSaveJson] = useState<any>(null);
  const [recalcJson, setRecalcJson] = useState<any>(null);
  const [resultJson, setResultJson] = useState<any>(null);
  const [showHomeDetails, setShowHomeDetails] = useState(false);
  const [showAppliances, setShowAppliances] = useState(false);

  const selectedHouse = useMemo(
    () => houses.find((house) => house.id === selectedHouseId) ?? null,
    [houses, selectedHouseId]
  );

  const selectedSourceHouse = useMemo(
    () => resultJson?.selectedSourceHouse ?? recalcJson?.selectedSourceHouse ?? loadJson?.selectedSourceHouse ?? lookupJson?.selectedSourceHouse ?? selectedHouse,
    [loadJson, lookupJson, recalcJson, resultJson, selectedHouse]
  );

  const displayedReadResult = useMemo(
    () => resultJson?.readResult ?? loadJson?.readResult ?? lookupJson?.currentResult ?? null,
    [resultJson, loadJson, lookupJson]
  );

  const runtimeSummary = displayedReadResult?.sharedDiagnostics ?? null;
  const labHome = resultJson?.labHome ?? recalcJson?.labHome ?? saveJson?.labHome ?? loadJson?.labHome ?? lookupJson?.labHome ?? null;
  const labReady = Boolean(loadJson?.labHome);
  const sourceUsageHouse = resultJson?.sourceUsageHouse ?? loadJson?.sourceUsageHouse ?? lookupJson?.sourceUsageHouse ?? null;
  const sourceStageOnePayload =
    (loadJson?.sourcePayload?.mode === "MONTHLY" ? loadJson.sourcePayload : null) ??
    (lookupJson?.sourcePayload?.mode === "MONTHLY" ? lookupJson.sourcePayload : null) ??
    loadJson?.seed?.monthly ??
    lookupJson?.sourceSeed?.monthly ??
    null;
  const sourceStageOneRows = useMemo(
    () => (sourceStageOnePayload ? buildManualMonthlyStageOneRows(sourceStageOnePayload) : []),
    [sourceStageOnePayload]
  );

  const sourceUsageOverride = useMemo(() => {
    if (!selectedSourceHouse) return null;
    return [
      {
        houseId: selectedSourceHouse.id,
        label: selectedSourceHouse.label,
        address: {
          line1: selectedSourceHouse.addressLine1 ?? "",
          city: selectedSourceHouse.addressCity ?? null,
          state: selectedSourceHouse.addressState ?? null,
        },
        esiid: selectedSourceHouse.esiid ?? null,
        dataset: sourceUsageHouse?.dataset ?? null,
        alternatives: sourceUsageHouse?.alternatives ?? { smt: null, greenButton: null },
      },
    ];
  }, [selectedSourceHouse, sourceUsageHouse]);

  const pastSimOverride = useMemo(() => {
    if (!displayedReadResult?.ok || !displayedReadResult?.dataset || !labHome) return null;
    return [
      {
        houseId: labHome.id,
        label: labHome.label,
        address: {
          line1: selectedSourceHouse?.addressLine1 ?? "Manual Monthly Lab Test Home",
          city: selectedSourceHouse?.addressCity ?? null,
          state: selectedSourceHouse?.addressState ?? null,
        },
        esiid: null,
        dataset: displayedReadResult.dataset,
        alternatives: { smt: null, greenButton: null },
      },
    ];
  }, [displayedReadResult, labHome, selectedSourceHouse]);

  async function callRoute(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/admin/tools/manual-monthly", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": adminToken,
      },
      body: JSON.stringify({
        action,
        email: email.trim(),
        houseId: selectedHouseId || undefined,
        ...extra,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      throw new Error(String(json?.message ?? json?.error ?? `HTTP ${res.status}`));
    }
    return json;
  }

  async function runLookup() {
    setBusyAction("lookup");
    setError(null);
    try {
      const json = await callRoute("lookup");
      setLookupJson(json);
      setUserId(json.userId ?? null);
      setSourceUserId(json.sourceUserId ?? null);
      setHouses(Array.isArray(json.houses) ? json.houses : []);
      const nextHouseId =
        String(json.selectedSourceHouse?.id ?? json.selectedHouse?.id ?? "").trim() ||
        String((Array.isArray(json.houses) ? json.houses[0]?.id : "") ?? "").trim();
      setSelectedHouseId(nextHouseId);
      setScenarioId(json.scenarioId ?? null);
      setStatus("Lookup complete. Source house context loaded.");
    } catch (err: any) {
      setError(err?.message ?? "Lookup failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runLoad() {
    setBusyAction("load");
    setError(null);
    try {
      const json = await callRoute("load");
      setLoadJson(json);
      setScenarioId(json.scenarioId ?? null);
      setManualEntryKey((value) => value + 1);
      setStatus("Isolated lab home reset, copied, and prefilled from the selected source home.");
    } catch (err: any) {
      setError(err?.message ?? "Load failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runRecalc() {
    setBusyAction("recalc");
    setError(null);
    try {
      const json = await callRoute("recalc");
      setRecalcJson(json);
      if (json.executionMode === "inline") {
        const refreshed = await callRoute("read_result");
        setResultJson(refreshed);
      }
      setStatus(
        json.executionMode === "droplet_async"
          ? `Recalc dispatched asynchronously${json.jobId ? ` (job ${json.jobId})` : ""}.`
          : "Recalc completed and Stage 2 refreshed."
      );
    } catch (err: any) {
      setError(err?.message ?? "Recalc failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runReadResult() {
    setBusyAction("read_result");
    setError(null);
    try {
      const json = await callRoute("read_result");
      setResultJson(json);
      setStatus("Lab-home Past Sim result refreshed.");
    } catch (err: any) {
      setError(err?.message ?? "Read result failed.");
    } finally {
      setBusyAction(null);
    }
  }

  const manualTransport = useMemo(
    () => ({
      load: async (_houseId: string) => {
        const existing =
          loadJson && String(loadJson?.selectedSourceHouse?.id ?? loadJson?.selectedHouse?.id ?? "") === String(selectedHouseId)
            ? loadJson
            : await callRoute("load");
        setLoadJson(existing);
        setScenarioId(existing.scenarioId ?? null);
        setStatus("Manual payload loaded from the isolated lab home.");
        return {
          ok: true as const,
          houseId: existing.labHome?.id ?? existing.selectedSourceHouse?.id ?? selectedHouseId,
          payload: existing.payload ?? null,
          updatedAt: existing.updatedAt ?? null,
          seed: existing.seed ?? null,
        };
      },
      save: async (args: { houseId: string; payload: ManualUsagePayload }) => {
        try {
          const json = await callRoute("save", { payload: args.payload });
          setSaveJson(json);
          setStatus("Manual payload saved to the isolated lab home.");
          return { ok: true as const, updatedAt: json.updatedAt ?? null };
        } catch (err: any) {
          const message = err?.message ?? "Save failed.";
          setError(message);
          return { ok: false as const, error: message };
        }
      },
    }),
    [adminToken, email, loadJson, selectedHouseId]
  );

  return (
    <div className="min-h-screen bg-brand-navy">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
        <div className="rounded-lg bg-brand-white p-6 shadow-lg">
          <h1 className="text-2xl font-bold text-brand-navy">Manual Monthly Lab</h1>
          <p className="mt-1 text-sm text-brand-navy/70">
            Isolated test-home harness for the real shared manual-monthly runtime. Source house usage is read-only; saves, profile edits,
            recalcs, and result reads stay on the dedicated lab home only.
          </p>
        </div>

        <div className="rounded-lg bg-brand-white p-6 shadow-lg space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Admin token</div>
              <input
                type="password"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
              />
            </label>
            <label className="text-sm lg:col-span-2">
              <div className="mb-1 font-semibold text-brand-navy">User email</div>
              <input
                type="email"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Source house</div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={selectedHouseId}
                onChange={(e) => setSelectedHouseId(e.target.value)}
              >
                <option value="">Select house</option>
                {houses.map((house) => (
                  <option key={house.id} value={house.id}>
                    {house.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void runLookup()}
              disabled={busyAction !== null}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {busyAction === "lookup" ? "Looking up..." : "Lookup"}
            </button>
            <button
              type="button"
              onClick={() => void runLoad()}
              disabled={busyAction !== null || !selectedHouseId}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {busyAction === "load" ? "Preparing lab home..." : "Load into isolated lab home"}
            </button>
            <button
              type="button"
              onClick={() => void runRecalc()}
              disabled={busyAction !== null || !labReady}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {busyAction === "recalc" ? "Recalculating..." : "Recalc"}
            </button>
            <button
              type="button"
              onClick={() => void runReadResult()}
              disabled={busyAction !== null || !labReady}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {busyAction === "read_result" ? "Refreshing..." : "Read result / refresh"}
            </button>
            <button
              type="button"
              onClick={() => setShowHomeDetails(true)}
              disabled={!labReady}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Home details
            </button>
            <button
              type="button"
              onClick={() => setShowAppliances(true)}
              disabled={!labReady}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Appliances
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Source house context</div>
              <div className="mt-2"><span className="font-semibold">Source user ID:</span> {compactSummary(sourceUserId)}</div>
              <div><span className="font-semibold">House:</span> {compactSummary(selectedSourceHouse?.label)}</div>
              <div><span className="font-semibold">ESIID:</span> {compactSummary(selectedSourceHouse?.esiid)}</div>
              <div><span className="font-semibold">Address:</span> {compactSummary(selectedSourceHouse?.addressLine1)}</div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Isolated lab home context</div>
              <div className="mt-2"><span className="font-semibold">Lab owner user ID:</span> {compactSummary(userId)}</div>
              <div><span className="font-semibold">Lab home ID:</span> {compactSummary(labHome?.id)}</div>
              <div><span className="font-semibold">Lab home label:</span> {compactSummary(labHome?.label)}</div>
              <div><span className="font-semibold">Past scenario ID:</span> {compactSummary(scenarioId)}</div>
            </div>
          </div>

          {status ? <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">{status}</div> : null}
          {error ? <div className="rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        </div>

        {sourceUsageOverride ? (
          <div className="rounded-lg bg-brand-white p-6 shadow-lg space-y-4">
            <div>
              <div className="text-lg font-semibold text-brand-navy">Manual Monthly Stage 1</div>
              <p className="text-sm text-slate-600">
                Read-only pre-sim statement totals for the selected source house. This surface intentionally hides daily and interval analytics.
              </p>
            </div>
            {sourceStageOnePayload ? (
              <UsageDashboard
                forcedMode="REAL"
                fetchModeOverride="REAL"
                allowModeToggle={false}
                initialMode="REAL"
                housesOverride={sourceUsageOverride}
                dashboardVariant="USAGE"
                preferredHouseId={selectedSourceHouse?.id ?? null}
                manualUsagePayload={sourceStageOnePayload}
                manualUsageHouseId={selectedSourceHouse?.id ?? null}
                manualMonthlyStageOneRowsOverride={sourceStageOneRows}
                presentationSurface="admin_manual_monthly_stage_one"
              />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                No monthly manual statement totals are available to preview yet. Use Lookup or Load to populate the Stage 1 statement view.
              </div>
            )}
          </div>
        ) : null}

        {labReady ? (
          <div className="rounded-lg bg-brand-white p-6 shadow-lg">
            <div className="mb-4">
              <div className="text-lg font-semibold text-brand-navy">Manual input editor</div>
              <p className="text-sm text-slate-600">
                This editor saves only to the isolated lab home. Source-home manual input is used only as a prefill source.
              </p>
            </div>
            <ManualUsageEntry
              key={`${selectedHouseId}:${manualEntryKey}`}
              houseId={labHome?.id ?? selectedHouseId}
              transport={manualTransport}
              onSaved={async () => {
                setStatus("Manual payload saved to the isolated lab home.");
              }}
            />
          </div>
        ) : null}

        {labHome ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-brand-white p-6 shadow-lg space-y-4">
              <div>
                <div className="text-lg font-semibold text-brand-navy">Manual Monthly Stage 2</div>
                <p className="text-sm text-slate-600">Shared Past Sim results rendered from the dedicated lab home artifact only.</p>
              </div>
              {pastSimOverride ? (
                <UsageDashboard
                  forcedMode="SIMULATED"
                  allowModeToggle={false}
                  initialMode="SIMULATED"
                  simulatedHousesOverride={pastSimOverride}
                  dashboardVariant="PAST_SIMULATED_USAGE"
                />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  Stage 2 Past Sim appears here after the isolated lab home has a readable Past result. Use Recalc, then Read result / refresh if needed.
                </div>
              )}
            </div>
            {displayedReadResult?.manualMonthlyReconciliation ? (
              <div className="rounded-lg bg-brand-white p-6 shadow-lg">
                <div className="text-sm font-semibold text-brand-navy">Statement Range Reconciliation</div>
                <ManualMonthlyReconciliationPanel reconciliation={displayedReadResult.manualMonthlyReconciliation} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-lg bg-brand-white p-6 shadow-lg space-y-4">
          <div className="text-lg font-semibold text-brand-navy">Manual Monthly Flow Diagnostics</div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionJson
              title="Source vs lab-home target context"
              open
              value={{
                email,
                sourceUserId,
                labOwnerUserId: userId,
                selectedSourceHouse,
                labHome,
                scenarioId,
              }}
            />

            <SectionJson
              title="Prefill and saved manual payload"
              open
              value={{
                sourcePayload: loadJson?.sourcePayload ?? null,
                activePayload: saveJson?.payload ?? loadJson?.payload ?? lookupJson?.payload ?? null,
                seed: loadJson?.seed ?? null,
              }}
            />

            <SectionJson
              title="Source and lab profile inputs"
              value={{
                sourceHomeProfile: loadJson?.sourceHomeProfile ?? lookupJson?.sourceHomeProfile ?? null,
                sourceApplianceProfile: loadJson?.sourceApplianceProfile ?? lookupJson?.sourceApplianceProfile ?? null,
                labHomeProfile: loadJson?.labHomeProfile ?? null,
                labApplianceProfile: loadJson?.labApplianceProfile ?? null,
              }}
            />

            <SectionJson
              title="Shared runtime metadata summary"
              value={{
                sharedProducerPathUsed: runtimeSummary?.lockboxExecutionSummary?.sharedProducerPathUsed ?? null,
                manualMonthlyInputState: runtimeSummary?.sourceTruthContext?.manualMonthlyInputState ?? null,
                monthlyTargetConstructionDiagnostics: runtimeSummary?.sourceTruthContext?.monthlyTargetConstructionDiagnostics ?? null,
                filledMonths: displayedReadResult?.dataset?.meta?.filledMonths ?? null,
                travelRangesUsed: runtimeSummary?.sourceTruthContext?.travelRangesUsed ?? null,
                excludedDateKeysCount: runtimeSummary?.sourceTruthContext?.exclusionDrivingCanonicalInputsSummary?.excludedDateKeysCount ?? null,
                intervalUsageFingerprintIdentity: runtimeSummary?.sourceTruthContext?.intervalUsageFingerprintIdentity ?? null,
                usageShapeProfileIdentity: displayedReadResult?.dataset?.meta?.usageShapeProfileIdentity ?? null,
              }}
            />

            <SectionJson
              title="Lockbox / shared-producer summary"
              value={{
                identityContext: runtimeSummary?.identityContext ?? null,
                lockboxExecutionSummary: runtimeSummary?.lockboxExecutionSummary ?? null,
                projectionReadSummary: runtimeSummary?.projectionReadSummary ?? null,
                tuningSummary: runtimeSummary?.tuningSummary ?? null,
              }}
            />

            <SectionJson
              title="Calculation-order / fill-order visibility"
              value={{
                filledMonths: displayedReadResult?.dataset?.meta?.filledMonths ?? null,
                monthlyTargetConstructionDiagnostics: displayedReadResult?.dataset?.meta?.monthlyTargetConstructionDiagnostics ?? null,
                manualMonthlyInputState: displayedReadResult?.dataset?.meta?.manualMonthlyInputState ?? null,
                seedSourceMode: loadJson?.seed?.sourceMode ?? null,
              }}
            />

            <SectionJson title="Statement-range reconciliation summary" value={displayedReadResult?.manualMonthlyReconciliation ?? null} />
            <SectionJson title="Source usage dataset" value={sourceUsageHouse} />
            <SectionJson title="Recalc response" value={recalcJson} />
            <SectionJson title="Simulated-house response" value={displayedReadResult} />
            <SectionJson
              title="Error / status panel"
              value={{
                status,
                error,
                busyAction,
                lookupJson,
                loadJson,
                saveJson,
                recalcJson,
                resultJson,
              }}
            />
          </div>
        </div>
      </div>

      {showHomeDetails && labReady ? (
        <ModalShell title="Lab-home Home Details" onClose={() => setShowHomeDetails(false)}>
          <HomeDetailsClient
            houseId={labHome?.id ?? ""}
            awardEntries={false}
            loadUrl="/api/admin/tools/manual-monthly/test-home/home-profile"
            saveUrl="/api/admin/tools/manual-monthly/test-home/home-profile"
            prefillUrl="/api/admin/tools/manual-monthly/test-home/home-profile/prefill"
            onSaved={() => {
              setStatus("Lab-home home details saved.");
            }}
          />
        </ModalShell>
      ) : null}

      {showAppliances && labReady ? (
        <ModalShell title="Lab-home Appliances" onClose={() => setShowAppliances(false)}>
          <AppliancesClient
            houseId={labHome?.id ?? ""}
            awardEntries={false}
            loadUrl="/api/admin/tools/manual-monthly/test-home/appliances"
            saveUrl="/api/admin/tools/manual-monthly/test-home/appliances"
            onSaved={() => {
              setStatus("Lab-home appliances saved.");
            }}
          />
        </ModalShell>
      ) : null}
    </div>
  );
}
