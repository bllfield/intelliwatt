"use client";

import { useEffect, useMemo, useState } from "react";
import { ManualUsageEntry } from "@/components/manual/ManualUsageEntry";
import { HomeDetailsClient } from "@/components/home/HomeDetailsClient";
import { AppliancesClient } from "@/components/appliances/AppliancesClient";
import UsageDashboard from "@/components/usage/UsageDashboard";
import { computeRequirements } from "@/modules/usageSimulator/requirements";
import { loadSimulatorStateClient } from "@/modules/usageSimulator/state";

type Mode = "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";
type CompareView = "SIMULATED" | "ACTUAL";

type UsageApiResp =
  | { ok: true; houses: Array<{ houseId: string; dataset: any | null }> }
  | { ok: false; error: string };

export function UsageSimulatorClient({ houseId }: { houseId: string }) {
  const [mode, setMode] = useState<Mode>("MANUAL_TOTALS");
  const [compareView, setCompareView] = useState<CompareView>("SIMULATED");
  const [hasSmtIntervals, setHasSmtIntervals] = useState<boolean>(false);
  const [loadingActual, setLoadingActual] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [recalcNote, setRecalcNote] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [canRecalc, setCanRecalc] = useState(false);
  const [missingItems, setMissingItems] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingActual(true);
      try {
        const r = await fetch("/api/user/usage", { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as UsageApiResp | null;
        if (cancelled) return;
        if (!r.ok || !j?.ok) {
          setHasSmtIntervals(false);
          return;
        }
        const row = (j.houses || []).find((h) => h.houseId === houseId) ?? null;
        const ds = row?.dataset ?? null;
        const source = String(ds?.summary?.source ?? "");
        const intervalsCount = Number(ds?.summary?.intervalsCount ?? 0);
        const intervals15Len = Array.isArray(ds?.series?.intervals15) ? ds.series.intervals15.length : 0;
        // V1 rule: SMT 15-minute interval presence is required to enable “Start from Actual”.
        setHasSmtIntervals(source === "SMT" && intervalsCount > 0 && intervals15Len > 0);
      } catch {
        if (!cancelled) setHasSmtIntervals(false);
      } finally {
        if (!cancelled) setLoadingActual(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await loadSimulatorStateClient(houseId);
        if (cancelled) return;
        const req = computeRequirements(
          {
            manualUsagePayload: state.manualUsagePayload as any,
            homeProfile: state.homeProfile as any,
            applianceProfile: state.applianceProfile as any,
            hasSmtIntervals,
          },
          mode as any,
        );
        setCanRecalc(req.canRecalc);
        setMissingItems(req.missingItems);
      } catch {
        if (!cancelled) {
          setCanRecalc(false);
          setMissingItems(["Unable to load simulator inputs. Try refreshing."]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, mode, hasSmtIntervals, refreshToken]);

  const startFromActualDisabledReason = useMemo(() => {
    if (loadingActual) return "Checking SMT baseline availability…";
    if (hasSmtIntervals) return null;
    return "Requires Smart Meter Texas 15‑minute intervals for this home.";
  }, [hasSmtIntervals, loadingActual]);

  async function recalc() {
    setRecalcBusy(true);
    setRecalcNote(null);
    try {
      const r = await fetch("/api/user/simulator/recalc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId, mode }),
      });
      const j = (await r.json().catch(() => null)) as any;
      if (!r.ok || !j?.ok) {
        if (j?.missingItems && Array.isArray(j.missingItems)) {
          setMissingItems(j.missingItems.map(String));
        }
        setRecalcNote(j?.error ? String(j.error) : `Recalc failed (${r.status})`);
        return;
      }
      setRecalcNote("Recalculated. Scroll down to see updated simulated charts.");
      setRefreshToken((x) => x + 1);
    } catch (e: any) {
      setRecalcNote(e?.message ?? String(e));
    } finally {
      setRecalcBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div id="start-here" className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-6 text-brand-cyan shadow-[0_18px_40px_rgba(10,20,60,0.35)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Start here</div>
            <h2 className="mt-2 text-2xl font-semibold text-brand-white">Usage Simulator</h2>
            <p className="mt-2 text-sm text-brand-cyan/75">
              Choose a data source, save inputs below, then recalculate to build a 12‑month simulated curve.
            </p>
          </div>

          {hasSmtIntervals ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCompareView("SIMULATED")}
                className={[
                  "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
                  compareView === "SIMULATED"
                    ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
                    : "border-brand-cyan/20 bg-brand-white/5 text-brand-cyan/70 hover:bg-brand-white/10",
                ].join(" ")}
              >
                Simulated
              </button>
              <button
                type="button"
                onClick={() => setCompareView("ACTUAL")}
                className={[
                  "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
                  compareView === "ACTUAL"
                    ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
                    : "border-brand-cyan/20 bg-brand-white/5 text-brand-cyan/70 hover:bg-brand-white/10",
                ].join(" ")}
              >
                Actual
              </button>
            </div>
          ) : (
            <div className="text-xs text-brand-cyan/60">Actual compare requires SMT intervals.</div>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <button
            type="button"
            onClick={() => setMode("MANUAL_TOTALS")}
            className={[
              "rounded-2xl border p-4 text-left transition",
              mode === "MANUAL_TOTALS"
                ? "border-brand-cyan/40 bg-brand-white/10"
                : "border-brand-cyan/20 bg-brand-white/5 hover:bg-brand-white/10",
            ].join(" ")}
          >
            <div className="text-sm font-semibold text-brand-white">Enter usage totals</div>
            <div className="mt-1 text-xs text-brand-cyan/70">Use monthly or annual totals you enter manually.</div>
          </button>

          <button
            type="button"
            onClick={() => setMode("NEW_BUILD_ESTIMATE")}
            className={[
              "rounded-2xl border p-4 text-left transition",
              mode === "NEW_BUILD_ESTIMATE"
                ? "border-brand-cyan/40 bg-brand-white/10"
                : "border-brand-cyan/20 bg-brand-white/5 hover:bg-brand-white/10",
            ].join(" ")}
          >
            <div className="text-sm font-semibold text-brand-white">New build / no history</div>
            <div className="mt-1 text-xs text-brand-cyan/70">Estimate totals from home + appliances + occupancy.</div>
          </button>

          <button
            type="button"
            onClick={() => setMode("SMT_BASELINE")}
            disabled={!hasSmtIntervals}
            title={startFromActualDisabledReason ?? undefined}
            className={[
              "rounded-2xl border p-4 text-left transition",
              !hasSmtIntervals ? "cursor-not-allowed opacity-60" : "",
              mode === "SMT_BASELINE"
                ? "border-brand-cyan/40 bg-brand-white/10"
                : "border-brand-cyan/20 bg-brand-white/5 hover:bg-brand-white/10",
            ].join(" ")}
          >
            <div className="text-sm font-semibold text-brand-white">Start from Actual (SMT)</div>
            <div className="mt-1 text-xs text-brand-cyan/70">
              Use SMT 15‑minute intervals as the baseline shape and fill to a full 12 months.
            </div>
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void recalc()}
            disabled={recalcBusy || !canRecalc}
            className="rounded-full border border-brand-blue/40 bg-brand-blue/10 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
          >
            {recalcBusy ? "Recalculating…" : "Recalculate Simulated Curve"}
          </button>
          {recalcNote ? <div className="text-xs text-brand-cyan/80">{recalcNote}</div> : null}
        </div>
        {!canRecalc && missingItems.length ? (
          <div className="mt-3 rounded-2xl border border-brand-cyan/20 bg-brand-white/5 px-4 py-3 text-xs text-brand-cyan/80">
            <div className="font-semibold text-brand-white/90">To recalculate:</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {missingItems.map((m, idx) => (
                <li key={`${idx}-${m}`}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div id="manual-totals" className="rounded-3xl border border-brand-blue/15 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Manual totals</div>
          <div className="mt-2 text-lg font-semibold text-brand-navy">Usage entry</div>
          <div className="mt-4">
            <ManualUsageEntry houseId={houseId} />
          </div>
        </div>

        <div id="home-details" className="rounded-3xl border border-brand-blue/15 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Home details</div>
          <div className="mt-2 text-lg font-semibold text-brand-navy">Home profile</div>
          <div className="mt-4">
            <HomeDetailsClient houseId={houseId} />
          </div>
        </div>
      </div>

      <div id="appliances" className="rounded-3xl border border-brand-blue/15 bg-white p-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Appliances</div>
        <div className="mt-2 text-lg font-semibold text-brand-navy">Appliance profile</div>
        <div className="mt-4">
          <AppliancesClient houseId={houseId} />
        </div>
      </div>

      <div id="preview">
        <UsageDashboard
          forcedMode={compareView === "ACTUAL" ? "REAL" : "SIMULATED"}
          allowModeToggle={false}
          initialMode="SIMULATED"
          refreshToken={refreshToken}
        />
      </div>
    </div>
  );
}

