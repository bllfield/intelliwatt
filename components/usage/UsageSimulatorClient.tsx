"use client";

import { useEffect, useMemo, useState } from "react";
import { ManualUsageEntry } from "@/components/manual/ManualUsageEntry";
import { HomeDetailsClient } from "@/components/home/HomeDetailsClient";
import { AppliancesClient } from "@/components/appliances/AppliancesClient";
import UsageDashboard from "@/components/usage/UsageDashboard";
import {
  USAGE_SCENARIO_ADJUSTMENT_CATALOG,
  toMonthlyAdjustmentPayload,
  type AdjustmentType,
} from "@/lib/usageScenario/catalog";

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
  | {
      ok: true;
      canRecalc: boolean;
      missingItems: string[];
      hasActualIntervals: boolean;
      actualSource: "SMT" | "GREEN_BUTTON" | null;
      canonicalEndMonth: string;
    }
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

export function UsageSimulatorClient({ houseId, intent }: { houseId: string; intent?: string }) {
  const normalizedIntent = String(intent ?? "").trim().toUpperCase();
  const initialMode: Mode =
    normalizedIntent === "NEW_BUILD"
      ? "NEW_BUILD_ESTIMATE"
      : normalizedIntent === "GAP_FILL_ACTUAL"
        ? "SMT_BASELINE"
        : "MANUAL_TOTALS";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [compareView, setCompareView] = useState<CompareView>("SIMULATED");
  const [hasActualIntervals, setHasActualIntervals] = useState<boolean>(false);
  const [actualSource, setActualSource] = useState<"SMT" | "GREEN_BUTTON" | null>(null);
  const [actualCoverage, setActualCoverage] = useState<{ start: string | null; end: string | null; intervalsCount: number } | null>(
    null,
  );
  const [loadingActual, setLoadingActual] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [recalcNote, setRecalcNote] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [canRecalc, setCanRecalc] = useState(false);
  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [canonicalEndMonth, setCanonicalEndMonth] = useState<string>("");
  const [weatherPreference, setWeatherPreference] = useState<"NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE">("NONE");

  const [scenarioId, setScenarioId] = useState<string>("baseline");
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([]);
  const [builds, setBuilds] = useState<BuildsResp extends { ok: true } ? BuildsResp["builds"] : any[]>([]);
  const [scenarioSimHouseOverride, setScenarioSimHouseOverride] = useState<any[] | null>(null);
  const [scenarioBanner, setScenarioBanner] = useState<string | null>(null);

  const WORKSPACE_PAST_NAME = "Past (Corrected)";
  const WORKSPACE_FUTURE_NAME = "Future (What-if)";
  const [workspace, setWorkspace] = useState<"BASELINE" | "PAST" | "FUTURE">("BASELINE");

  const [openManual, setOpenManual] = useState(false);
  const [openHome, setOpenHome] = useState(false);
  const [openAppliances, setOpenAppliances] = useState(false);
  const [openTimeline, setOpenTimeline] = useState(false);

  // Scenario events editor state (minimal)
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineMonth, setTimelineMonth] = useState<string>("");
  const [timelineAdjustmentType, setTimelineAdjustmentType] = useState<AdjustmentType>("CUSTOM");
  const [timelineCatalogValue, setTimelineCatalogValue] = useState<string>("");
  const [timelineMultiplier, setTimelineMultiplier] = useState<string>("");
  const [timelineAdderKwh, setTimelineAdderKwh] = useState<string>("");

  useEffect(() => {
    // Intent-driven Step 2 focus. Intent is deterministic (querystring/prop); no source-selection UI on this page.
    if (normalizedIntent === "MANUAL") {
      setMode("MANUAL_TOTALS");
      setOpenManual(true);
      return;
    }
    if (normalizedIntent === "NEW_BUILD") {
      setMode("NEW_BUILD_ESTIMATE");
      setOpenHome(true);
      return;
    }
    if (normalizedIntent === "GAP_FILL_ACTUAL") {
      setMode("SMT_BASELINE");
      setOpenHome(true);
      return;
    }
  }, [houseId, normalizedIntent]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Reset "Actual" view for this house until we confirm intervals exist.
      setCompareView("SIMULATED");
      setHasActualIntervals(false);
      setActualSource(null);
      setActualCoverage(null);
      setLoadingActual(true);
      try {
        const r = await fetch("/api/user/usage", { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as UsageApiResp | null;
        if (cancelled) return;
        if (!r.ok || !j?.ok) {
          setHasActualIntervals(false);
          setActualSource(null);
          setActualCoverage(null);
          return;
        }
        const row = (j.houses || []).find((h) => h.houseId === houseId) ?? null;
        const ds = row?.dataset ?? null;
        const source = String(ds?.summary?.source ?? "");
        const intervalsCount = Number(ds?.summary?.intervalsCount ?? 0);
        const intervals15Len = Array.isArray(ds?.series?.intervals15) ? ds.series.intervals15.length : 0;
        const hasIntervals = intervalsCount > 0 && intervals15Len > 0;
        setHasActualIntervals(hasIntervals);
        setActualSource(source === "SMT" || source === "GREEN_BUTTON" ? (source as any) : null);
        setActualCoverage({ start: ds?.summary?.start ?? null, end: ds?.summary?.end ?? null, intervalsCount });
        if (hasIntervals) {
          setCompareView("ACTUAL");
          // If we have interval data, baseline is Actual (read-only). Prefer the actual-baseline simulation mode.
          if (normalizedIntent !== "MANUAL" && normalizedIntent !== "NEW_BUILD") setMode("SMT_BASELINE");
        }
      } catch {
        if (!cancelled) {
          setHasActualIntervals(false);
          setActualSource(null);
          setActualCoverage(null);
        }
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
          setCanonicalEndMonth("");
          return;
        }
        setCanRecalc(Boolean(j.canRecalc));
        setMissingItems(Array.isArray(j.missingItems) ? j.missingItems.map(String) : []);
        setCanonicalEndMonth(typeof (j as any).canonicalEndMonth === "string" ? String((j as any).canonicalEndMonth) : "");
      } catch {
        if (!cancelled) {
          setCanRecalc(false);
          setMissingItems(["Unable to load requirements. Try refreshing."]);
          setCanonicalEndMonth("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, mode, refreshToken]);

  const actualDisabledReason = useMemo(() => {
    if (loadingActual) return "Checking actual usage availability…";
    if (hasActualIntervals) return null;
    return "Connect Smart Meter Texas or upload Green Button usage to view Actual usage here.";
  }, [hasActualIntervals, loadingActual]);

  const selectedBuild = useMemo(() => {
    if (!Array.isArray(builds)) return null;
    if (scenarioId === "baseline") return builds.find((b) => String(b?.scenarioKey ?? "") === "BASELINE") ?? null;
    return builds.find((b) => String(b?.scenarioId ?? "") === scenarioId) ?? null;
  }, [builds, scenarioId]);

  const baselineBuild = useMemo(() => {
    if (!Array.isArray(builds)) return null;
    return builds.find((b) => String(b?.scenarioKey ?? "") === "BASELINE") ?? null;
  }, [builds]);

  const workspacesUnlocked = useMemo(() => {
    // If interval data exists, baseline is Actual and workspaces unlock once required details are saved (requirements endpoint).
    if (hasActualIntervals) return Boolean(canRecalc);
    // Otherwise, V1 requires a generated simulated baseline build.
    return Boolean(baselineBuild);
  }, [baselineBuild, canRecalc, hasActualIntervals]);

  const pastScenario = useMemo(() => scenarios.find((s) => s.name === WORKSPACE_PAST_NAME) ?? null, [scenarios]);
  const futureScenario = useMemo(() => scenarios.find((s) => s.name === WORKSPACE_FUTURE_NAME) ?? null, [scenarios]);

  useEffect(() => {
    if (workspace === "BASELINE") {
      setScenarioId("baseline");
      return;
    }
    if (workspace === "PAST") {
      setScenarioId(pastScenario?.id ?? "baseline");
      return;
    }
    setScenarioId(futureScenario?.id ?? "baseline");
  }, [workspace, pastScenario?.id, futureScenario?.id]);

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
        if (!r.ok) {
          const msg = j && "message" in j && typeof (j as any).message === "string" ? String((j as any).message) : "Recalculate to generate this scenario.";
          setScenarioBanner(msg);
          setScenarioSimHouseOverride(null);
          return;
        }
        if (!j?.ok) {
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

  async function createScenario(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      const r = await fetch("/api/user/simulator/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId, name: trimmed }),
      });
      const j = (await r.json().catch(() => null)) as any;
      if (!r.ok || !j?.ok) {
        setRecalcNote(j?.error ? String(j.error) : "Failed to create scenario");
        return null;
      }
      const id = String(j.scenario?.id ?? "");
      setRefreshToken((x) => x + 1);
      return id || null;
    } catch (e: any) {
      setRecalcNote(e?.message ?? String(e));
      return null;
    }
  }

  async function loadTimeline(overrideScenarioId?: string) {
    const effectiveScenarioId = typeof overrideScenarioId === "string" && overrideScenarioId.trim() ? overrideScenarioId.trim() : scenarioId;
    if (!effectiveScenarioId || effectiveScenarioId === "baseline") {
      setTimelineEvents([]);
      return;
    }
    const r = await fetch(
      `/api/user/simulator/scenarios/${encodeURIComponent(effectiveScenarioId)}/events?houseId=${encodeURIComponent(houseId)}`,
      {
      cache: "no-store",
      },
    );
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
    const multiplier =
      timelineAdjustmentType === "CUSTOM"
        ? timelineMultiplier.trim()
          ? Number(timelineMultiplier)
          : undefined
        : toMonthlyAdjustmentPayload({
            type: timelineAdjustmentType,
            value: timelineCatalogValue.trim() ? Number(timelineCatalogValue) : NaN,
          }).multiplier;
    const adderKwh =
      timelineAdjustmentType === "CUSTOM"
        ? timelineAdderKwh.trim()
          ? Number(timelineAdderKwh)
          : undefined
        : toMonthlyAdjustmentPayload({
            type: timelineAdjustmentType,
            value: timelineCatalogValue.trim() ? Number(timelineCatalogValue) : NaN,
          }).adderKwh;
    if (
      (multiplier === undefined || !Number.isFinite(Number(multiplier))) &&
      (adderKwh === undefined || !Number.isFinite(Number(adderKwh)))
    ) {
      setRecalcNote("Enter a valid adjustment value.");
      return;
    }
    const r = await fetch(`/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ houseId, effectiveMonth, multiplier, adderKwh, kind: "MONTHLY_ADJUSTMENT" }),
    });
    const j = (await r.json().catch(() => null)) as any;
    if (r.ok && j?.ok) {
      setTimelineMonth("");
      setTimelineAdjustmentType("CUSTOM");
      setTimelineCatalogValue("");
      setTimelineMultiplier("");
      setTimelineAdderKwh("");
      await loadTimeline();
    }
  }

  async function addTravelRange() {
    if (!scenarioId || scenarioId === "baseline") return;
    const effectiveMonth = canonicalEndMonth || new Date().toISOString().slice(0, 7);
    const r = await fetch(`/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ houseId, effectiveMonth, kind: "TRAVEL_RANGE", startDate: "", endDate: "" }),
    });
    const j = (await r.json().catch(() => null)) as any;
    if (r.ok && j?.ok) await loadTimeline();
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
    if (workspace === "PAST" && !pastScenario) {
      setRecalcNote(`Create the “${WORKSPACE_PAST_NAME}” workspace first.`);
      return;
    }
    if (workspace === "FUTURE" && !futureScenario) {
      setRecalcNote(`Create the “${WORKSPACE_FUTURE_NAME}” workspace first.`);
      return;
    }
    if (scenarioId !== "baseline" && !baselineBuild && !hasActualIntervals) {
      setRecalcNote("Generate the simulated baseline first to unlock Past/Future scenarios.");
      return;
    }
    setRecalcBusy(true);
    setRecalcNote(null);
    try {
      const r = await fetch("/api/user/simulator/recalc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId,
          mode,
          scenarioId: scenarioId === "baseline" ? null : scenarioId,
          weatherPreference,
        }),
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
              Review Actual usage (if available), complete the required details, then generate a simulated baseline and scenarios.
            </p>
          </div>

          {hasActualIntervals ? (
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
            <div className="text-xs text-brand-cyan/60">{actualDisabledReason}</div>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Steps</div>
              <div className="mt-2 text-sm text-brand-cyan/80">
                {hasActualIntervals ? (
                  <>
                    Your <span className="font-semibold">baseline is Actual usage</span> (read-only). Complete the required
                    details below to unlock Past/Future simulations.
                  </>
                ) : (
                  <>
                    No interval usage connected yet. You can start with Manual totals or the New Build estimator, then fill in
                    details below.
                  </>
                )}
              </div>
            </div>
            <div className="text-xs text-brand-cyan/75">
              <span className="font-semibold">Actual coverage:</span>{" "}
              {hasActualIntervals
                ? `${actualSource ?? "ACTUAL"} · ${actualCoverage?.start ?? "?"} → ${actualCoverage?.end ?? "?"} · ${
                    actualCoverage?.intervalsCount ?? 0
                  } intervals`
                : "none"}
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {/* Step 1: Manual */}
            <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 1</div>
                <div className="mt-1 text-sm font-semibold text-brand-white">Manual totals</div>
                <div className="mt-1 text-xs text-brand-cyan/70">
                  Only use this when you do <span className="font-semibold">not</span> have SMT/Green Button interval data.
                </div>
              </div>
              <div className="md:col-span-5">
                <div className="text-xs text-brand-cyan/80">
                  {hasActualIntervals
                    ? "Disabled because interval usage is connected."
                    : "Optional. Enter totals if you need a baseline without interval data."}
                </div>
              </div>
              <div className="md:col-span-3 md:flex md:justify-end">
                <button
                  type="button"
                  onClick={() => setOpenManual(true)}
                  disabled={hasActualIntervals}
                  className={[
                    "rounded-xl border px-3 py-2 text-xs font-semibold transition",
                    hasActualIntervals
                      ? "cursor-not-allowed border-brand-cyan/20 bg-brand-white/5 text-brand-white/50 opacity-60"
                      : "border-brand-cyan/30 bg-brand-white/5 text-brand-white hover:bg-brand-white/10",
                  ].join(" ")}
                >
                  {hasActualIntervals ? "Manual (disabled)" : "Open Manual"}
                </button>
              </div>
            </div>

            {/* Step 2: Home */}
            <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 2</div>
                <div className="mt-1 text-sm font-semibold text-brand-white">Home details</div>
                <div className="mt-1 text-xs text-brand-cyan/70">Required for Past/Future simulations.</div>
              </div>
              <div className="md:col-span-5">
                <div className="text-xs text-brand-cyan/80">
                  Save insulation, HVAC, occupancy, and other characteristics so IntelliWatt can reshape simulated curves.
                </div>
              </div>
              <div className="md:col-span-3 md:flex md:justify-end">
                <button
                  type="button"
                  onClick={() => setOpenHome(true)}
                  className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10"
                >
                  Open Home
                </button>
              </div>
            </div>

            {/* Step 3: Appliances */}
            <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 3</div>
                <div className="mt-1 text-sm font-semibold text-brand-white">Appliance details</div>
                <div className="mt-1 text-xs text-brand-cyan/70">Required for Past/Future simulations.</div>
              </div>
              <div className="md:col-span-5">
                <div className="text-xs text-brand-cyan/80">
                  Save fuel configuration and major loads. This influences the shape of simulated adjustments.
                </div>
              </div>
              <div className="md:col-span-3 md:flex md:justify-end">
                <button
                  type="button"
                  onClick={() => setOpenAppliances(true)}
                  className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10"
                >
                  Open Appliances
                </button>
              </div>
            </div>

            {/* Step 4/5: Workspaces */}
            <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 4</div>
                <div className="mt-1 text-sm font-semibold text-brand-white">Past (Corrected)</div>
                <div className="mt-1 text-xs text-brand-cyan/70">Optional.</div>
              </div>
              <div className="md:col-span-5">
                <div className="text-xs text-brand-cyan/80">
                  Use this to correct historical usage (e.g. vacancy/travel or known retrofits). If you use Past corrections,
                  Future adjustments will build on top of the corrected curve.
                </div>
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-3 md:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setWorkspace("PAST");
                    if (!pastScenario) void createScenario(WORKSPACE_PAST_NAME);
                  }}
                  disabled={!workspacesUnlocked}
                  className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10 disabled:opacity-60"
                >
                  {pastScenario ? "Past workspace ready" : "Create Past"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWorkspace("PAST");
                    setOpenTimeline(true);
                    if (pastScenario?.id) setScenarioId(pastScenario.id);
                    void loadTimeline(pastScenario?.id ?? undefined);
                  }}
                  disabled={!workspacesUnlocked || !pastScenario}
                  className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10 disabled:opacity-60"
                >
                  Edit Past
                </button>
              </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 5</div>
                <div className="mt-1 text-sm font-semibold text-brand-white">Future (What-if)</div>
                <div className="mt-1 text-xs text-brand-cyan/70">Create scenarios for planned changes.</div>
              </div>
              <div className="md:col-span-5">
                <div className="text-xs text-brand-cyan/80">
                  Future simulations never edit Actual usage. They generate simulated curves for comparison only.
                </div>
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-3 md:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setWorkspace("FUTURE");
                    if (!futureScenario) void createScenario(WORKSPACE_FUTURE_NAME);
                  }}
                  disabled={!workspacesUnlocked}
                  className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10 disabled:opacity-60"
                >
                  {futureScenario ? "Future workspace ready" : "Create Future"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWorkspace("FUTURE");
                    setOpenTimeline(true);
                    if (futureScenario?.id) setScenarioId(futureScenario.id);
                    void loadTimeline(futureScenario?.id ?? undefined);
                  }}
                  disabled={!workspacesUnlocked || !futureScenario}
                  className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10 disabled:opacity-60"
                >
                  Edit Future
                </button>
              </div>
            </div>

            {/* Step 6: Weather */}
            <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 6</div>
                <div className="mt-1 text-sm font-semibold text-brand-white">Weather normalization</div>
                <div className="mt-1 text-xs text-brand-cyan/70">Last step (optional in Phase 1).</div>
              </div>
              <div className="md:col-span-5">
                <div className="text-xs text-brand-cyan/80">Phase 1 behavior is identity. Preference is stored for determinism.</div>
              </div>
              <div className="md:col-span-3">
                <select
                  value={weatherPreference}
                  onChange={(e) => setWeatherPreference(e.target.value as any)}
                  className="w-full rounded-xl border border-brand-cyan/20 bg-brand-white/5 px-3 py-2 text-xs text-brand-white"
                >
                  <option value="NONE">None (Phase 1)</option>
                  <option value="LAST_YEAR_WEATHER">Last year weather (stub)</option>
                  <option value="LONG_TERM_AVERAGE">Long-term average (stub)</option>
                </select>
              </div>
            </div>

            {!workspacesUnlocked ? (
              <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 px-4 py-3 text-xs text-brand-cyan/80">
                <div className="font-semibold text-brand-white/90">To continue</div>
                <div className="mt-1">
                  {hasActualIntervals ? (
                    <>
                      Save <span className="font-semibold">Home</span> and <span className="font-semibold">Appliances</span> first.
                    </>
                  ) : (
                    <>
                      Generate a <span className="font-semibold">simulated baseline</span> first (via Recalculate).
                    </>
                  )}
                </div>
              </div>
            ) : null}
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
            {workspace === "PAST" ? (
              <div className="rounded-2xl border border-brand-blue/10 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">
                      Unusual travel (exclude whole days)
                    </div>
                    <div className="mt-2 text-xs text-brand-navy/70">
                      Add date ranges where the home was vacant/unusually low usage. Simulated totals will be renormalized to
                      still match your kWh targets.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void addTravelRange()}
                    className="rounded-xl border border-brand-blue/30 bg-white px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5"
                  >
                    Add range
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {timelineEvents.filter((e) => String((e as any)?.kind ?? "") === "TRAVEL_RANGE").length ? null : (
                    <div className="text-sm text-brand-navy/70">No travel ranges yet.</div>
                  )}
                  {timelineEvents
                    .filter((e) => String((e as any)?.kind ?? "") === "TRAVEL_RANGE")
                    .map((e) => {
                      const p = (e as any)?.payloadJson ?? {};
                      const start = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : "";
                      const end = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : "";
                      return (
                        <div
                          key={String(e.id)}
                          className="grid gap-2 rounded-xl border border-brand-blue/10 bg-brand-blue/5 p-3 md:grid-cols-5"
                        >
                          <input
                            type="date"
                            defaultValue={start}
                            onBlur={(ev) => {
                              const v = String(ev.target.value ?? "").slice(0, 10);
                              void saveTimelineEvent(String(e.id), {
                                effectiveMonth: /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(0, 7) : String(e.effectiveMonth ?? ""),
                                payloadJson: { ...p, startDate: v },
                              });
                            }}
                            className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy md:col-span-2"
                          />
                          <input
                            type="date"
                            defaultValue={end}
                            onBlur={(ev) => {
                              const v = String(ev.target.value ?? "").slice(0, 10);
                              void saveTimelineEvent(String(e.id), { payloadJson: { ...p, endDate: v } });
                            }}
                            className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy md:col-span-2"
                          />
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
            ) : null}

            <div className="rounded-2xl border border-brand-blue/10 bg-brand-blue/5 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Add event (month)</div>
              <div className="mt-3 grid gap-2 md:grid-cols-5">
                <input
                  type="month"
                  value={timelineMonth}
                  onChange={(e) => setTimelineMonth(e.target.value)}
                  className="rounded-xl border border-brand-blue/20 bg-white px-3 py-2 text-xs text-brand-navy"
                />
                <select
                  value={timelineAdjustmentType}
                  onChange={(e) => setTimelineAdjustmentType(e.target.value as AdjustmentType)}
                  className="rounded-xl border border-brand-blue/20 bg-white px-3 py-2 text-xs text-brand-navy"
                >
                  {USAGE_SCENARIO_ADJUSTMENT_CATALOG.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {timelineAdjustmentType === "CUSTOM" ? (
                  <>
                    <input
                      value={timelineMultiplier}
                      onChange={(e) => setTimelineMultiplier(e.target.value)}
                      placeholder="Multiplier (e.g. 1.10 or 0)"
                      className="rounded-xl border border-brand-blue/20 bg-white px-3 py-2 text-xs text-brand-navy"
                    />
                    <input
                      value={timelineAdderKwh}
                      onChange={(e) => setTimelineAdderKwh(e.target.value)}
                      placeholder="Adder kWh (e.g. 50 or 0)"
                      className="rounded-xl border border-brand-blue/20 bg-white px-3 py-2 text-xs text-brand-navy"
                    />
                  </>
                ) : (
                  <input
                    value={timelineCatalogValue}
                    onChange={(e) => setTimelineCatalogValue(e.target.value)}
                    placeholder={
                      USAGE_SCENARIO_ADJUSTMENT_CATALOG.find((c) => c.id === timelineAdjustmentType)?.inputKind === "PERCENT"
                        ? "Percent (0–100)"
                        : "kWh (e.g. 50)"
                    }
                    className="md:col-span-2 rounded-xl border border-brand-blue/20 bg-white px-3 py-2 text-xs text-brand-navy"
                  />
                )}
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
                {timelineEvents.filter((e) => String((e as any)?.kind ?? "") === "MONTHLY_ADJUSTMENT").length ? null : (
                  <div className="text-sm text-brand-navy/70">No events yet.</div>
                )}
                {timelineEvents
                  .filter((e) => String((e as any)?.kind ?? "") === "MONTHLY_ADJUSTMENT")
                  .map((e) => {
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
                        onBlur={(ev) => {
                          const s = String(ev.target.value ?? "").trim();
                          const n = s === "" ? null : Number(s);
                          void saveTimelineEvent(String(e.id), {
                            payloadJson: {
                              multiplier: n !== null && Number.isFinite(n) ? n : undefined,
                              adderKwh: p?.adderKwh,
                            },
                          });
                        }}
                        className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                      />
                      <input
                        defaultValue={add}
                        onBlur={(ev) => {
                          const s = String(ev.target.value ?? "").trim();
                          const n = s === "" ? null : Number(s);
                          void saveTimelineEvent(String(e.id), {
                            payloadJson: {
                              multiplier: p?.multiplier,
                              adderKwh: n !== null && Number.isFinite(n) ? n : undefined,
                            },
                          });
                        }}
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
