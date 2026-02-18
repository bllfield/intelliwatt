"use client";

import { useEffect, useMemo, useState } from "react";
import { ManualUsageEntry } from "@/components/manual/ManualUsageEntry";
import { HomeDetailsClient } from "@/components/home/HomeDetailsClient";
import { AppliancesClient } from "@/components/appliances/AppliancesClient";
import UsageDashboard from "@/components/usage/UsageDashboard";

type Mode = "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";
type CompareView = "SIMULATED" | "ACTUAL";

type UsageApiResp =
  | { ok: true; houses: Array<{ houseId: string; dataset: any | null }> }
  | { ok: false; error: string };

type ScenariosResp = { ok: true; scenarios: Array<{ id: string; name: string }> } | { ok: false; error: string };
type BuildsResp =
  | {
      ok: true;
      houseId: string;
      builds: Array<{
        scenarioKey: string;
        scenarioId: string | null;
        scenarioName: string;
        mode: string;
        baseKind: string;
        buildInputsHash: string;
        lastBuiltAt: string | null;
        canonicalEndMonth: string;
      }>;
    }
  | { ok: false; error: string };

type ScenarioHouseResp =
  | { ok: true; houseId: string; scenarioKey: string; scenarioId: string | null; dataset: any }
  | { ok: false; code: string; message: string };

type RequirementsResp =
  | { ok: true; canRecalc: boolean; missingItems: string[]; hasSmtIntervals: boolean; canonicalEndMonth: string }
  | { ok: false; error: string };

function Modal(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl rounded-3xl border border-brand-blue/15 bg-white shadow-2xl">
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

  const [scenarioId, setScenarioId] = useState<string>("baseline");
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([]);
  const [newScenarioName, setNewScenarioName] = useState("");
  const [builds, setBuilds] = useState<BuildsResp extends { ok: true } ? BuildsResp["builds"] : any[]>([]);
  const [scenarioSimHouseOverride, setScenarioSimHouseOverride] = useState<any[] | null>(null);
  const [scenarioBanner, setScenarioBanner] = useState<string | null>(null);

  const [openManual, setOpenManual] = useState(false);
  const [openHome, setOpenHome] = useState(false);
  const [openAppliances, setOpenAppliances] = useState(false);
  const [openTimeline, setOpenTimeline] = useState(false);

  // Scenario events editor state (minimal)
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineMonth, setTimelineMonth] = useState<string>("");
  const [timelineMultiplier, setTimelineMultiplier] = useState<string>("");
  const [timelineAdderKwh, setTimelineAdderKwh] = useState<string>("");

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
        const r = await fetch(`/api/user/simulator/scenarios?houseId=${encodeURIComponent(houseId)}`, { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as ScenariosResp | null;
        if (cancelled) return;
        if (!r.ok || !j?.ok) {
          setScenarios([]);
          return;
        }
        setScenarios(j.scenarios || []);
      } catch {
        if (!cancelled) setScenarios([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/user/simulator/requirements?houseId=${encodeURIComponent(houseId)}&mode=${encodeURIComponent(mode)}`, {
          cache: "no-store",
        });
        const j = (await r.json().catch(() => null)) as RequirementsResp | null;
        if (cancelled) return;
        if (!r.ok || !j?.ok) {
          setCanRecalc(false);
          setMissingItems(["Unable to load requirements. Try refreshing."]);
          return;
        }
        setCanRecalc(Boolean(j.canRecalc));
        setMissingItems(Array.isArray(j.missingItems) ? j.missingItems.map(String) : []);
      } catch {
        if (!cancelled) {
          setCanRecalc(false);
          setMissingItems(["Unable to load requirements. Try refreshing."]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, mode, refreshToken]);

  const startFromActualDisabledReason = useMemo(() => {
    if (loadingActual) return "Checking SMT baseline availability…";
    if (hasSmtIntervals) return null;
    return "Requires Smart Meter Texas 15‑minute intervals for this home.";
  }, [hasSmtIntervals, loadingActual]);

  const selectedBuild = useMemo(() => {
    if (!Array.isArray(builds)) return null;
    if (scenarioId === "baseline") return builds.find((b) => String(b?.scenarioKey ?? "") === "BASELINE") ?? null;
    return builds.find((b) => String(b?.scenarioId ?? "") === scenarioId) ?? null;
  }, [builds, scenarioId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/user/usage/simulated/builds?houseId=${encodeURIComponent(houseId)}`, { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as BuildsResp | null;
        if (cancelled) return;
        if (!r.ok || !j?.ok) {
          setBuilds([]);
          return;
        }
        setBuilds(j.builds || []);
      } catch {
        if (!cancelled) setBuilds([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setScenarioBanner(null);
      setScenarioSimHouseOverride(null);
      if (!scenarioId || scenarioId === "baseline") return;
      try {
        const r = await fetch(
          `/api/user/usage/simulated/house?houseId=${encodeURIComponent(houseId)}&scenarioId=${encodeURIComponent(scenarioId)}`,
          { cache: "no-store" },
        );
        const j = (await r.json().catch(() => null)) as ScenarioHouseResp | null;
        if (cancelled) return;
        if (!r.ok || !j?.ok) {
          const msg = j?.message ? String(j.message) : "Recalculate to generate this scenario.";
          setScenarioBanner(msg);
          setScenarioSimHouseOverride(null);
          return;
        }
        setScenarioBanner(null);
        setScenarioSimHouseOverride([
          {
            houseId,
            label: "Scenario",
            address: { line1: "", city: null, state: null },
            esiid: null,
            dataset: j.dataset,
            alternatives: { smt: null, greenButton: null },
          },
        ]);
      } catch {
        if (!cancelled) {
          setScenarioBanner("Unable to load scenario dataset. Try recalculating.");
          setScenarioSimHouseOverride(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, scenarioId, refreshToken]);

  async function createNewScenario() {
    const name = newScenarioName.trim();
    if (!name) return;
    try {
      const r = await fetch("/api/user/simulator/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId, name }),
      });
      const j = (await r.json().catch(() => null)) as any;
      if (!r.ok || !j?.ok) {
        setRecalcNote(j?.error ? String(j.error) : "Failed to create scenario");
        return;
      }
      setNewScenarioName("");
      setScenarioId(String(j.scenario?.id ?? "baseline"));
      setRefreshToken((x) => x + 1);
    } catch (e: any) {
      setRecalcNote(e?.message ?? String(e));
    }
  }

  async function loadTimeline() {
    if (!scenarioId || scenarioId === "baseline") {
      setTimelineEvents([]);
      return;
    }
    const r = await fetch(`/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events?houseId=${encodeURIComponent(houseId)}`, {
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as any;
    if (!r.ok || !j?.ok) {
      setTimelineEvents([]);
      return;
    }
    setTimelineEvents(Array.isArray(j.events) ? j.events : []);
  }

  async function addTimelineEvent() {
    if (!scenarioId || scenarioId === "baseline") return;
    const effectiveMonth = timelineMonth;
    const multiplier = timelineMultiplier.trim() ? Number(timelineMultiplier) : undefined;
    const adderKwh = timelineAdderKwh.trim() ? Number(timelineAdderKwh) : undefined;
    const r = await fetch(`/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ houseId, effectiveMonth, multiplier, adderKwh, kind: "MONTHLY_ADJUSTMENT" }),
    });
    const j = (await r.json().catch(() => null)) as any;
    if (r.ok && j?.ok) {
      setTimelineMonth("");
      setTimelineMultiplier("");
      setTimelineAdderKwh("");
      await loadTimeline();
    }
  }

  async function saveTimelineEvent(eventId: string, patch: any) {
    if (!scenarioId || scenarioId === "baseline") return;
    const r = await fetch(`/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ houseId, ...patch }),
    });
    const j = (await r.json().catch(() => null)) as any;
    if (r.ok && j?.ok) await loadTimeline();
  }

  async function deleteTimelineEvent(eventId: string) {
    if (!scenarioId || scenarioId === "baseline") return;
    const r = await fetch(
      `/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events/${encodeURIComponent(eventId)}?houseId=${encodeURIComponent(houseId)}`,
      { method: "DELETE" },
    );
    const j = (await r.json().catch(() => null)) as any;
    if (r.ok && j?.ok) await loadTimeline();
  }

  async function recalc() {
    setRecalcBusy(true);
    setRecalcNote(null);
    try {
      const r = await fetch("/api/user/simulator/recalc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId, mode, scenarioId: scenarioId === "baseline" ? null : scenarioId }),
      });
      const j = (await r.json().catch(() => null)) as any;
      if (!r.ok || !j?.ok) {
        if (j?.missingItems && Array.isArray(j.missingItems)) {
          setMissingItems(j.missingItems.map(String));
        }
        setRecalcNote(j?.error ? String(j.error) : `Recalc failed (${r.status})`);
        return;
      }
      setRecalcNote("Recalculated.");
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

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Scenario</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={scenarioId}
                onChange={(e) => setScenarioId(e.target.value)}
                className="rounded-xl border border-brand-cyan/20 bg-brand-white/5 px-3 py-2 text-xs text-brand-white"
              >
                <option value="baseline">Baseline</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                value={newScenarioName}
                onChange={(e) => setNewScenarioName(e.target.value)}
                placeholder="New scenario name"
                className="w-48 rounded-xl border border-brand-cyan/20 bg-brand-white/5 px-3 py-2 text-xs text-brand-white placeholder:text-brand-cyan/50"
              />
              <button
                type="button"
                onClick={() => void createNewScenario()}
                className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenTimeline(true);
                  void loadTimeline();
                }}
                disabled={scenarioId === "baseline"}
                className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10 disabled:opacity-60"
              >
                Edit timeline
              </button>
            </div>
            {scenarioBanner ? <div className="mt-2 text-xs text-brand-cyan/80">{scenarioBanner}</div> : null}
            {selectedBuild ? (
              <div className="mt-2 text-xs text-brand-cyan/70">
                Generated: {selectedBuild.lastBuiltAt ? new Date(selectedBuild.lastBuiltAt).toLocaleString() : "unknown"} · hash{" "}
                {String(selectedBuild.buildInputsHash || "").slice(0, 10)}
              </div>
            ) : (
              <div className="mt-2 text-xs text-brand-cyan/70">Not generated yet. Click Recalculate.</div>
            )}
          </div>

          <div className="md:col-span-1">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Edit inputs</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOpenManual(true)}
                className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10"
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => setOpenHome(true)}
                className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10"
              >
                Home
              </button>
              <button
                type="button"
                onClick={() => setOpenAppliances(true)}
                className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10"
              >
                Appliances
              </button>
            </div>
          </div>
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

      <div id="preview">
        <UsageDashboard
          forcedMode={compareView === "ACTUAL" ? "REAL" : "SIMULATED"}
          allowModeToggle={false}
          initialMode="SIMULATED"
          refreshToken={refreshToken}
          simulatedHousesOverride={compareView === "SIMULATED" ? scenarioSimHouseOverride : null}
        />
      </div>

      <Modal
        open={openManual}
        title="Manual usage totals"
        onClose={() => {
          setOpenManual(false);
          setRecalcNote("Saved inputs. Click Recalculate to update charts.");
          setRefreshToken((x) => x + 1);
        }}
      >
        <ManualUsageEntry houseId={houseId} />
      </Modal>

      <Modal
        open={openHome}
        title="Home details"
        onClose={() => {
          setOpenHome(false);
          setRecalcNote("Saved inputs. Click Recalculate to update charts.");
          setRefreshToken((x) => x + 1);
        }}
      >
        <HomeDetailsClient houseId={houseId} />
      </Modal>

      <Modal
        open={openAppliances}
        title="Appliances"
        onClose={() => {
          setOpenAppliances(false);
          setRecalcNote("Saved inputs. Click Recalculate to update charts.");
          setRefreshToken((x) => x + 1);
        }}
      >
        <AppliancesClient houseId={houseId} />
      </Modal>

      <Modal
        open={openTimeline}
        title="Scenario timeline"
        onClose={() => {
          setOpenTimeline(false);
          setRecalcNote("Saved timeline. Click Recalculate to generate/update this scenario build.");
        }}
      >
        {scenarioId === "baseline" ? (
          <div className="text-sm text-brand-navy/70">Select or create a scenario to edit its timeline.</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-brand-blue/10 bg-brand-blue/5 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Add event (month)</div>
              <div className="mt-3 grid gap-2 md:grid-cols-4">
                <input
                  type="month"
                  value={timelineMonth}
                  onChange={(e) => setTimelineMonth(e.target.value)}
                  className="rounded-xl border border-brand-blue/20 bg-white px-3 py-2 text-xs text-brand-navy"
                />
                <input
                  value={timelineMultiplier}
                  onChange={(e) => setTimelineMultiplier(e.target.value)}
                  placeholder="Multiplier (e.g. 1.10)"
                  className="rounded-xl border border-brand-blue/20 bg-white px-3 py-2 text-xs text-brand-navy"
                />
                <input
                  value={timelineAdderKwh}
                  onChange={(e) => setTimelineAdderKwh(e.target.value)}
                  placeholder="Adder kWh (e.g. 50)"
                  className="rounded-xl border border-brand-blue/20 bg-white px-3 py-2 text-xs text-brand-navy"
                />
                <button
                  type="button"
                  onClick={() => void addTimelineEvent()}
                  className="rounded-xl border border-brand-blue/30 bg-white px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-brand-blue/10 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Events</div>
              <div className="mt-3 space-y-2">
                {timelineEvents.length ? null : <div className="text-sm text-brand-navy/70">No events yet.</div>}
                {timelineEvents.map((e) => {
                  const p = (e as any)?.payloadJson ?? {};
                  const mult = typeof p?.multiplier === "number" ? String(p.multiplier) : "";
                  const add = typeof p?.adderKwh === "number" ? String(p.adderKwh) : "";
                  return (
                    <div key={String(e.id)} className="grid gap-2 rounded-xl border border-brand-blue/10 bg-brand-blue/5 p-3 md:grid-cols-5">
                      <input
                        type="month"
                        defaultValue={String(e.effectiveMonth ?? "")}
                        onBlur={(ev) => void saveTimelineEvent(String(e.id), { effectiveMonth: ev.target.value })}
                        className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                      />
                      <input
                        defaultValue={mult}
                        onBlur={(ev) => void saveTimelineEvent(String(e.id), { payloadJson: { multiplier: Number(ev.target.value || 0) || undefined, adderKwh: p?.adderKwh } })}
                        className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                      />
                      <input
                        defaultValue={add}
                        onBlur={(ev) => void saveTimelineEvent(String(e.id), { payloadJson: { multiplier: p?.multiplier, adderKwh: Number(ev.target.value || 0) || undefined } })}
                        className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                      />
                      <div className="text-xs text-brand-navy/60 md:col-span-1">{String(e.kind ?? "")}</div>
                      <button
                        type="button"
                        onClick={() => void deleteTimelineEvent(String(e.id))}
                        className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

