"use client";

import { useMemo, useState } from "react";
import { ManualUsageEntry } from "@/components/manual/ManualUsageEntry";
import UsageDashboard from "@/components/usage/UsageDashboard";
import { ManualMonthlyReconciliationPanel } from "@/components/usage/ManualMonthlyReconciliationPanel";
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

export default function ManualMonthlyLab() {
  const [adminToken, setAdminToken] = useState("");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
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

  const selectedHouse = useMemo(
    () => houses.find((house) => house.id === selectedHouseId) ?? null,
    [houses, selectedHouseId]
  );

  const displayedReadResult = useMemo(
    () => resultJson?.readResult ?? loadJson?.readResult ?? lookupJson?.currentResult ?? null,
    [resultJson, loadJson, lookupJson]
  );

  const simulatedHouseOverride = useMemo(() => {
    if (!displayedReadResult?.ok || !displayedReadResult?.dataset || !selectedHouse) return null;
    return [
      {
        houseId: selectedHouse.id,
        label: selectedHouse.label,
        address: {
          line1: selectedHouse.addressLine1 ?? "",
          city: selectedHouse.addressCity ?? null,
          state: selectedHouse.addressState ?? null,
        },
        esiid: selectedHouse.esiid ?? null,
        dataset: displayedReadResult.dataset,
        alternatives: { smt: null, greenButton: null },
      },
    ];
  }, [displayedReadResult, selectedHouse]);

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
      setHouses(Array.isArray(json.houses) ? json.houses : []);
      const nextHouseId =
        String(json.selectedHouse?.id ?? "").trim() ||
        String((Array.isArray(json.houses) ? json.houses[0]?.id : "") ?? "").trim();
      setSelectedHouseId(nextHouseId);
      setScenarioId(json.scenarioId ?? null);
      setStatus("Lookup complete.");
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
      setStatus("Manual payload and current result loaded.");
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
      setStatus(
        json.executionMode === "droplet_async"
          ? `Recalc dispatched asynchronously${json.jobId ? ` (job ${json.jobId})` : ""}.`
          : "Recalc completed."
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
      setStatus("Simulated-house result refreshed.");
    } catch (err: any) {
      setError(err?.message ?? "Read result failed.");
    } finally {
      setBusyAction(null);
    }
  }

  const manualTransport = useMemo(
    () => ({
      load: async (_houseId: string) => {
        const json = await callRoute("load");
        setLoadJson(json);
        setScenarioId(json.scenarioId ?? null);
        setStatus("Manual payload loaded.");
        return {
          ok: true as const,
          houseId: json.selectedHouse?.id ?? selectedHouseId,
          payload: json.payload ?? null,
          updatedAt: json.updatedAt ?? null,
        };
      },
      save: async (args: { houseId: string; payload: ManualUsagePayload }) => {
        try {
          const json = await callRoute("save", { payload: args.payload });
          setSaveJson(json);
          setStatus("Manual payload saved.");
          return { ok: true as const, updatedAt: json.updatedAt ?? null };
        } catch (err: any) {
          const message = err?.message ?? "Save failed.";
          setError(message);
          return { ok: false as const, error: message };
        }
      },
    }),
    [adminToken, email, selectedHouseId]
  );

  const runtimeSummary = displayedReadResult?.sharedDiagnostics ?? null;

  return (
    <div className="min-h-screen bg-brand-navy">
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <div className="rounded-lg bg-brand-white p-6 shadow-lg">
          <h1 className="text-2xl font-bold text-brand-navy">Manual Monthly Lab</h1>
          <p className="mt-1 text-sm text-brand-navy/70">
            Browser-based test harness for the real customer manual-monthly flow, with customer-style Past output and shared diagnostics.
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
              <div className="mb-1 font-semibold text-brand-navy">House</div>
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
              {busyAction === "load" ? "Loading..." : "Load"}
            </button>
            <button
              type="button"
              onClick={() => void runRecalc()}
              disabled={busyAction !== null || !selectedHouseId}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {busyAction === "recalc" ? "Recalculating..." : "Recalc"}
            </button>
            <button
              type="button"
              onClick={() => void runReadResult()}
              disabled={busyAction !== null || !selectedHouseId}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {busyAction === "read_result" ? "Refreshing..." : "Read result / refresh"}
            </button>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div><span className="font-semibold">Email:</span> {compactSummary(email)}</div>
            <div><span className="font-semibold">User ID:</span> {compactSummary(userId)}</div>
            <div><span className="font-semibold">House:</span> {compactSummary(selectedHouse?.label)}</div>
            <div><span className="font-semibold">Past scenario ID:</span> {compactSummary(scenarioId)}</div>
          </div>

          {status ? <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">{status}</div> : null}
          {error ? <div className="rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        </div>

        {selectedHouseId ? (
          <div className="rounded-lg bg-brand-white p-6 shadow-lg">
            <ManualUsageEntry
              key={`${selectedHouseId}:${manualEntryKey}`}
              houseId={selectedHouseId}
              transport={manualTransport}
              onSaved={async () => {
                await runLoad();
              }}
            />
          </div>
        ) : null}

        {simulatedHouseOverride ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-brand-white p-6 shadow-lg">
              <UsageDashboard
                forcedMode="SIMULATED"
                allowModeToggle={false}
                initialMode="SIMULATED"
                simulatedHousesOverride={simulatedHouseOverride}
                dashboardVariant="PAST_SIMULATED_USAGE"
              />
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
            <details className="rounded border border-slate-200 p-3" open>
              <summary className="cursor-pointer font-semibold text-brand-navy">Lookup / target context</summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson({
                email,
                userId,
                selectedHouse,
                scenarioId,
              })}</pre>
            </details>

            <details className="rounded border border-slate-200 p-3" open>
              <summary className="cursor-pointer font-semibold text-brand-navy">Shared runtime metadata summary</summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson({
                sharedProducerPathUsed: runtimeSummary?.lockboxExecutionSummary?.sharedProducerPathUsed ?? null,
                manualMonthlyInputState: runtimeSummary?.sourceTruthContext?.manualMonthlyInputState ?? null,
                monthlyTargetConstructionDiagnostics: runtimeSummary?.sourceTruthContext?.monthlyTargetConstructionDiagnostics ?? null,
                filledMonths: displayedReadResult?.dataset?.meta?.filledMonths ?? null,
                travelRangesUsed: runtimeSummary?.sourceTruthContext?.travelRangesUsed ?? null,
                excludedDateKeysCount: runtimeSummary?.sourceTruthContext?.exclusionDrivingCanonicalInputsSummary?.excludedDateKeysCount ?? null,
                intervalUsageFingerprintIdentity: runtimeSummary?.sourceTruthContext?.intervalUsageFingerprintIdentity ?? null,
                usageShapeProfileIdentity: displayedReadResult?.dataset?.meta?.usageShapeProfileIdentity ?? null,
              })}</pre>
            </details>

            <details className="rounded border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold text-brand-navy">Saved manual payload</summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson(loadJson?.payload ?? lookupJson?.payload ?? saveJson?.payload ?? null)}</pre>
            </details>

            <details className="rounded border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold text-brand-navy">Lockbox / shared-producer summary</summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson({
                identityContext: runtimeSummary?.identityContext ?? null,
                lockboxExecutionSummary: runtimeSummary?.lockboxExecutionSummary ?? null,
                projectionReadSummary: runtimeSummary?.projectionReadSummary ?? null,
              })}</pre>
            </details>

            <details className="rounded border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold text-brand-navy">Statement-range reconciliation summary</summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson(displayedReadResult?.manualMonthlyReconciliation ?? null)}</pre>
            </details>

            <details className="rounded border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold text-brand-navy">Calculation-order / fill-order visibility</summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson({
                filledMonths: displayedReadResult?.dataset?.meta?.filledMonths ?? null,
                monthlyTargetConstructionDiagnostics: displayedReadResult?.dataset?.meta?.monthlyTargetConstructionDiagnostics ?? null,
                manualMonthlyInputState: displayedReadResult?.dataset?.meta?.manualMonthlyInputState ?? null,
              })}</pre>
            </details>

            <details className="rounded border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold text-brand-navy">Recalc response</summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson(recalcJson)}</pre>
            </details>

            <details className="rounded border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold text-brand-navy">Simulated-house response</summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson(displayedReadResult)}</pre>
            </details>

            <details className="rounded border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold text-brand-navy">Error / status panel</summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-700">{prettyJson({
                status,
                error,
                busyAction,
                lookupJson,
                loadJson,
                saveJson,
                recalcJson,
                resultJson,
              })}</pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
