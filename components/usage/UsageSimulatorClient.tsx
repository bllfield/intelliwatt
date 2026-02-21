"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ManualUsageEntry } from "@/components/manual/ManualUsageEntry";
import { HomeDetailsClient } from "@/components/home/HomeDetailsClient";
import { AppliancesClient } from "@/components/appliances/AppliancesClient";
import UsageDashboard, { type ScenarioVariable } from "@/components/usage/UsageDashboard";
import {
  USAGE_SCENARIO_ADJUSTMENT_CATALOG,
  toMonthlyAdjustmentPayload,
  type AdjustmentType,
} from "@/lib/usageScenario/catalog";
import { ScenarioUpgradesEditor } from "@/components/upgrades/ScenarioUpgradesEditor";

type Mode = "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";

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

type RequirementsDbStatus = "ok" | "missing_env" | "unreachable" | "error";

type RequirementsResp =
  | {
      ok: true;
      canRecalc: boolean;
      missingItems: string[];
      hasActualIntervals: boolean;
      actualSource: "SMT" | "GREEN_BUTTON" | null;
      canonicalEndMonth: string;
      dbStatus?: {
        homeDetails: RequirementsDbStatus;
        appliances: RequirementsDbStatus;
        usage: RequirementsDbStatus;
      };
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
  const [requirementsError, setRequirementsError] = useState<string | null>(null);
  const [requirementsDbStatus, setRequirementsDbStatus] = useState<{
    homeDetails: RequirementsDbStatus;
    appliances: RequirementsDbStatus;
    usage: RequirementsDbStatus;
  } | null>(null);
  const [canonicalEndMonth, setCanonicalEndMonth] = useState<string>("");
  const [weatherPreference, setWeatherPreference] = useState<"NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE">(
    "LAST_YEAR_WEATHER",
  );

  const [scenarioId, setScenarioId] = useState<string>("baseline");
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([]);
  const [builds, setBuilds] = useState<BuildsResp extends { ok: true } ? BuildsResp["builds"] : any[]>([]);
  const [scenarioSimHouseOverride, setScenarioSimHouseOverride] = useState<any[] | null>(null);
  const [scenarioBanner, setScenarioBanner] = useState<string | null>(null);

  const WORKSPACE_PAST_NAME = "Past (Corrected)";
  const WORKSPACE_FUTURE_NAME = "Future (What-if)";
  const [workspace, setWorkspace] = useState<"BASELINE" | "PAST" | "FUTURE">("BASELINE");
  const [curveView, setCurveView] = useState<"BASELINE" | "PAST" | "FUTURE">("BASELINE");

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
  const [travelRangeStart, setTravelRangeStart] = useState<string>("");
  const [travelRangeEnd, setTravelRangeEnd] = useState<string>("");
  const [showAdvancedMonthly, setShowAdvancedMonthly] = useState(false);

  const [pastEventCount, setPastEventCount] = useState<number>(0);
  const [futureEventCount, setFutureEventCount] = useState<number>(0);
  const [dashboardPastVariables, setDashboardPastVariables] = useState<ScenarioVariable[]>([]);
  const [dashboardFutureVariables, setDashboardFutureVariables] = useState<ScenarioVariable[]>([]);

  const scenarioRecalcTimersRef = useRef<Map<string, number>>(new Map());
  const recalcQueueRef = useRef<Array<{ scenarioId: string | null; note?: string }>>([]);
  const recalcRunningRef = useRef(false);
  const autoBaselineAttemptedRef = useRef(false);
  const lastWeatherPreferenceRef = useRef(weatherPreference);

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
      // Reset actual coverage for this house until we confirm intervals exist.
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
        // If we have interval data, baseline is Actual (read-only). Prefer the actual-baseline simulation mode.
        if (hasIntervals && normalizedIntent !== "MANUAL" && normalizedIntent !== "NEW_BUILD") setMode("SMT_BASELINE");
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
          setRequirementsError(j && "error" in j && typeof (j as any).error === "string" ? String((j as any).error) : `HTTP ${r.status}`);
          setRequirementsDbStatus(null);
          setCanonicalEndMonth("");
          return;
        }
        setCanRecalc(Boolean(j.canRecalc));
        setRequirementsError(null);
        setRequirementsDbStatus((j as any).dbStatus ?? null);
        setCanonicalEndMonth(typeof (j as any).canonicalEndMonth === "string" ? String((j as any).canonicalEndMonth) : "");
      } catch {
        if (!cancelled) {
          setCanRecalc(false);
          setRequirementsError("Unable to load simulator requirements.");
          setRequirementsDbStatus(null);
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

  const wiringIssues = useMemo(() => {
    const issues: string[] = [];
    if (requirementsError) issues.push(`Simulator requirements unavailable: ${requirementsError}`);

    const s = requirementsDbStatus;
    if (s) {
      const fmt = (label: string, status: RequirementsDbStatus, envVar: string) => {
        if (status === "ok") return null;
        if (status === "missing_env") return `${label} database not configured (${envVar}).`;
        if (status === "unreachable") return `${label} database unreachable.`;
        return `${label} database error.`;
      };
      const homeMsg = fmt("Home Details", s.homeDetails, "HOME_DETAILS_DATABASE_URL");
      const appMsg = fmt("Appliances", s.appliances, "APPLIANCES_DATABASE_URL");
      const usageMsg = fmt("Usage", s.usage, "USAGE_DATABASE_URL");
      if (homeMsg) issues.push(homeMsg);
      if (appMsg) issues.push(appMsg);
      if (usageMsg) issues.push(usageMsg);
    }

    return issues;
  }, [requirementsDbStatus, requirementsError]);

  const selectedBuild = useMemo(() => {
    if (!Array.isArray(builds)) return null;
    if (scenarioId === "baseline") return builds.find((b) => String(b?.scenarioKey ?? "") === "BASELINE") ?? null;
    return builds.find((b) => String(b?.scenarioId ?? "") === scenarioId) ?? null;
  }, [builds, scenarioId]);

  const baselineBuild = useMemo(() => {
    if (!Array.isArray(builds)) return null;
    return builds.find((b) => String(b?.scenarioKey ?? "") === "BASELINE") ?? null;
  }, [builds]);

  const baselineReady = useMemo(() => Boolean(baselineBuild?.lastBuiltAt), [baselineBuild?.lastBuiltAt]);

  const pastScenario = useMemo(() => scenarios.find((s) => s.name === WORKSPACE_PAST_NAME) ?? null, [scenarios]);
  const futureScenario = useMemo(() => scenarios.find((s) => s.name === WORKSPACE_FUTURE_NAME) ?? null, [scenarios]);

  const pastBuild = useMemo(() => {
    if (!Array.isArray(builds)) return null;
    const id = pastScenario?.id ?? "";
    if (!id) return null;
    return builds.find((b) => String(b?.scenarioId ?? "") === id) ?? null;
  }, [builds, pastScenario?.id]);

  const futureBuild = useMemo(() => {
    if (!Array.isArray(builds)) return null;
    const id = futureScenario?.id ?? "";
    if (!id) return null;
    return builds.find((b) => String(b?.scenarioId ?? "") === id) ?? null;
  }, [builds, futureScenario?.id]);

  const pastReady = useMemo(() => {
    if (!pastScenario?.id) return false;
    return Boolean(pastBuild?.lastBuiltAt) || baselineReady;
  }, [pastBuild?.lastBuiltAt, pastScenario?.id, baselineReady]);

  const futureReady = useMemo(() => {
    return Boolean(futureScenario?.id) && futureEventCount > 0 && Boolean(futureBuild?.lastBuiltAt);
  }, [futureBuild?.lastBuiltAt, futureEventCount, futureScenario?.id]);

  useEffect(() => {
    autoBaselineAttemptedRef.current = false;
    scenarioRecalcTimersRef.current.forEach((t) => window.clearTimeout(t));
    scenarioRecalcTimersRef.current.clear();
    recalcQueueRef.current = [];
    recalcRunningRef.current = false;
  }, [houseId]);

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

  const viewScenarioId = useMemo(() => {
    if (curveView === "BASELINE") return "baseline";
    if (curveView === "PAST") return pastScenario?.id ?? "baseline";
    return futureScenario?.id ?? "baseline";
  }, [curveView, pastScenario?.id, futureScenario?.id]);

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
      if (!viewScenarioId || viewScenarioId === "baseline") return;
      try {
        const r = await fetch(
          `/api/user/usage/simulated/house?houseId=${encodeURIComponent(houseId)}&scenarioId=${encodeURIComponent(viewScenarioId)}`,
          { cache: "no-store" },
        );
        const j = (await r.json().catch(() => null)) as ScenarioHouseResp | null;
        if (cancelled) return;
        if (!r.ok) {
          const msg =
            j && "message" in j && typeof (j as any).message === "string"
              ? String((j as any).message)
              : "Scenario not computed yet. Save changes in this workspace to compute it.";
          setScenarioBanner(msg);
          setScenarioSimHouseOverride(null);
          return;
        }
        if (!j?.ok) {
          const msg = j?.message ? String(j.message) : "Scenario not computed yet. Save changes in this workspace to compute it.";
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
          setScenarioBanner("Unable to load scenario dataset. Try saving again to recompute.");
          setScenarioSimHouseOverride(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, viewScenarioId, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      async function loadCount(sid: string | null, setter: (n: number) => void) {
        if (!sid) {
          setter(0);
          return;
        }
        try {
          const r = await fetch(
            `/api/user/simulator/scenarios/${encodeURIComponent(sid)}/events?houseId=${encodeURIComponent(houseId)}`,
            { cache: "no-store" },
          );
          const j = (await r.json().catch(() => null)) as any;
          if (cancelled) return;
          if (!r.ok || !j?.ok) {
            setter(0);
            return;
          }
          const events = Array.isArray(j.events) ? j.events : [];
          setter(events.length);
        } catch {
          if (!cancelled) setter(0);
        }
      }

      await Promise.all([
        loadCount(pastScenario?.id ?? null, setPastEventCount),
        loadCount(futureScenario?.id ?? null, setFutureEventCount),
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, pastScenario?.id, futureScenario?.id, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (curveView === "BASELINE") {
        setDashboardPastVariables([]);
        setDashboardFutureVariables([]);
        return;
      }
      async function fetchEvents(sid: string | null): Promise<ScenarioVariable[]> {
        if (!sid) return [];
        const r = await fetch(
          `/api/user/simulator/scenarios/${encodeURIComponent(sid)}/events?houseId=${encodeURIComponent(houseId)}`,
          { cache: "no-store" }
        );
        const j = (await r.json().catch(() => null)) as any;
        if (!r.ok || !j?.ok) return [];
        const events = Array.isArray(j.events) ? j.events : [];
        return events.map((e: any) => ({
          kind: String(e?.kind ?? ""),
          effectiveMonth: e?.effectiveMonth,
          payloadJson: e?.payloadJson ?? {},
        }));
      }
      if (curveView === "PAST") {
        const past = await fetchEvents(pastScenario?.id ?? null);
        if (!cancelled) {
          setDashboardPastVariables(past);
          setDashboardFutureVariables([]);
        }
        return;
      }
      if (curveView === "FUTURE") {
        const [past, future] = await Promise.all([
          fetchEvents(pastScenario?.id ?? null),
          fetchEvents(futureScenario?.id ?? null),
        ]);
        if (!cancelled) {
          setDashboardPastVariables(past);
          setDashboardFutureVariables(future);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [houseId, curveView, pastScenario?.id, futureScenario?.id, refreshToken]);

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
      scheduleScenarioRecalc(scenarioId);
    }
  }

  async function addTravelRange(startDate: string, endDate: string) {
    if (!scenarioId || scenarioId === "baseline") return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return;
    const effectiveMonth = startDate.slice(0, 7);
    const r = await fetch(`/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ houseId, effectiveMonth, kind: "TRAVEL_RANGE", startDate, endDate }),
    });
    const j = (await r.json().catch(() => null)) as any;
    if (r.ok && j?.ok) {
      await loadTimeline();
      scheduleScenarioRecalc(scenarioId);
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
    if (r.ok && j?.ok) {
      await loadTimeline();
      scheduleScenarioRecalc(scenarioId);
    }
  }

  async function deleteTimelineEvent(eventId: string) {
    if (!scenarioId || scenarioId === "baseline") return;
    const r = await fetch(
      `/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events/${encodeURIComponent(eventId)}?houseId=${encodeURIComponent(houseId)}`,
      { method: "DELETE" },
    );
    const j = (await r.json().catch(() => null)) as any;
    if (r.ok && j?.ok) {
      await loadTimeline();
      scheduleScenarioRecalc(scenarioId);
    }
  }

  async function recalcNow(args: { scenarioId: string | null; note?: string }) {
    setRecalcBusy(true);
    setRecalcNote(args.note ?? "Updating curves…");
    try {
      const r = await fetch("/api/user/simulator/recalc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId,
          mode,
          scenarioId: args.scenarioId,
          weatherPreference,
        }),
      });
      const j = (await r.json().catch(() => null)) as any;
      if (!r.ok || !j?.ok) {
        setRecalcNote(j?.error ? String(j.error) : `Recalc failed (${r.status})`);
        return;
      }
      setRecalcNote("Updated.");
      setRefreshToken((x) => x + 1);
    } catch (e: any) {
      setRecalcNote(e?.message ?? String(e));
    } finally {
      setRecalcBusy(false);
    }
  }

  function enqueueRecalc(item: { scenarioId: string | null; note?: string }) {
    // De-dupe by scenarioId so rapid saves only keep the latest request.
    recalcQueueRef.current = recalcQueueRef.current.filter((x) => x.scenarioId !== item.scenarioId);
    recalcQueueRef.current.push(item);
  }

  async function drainRecalcQueue() {
    if (recalcRunningRef.current) return;
    recalcRunningRef.current = true;
    try {
      while (recalcQueueRef.current.length) {
        const next = recalcQueueRef.current.shift()!;
        await recalcNow(next);
      }
    } finally {
      recalcRunningRef.current = false;
    }
  }

  function scheduleScenarioRecalc(sid: string) {
    if (!sid || sid === "baseline") return;
    const existing = scenarioRecalcTimersRef.current.get(sid);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      scenarioRecalcTimersRef.current.delete(sid);
      enqueueRecalc({ scenarioId: sid, note: "Updating scenario…" });
      void drainRecalcQueue();
    }, 750);
    scenarioRecalcTimersRef.current.set(sid, t);
  }

  useEffect(() => {
    // With no explicit "Recalculate" button, auto-generate the baseline once requirements are met.
    if (baselineReady) return;
    if (!canRecalc) return;
    if (recalcBusy) return;
    if (autoBaselineAttemptedRef.current) return;
    autoBaselineAttemptedRef.current = true;
    enqueueRecalc({ scenarioId: null, note: "Generating baseline…" });
    void drainRecalcQueue();
  }, [baselineReady, canRecalc, recalcBusy, mode, weatherPreference]);

  useEffect(() => {
    // Weather preference affects determinism of builds; recompute when it changes.
    if (lastWeatherPreferenceRef.current === weatherPreference) return;
    lastWeatherPreferenceRef.current = weatherPreference;
    if (!canRecalc) return;
    void (async () => {
      enqueueRecalc({ scenarioId: null, note: "Updating baseline…" });
      if (pastScenario?.id && pastEventCount > 0) enqueueRecalc({ scenarioId: pastScenario.id, note: "Updating Past…" });
      if (futureScenario?.id && futureEventCount > 0) enqueueRecalc({ scenarioId: futureScenario.id, note: "Updating Future…" });
      await drainRecalcQueue();
    })();
  }, [canRecalc, futureEventCount, futureScenario?.id, pastEventCount, pastScenario?.id, weatherPreference]);

  return (
    <div className="space-y-6">
      <div id="start-here" className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-6 text-brand-cyan shadow-[0_18px_40px_rgba(10,20,60,0.35)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Start here</div>
            <h2 className="mt-2 text-2xl font-semibold text-brand-white">Usage Simulator</h2>
            <p className="mt-2 text-sm text-brand-cyan/75">
              Complete the required details and save changes. Saving automatically updates the Baseline/Past/Future curves for viewing below.
            </p>
            {wiringIssues.length ? (
              <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-200/10 px-4 py-3 text-sm text-amber-100">
                <div className="text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-amber-200/80">
                  Wiring / configuration
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-50/90">
                  {wiringIssues.map((x, idx) => (
                    <li key={`${idx}-${x}`}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOpenManual(true)}
              disabled={normalizedIntent !== "MANUAL" || hasActualIntervals}
              title={
                hasActualIntervals
                  ? "Manual totals are disabled when interval usage is connected."
                  : normalizedIntent !== "MANUAL"
                    ? "Manual totals are only used when you enter via Usage Entry → Manual."
                    : undefined
              }
              className={[
                "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
                normalizedIntent === "MANUAL" && !hasActualIntervals
                  ? "border-brand-cyan/30 bg-brand-white/5 text-brand-white hover:bg-brand-white/10"
                  : "cursor-not-allowed border-brand-cyan/20 bg-brand-white/5 text-brand-white/50 opacity-60",
              ].join(" ")}
            >
              Manual totals
            </button>

            {hasActualIntervals ? (
              <div className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan/80">
                Actual connected
              </div>
            ) : (
              <div className="text-xs text-brand-cyan/60">{actualDisabledReason}</div>
            )}
          </div>
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
                    No interval usage connected yet. Complete Home + Appliances, then use Past/Future workspaces to simulate.
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
            {/* Step 1/2: Home + Appliances (side-by-side on desktop) */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
                <div className="md:col-span-5">
                  <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 1</div>
                  <div className="mt-1 text-sm font-semibold text-brand-white">Home details</div>
                  <div className="mt-1 text-xs text-brand-cyan/70">Required for Past/Future simulations.</div>
                </div>
                <div className="md:col-span-4">
                  <div className="text-xs text-brand-cyan/80">
                    Save insulation, HVAC, occupancy, and other characteristics.
                  </div>
                </div>
                <div className="md:col-span-3 md:flex md:justify-end">
                  <button
                    type="button"
                    onClick={() => setOpenHome(true)}
                    disabled={Boolean(requirementsDbStatus && requirementsDbStatus.homeDetails !== "ok")}
                    title={
                      requirementsDbStatus && requirementsDbStatus.homeDetails !== "ok"
                        ? "Home Details service is unavailable in this environment."
                        : undefined
                    }
                    className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Open Home
                  </button>
                </div>
              </div>

              <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
                <div className="md:col-span-5">
                  <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 2</div>
                  <div className="mt-1 text-sm font-semibold text-brand-white">Appliance details</div>
                  <div className="mt-1 text-xs text-brand-cyan/70">Required for Past/Future simulations.</div>
                </div>
                <div className="md:col-span-4">
                  <div className="text-xs text-brand-cyan/80">Save fuel configuration and major loads.</div>
                </div>
                <div className="md:col-span-3 md:flex md:justify-end">
                  <button
                    type="button"
                    onClick={() => setOpenAppliances(true)}
                    disabled={Boolean(requirementsDbStatus && requirementsDbStatus.appliances !== "ok")}
                    title={
                      requirementsDbStatus && requirementsDbStatus.appliances !== "ok"
                        ? "Appliances service is unavailable in this environment."
                        : undefined
                    }
                    className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Open Appliances
                  </button>
                </div>
              </div>
            </div>

            {/* Step 3/4: Workspaces (side-by-side on desktop) */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
                <div className="md:col-span-4">
                  <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 3</div>
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
                    disabled={!baselineReady}
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
                    disabled={!baselineReady || !pastScenario}
                    className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10 disabled:opacity-60"
                  >
                    Edit Past
                  </button>
                </div>
              </div>

              <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
                <div className="md:col-span-4">
                  <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 4</div>
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
                    disabled={!baselineReady}
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
                    disabled={!baselineReady || !futureScenario}
                    className="rounded-xl border border-brand-cyan/30 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-white/10 disabled:opacity-60"
                  >
                    Edit Future
                  </button>
                </div>
              </div>
            </div>

            {/* Step 5/6: Weather + View curve (side-by-side on desktop) */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
                <div className="md:col-span-5">
                  <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 5</div>
                  <div className="mt-1 text-sm font-semibold text-brand-white">Weather normalization</div>
                  <div className="mt-1 text-xs text-brand-cyan/70">Optional. No extra popup—just a preference.</div>
                </div>
                <div className="md:col-span-4">
                  <div className="text-xs text-brand-cyan/80">
                    Last year is the default baseline assumption. We store this choice so the simulator stays deterministic as we roll out weather adjustments.
                  </div>
                </div>
                <div className="md:col-span-3">
                  <div className="flex flex-wrap gap-2">
                    {(["LAST_YEAR_WEATHER", "LONG_TERM_AVERAGE"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setWeatherPreference(v)}
                        className={[
                          "rounded-full border px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-wide transition",
                          weatherPreference === v
                            ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
                            : "border-brand-cyan/20 bg-brand-white/5 text-brand-cyan/70 hover:bg-brand-white/10",
                        ].join(" ")}
                      >
                        {v === "LAST_YEAR_WEATHER" ? "Last year" : "Long-term"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 px-4 py-4 md:grid-cols-12">
                <div className="md:col-span-5">
                  <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Step 6</div>
                  <div className="mt-1 text-sm font-semibold text-brand-white">View curve</div>
                  <div className="mt-1 text-xs text-brand-cyan/70">Select which curve to display below.</div>
                </div>
                <div className="md:col-span-4">
                  {curveView !== "BASELINE" && scenarioBanner ? (
                    <div className="rounded-xl border border-brand-cyan/20 bg-brand-white/5 px-3 py-2 text-xs text-brand-cyan/80">
                      {scenarioBanner}
                    </div>
                  ) : (
                    <div className="text-xs text-brand-cyan/70">Baseline is generated automatically when requirements are met.</div>
                  )}
                </div>
                <div className="md:col-span-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCurveView("BASELINE")}
                      disabled={!baselineReady}
                      className={[
                        "rounded-full border px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-wide transition",
                        curveView === "BASELINE" && baselineReady
                          ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
                          : baselineReady
                            ? "border-brand-cyan/20 bg-brand-white/5 text-brand-cyan/70 hover:bg-brand-white/10"
                            : "cursor-not-allowed border-brand-cyan/20 bg-brand-white/5 text-brand-white/50 opacity-60",
                      ].join(" ")}
                    >
                      Baseline
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurveView("PAST")}
                      disabled={!pastReady}
                      className={[
                        "rounded-full border px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-wide transition",
                        curveView === "PAST" && pastReady
                          ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
                          : pastReady
                            ? "border-brand-cyan/20 bg-brand-white/5 text-brand-cyan/70 hover:bg-brand-white/10"
                            : "cursor-not-allowed border border-brand-cyan/20 bg-brand-white/5 text-brand-white/50 opacity-60",
                      ].join(" ")}
                    >
                      Past
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurveView("FUTURE")}
                      disabled={!futureReady}
                      className={[
                        "rounded-full border px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-wide transition",
                        curveView === "FUTURE" && futureReady
                          ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
                          : futureReady
                            ? "border-brand-cyan/20 bg-brand-white/5 text-brand-cyan/70 hover:bg-brand-white/10"
                            : "cursor-not-allowed border border-brand-cyan/20 bg-brand-white/5 text-brand-white/50 opacity-60",
                      ].join(" ")}
                    >
                      Future
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {recalcBusy || recalcNote ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="text-xs text-brand-cyan/80">{recalcBusy ? "Updating curves…" : recalcNote}</div>
          </div>
        ) : null}
      </div>

      <div id="preview">
        <UsageDashboard
          forcedMode="SIMULATED"
          allowModeToggle={false}
          initialMode="SIMULATED"
          refreshToken={refreshToken}
          simulatedHousesOverride={curveView === "BASELINE" ? null : scenarioSimHouseOverride}
          dashboardVariant={
            curveView === "BASELINE" ? "USAGE" : curveView === "PAST" ? "PAST_SIMULATED_USAGE" : "FUTURE_SIMULATED_USAGE"
          }
          pastVariables={curveView === "PAST" || curveView === "FUTURE" ? dashboardPastVariables : undefined}
          futureVariables={curveView === "FUTURE" ? dashboardFutureVariables : undefined}
        />
      </div>

      <Modal
        open={openManual}
        title="Manual usage totals"
        onClose={() => {
          setOpenManual(false);
        }}
      >
        <ManualUsageEntry
          houseId={houseId}
          onSaved={async () => {
            await recalcNow({ scenarioId: null, note: "Updating baseline…" });
          }}
        />
      </Modal>

      <Modal
        open={openHome}
        title="Home details"
        onClose={() => {
          setOpenHome(false);
        }}
      >
        <HomeDetailsClient
          houseId={houseId}
          onSaved={async () => {
            await recalcNow({ scenarioId: null, note: "Updating baseline…" });
            if (pastScenario?.id && pastEventCount > 0) await recalcNow({ scenarioId: pastScenario.id, note: "Updating Past…" });
            if (futureScenario?.id && futureEventCount > 0) await recalcNow({ scenarioId: futureScenario.id, note: "Updating Future…" });
          }}
        />
      </Modal>

      <Modal
        open={openAppliances}
        title="Appliances"
        onClose={() => {
          setOpenAppliances(false);
        }}
      >
        <AppliancesClient
          houseId={houseId}
          onSaved={async () => {
            await recalcNow({ scenarioId: null, note: "Updating baseline…" });
            if (pastScenario?.id && pastEventCount > 0) await recalcNow({ scenarioId: pastScenario.id, note: "Updating Past…" });
            if (futureScenario?.id && futureEventCount > 0) await recalcNow({ scenarioId: futureScenario.id, note: "Updating Future…" });
          }}
        />
      </Modal>

      <Modal
        open={openTimeline}
        title="Scenario timeline"
        onClose={() => {
          setOpenTimeline(false);
        }}
      >
        {scenarioId === "baseline" ? (
          <div className="text-sm text-brand-navy/70">Select or create a scenario to edit its timeline.</div>
        ) : (
          <div className="space-y-4">
            {/* UI separation: only the current workspace's scenarioId (Past or Future) is passed; no combined list. */}
            {(workspace === "PAST" || workspace === "FUTURE") && scenarioId !== "baseline" ? (
              <ScenarioUpgradesEditor
                houseId={houseId}
                scenarioId={scenarioId}
                canonicalEndMonth={canonicalEndMonth || new Date().toISOString().slice(0, 7)}
                onRecalc={() => {
                  scheduleScenarioRecalc(scenarioId);
                }}
              />
            ) : null}

            {workspace === "PAST" ? (
              <div className="rounded-2xl border border-brand-blue/10 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">
                  Travel/Vacant
                </div>
                <div className="mt-2 text-xs text-brand-navy/70">
                  Add date ranges when the home was vacant or you were away. Those days are excluded from baseline shape
                  derivation and shown as Travel/Vacant on the Past curve.
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={travelRangeStart}
                    onChange={(e) => setTravelRangeStart(e.target.value)}
                    className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
                    placeholder="Start"
                  />
                  <input
                    type="date"
                    value={travelRangeEnd}
                    onChange={(e) => setTravelRangeEnd(e.target.value)}
                    className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
                    placeholder="End"
                  />
                  <button
                    type="button"
                    disabled={!/^\d{4}-\d{2}-\d{2}$/.test(travelRangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(travelRangeEnd)}
                    onClick={() => {
                      if (/^\d{4}-\d{2}-\d{2}$/.test(travelRangeStart) && /^\d{4}-\d{2}-\d{2}$/.test(travelRangeEnd)) {
                        void addTravelRange(travelRangeStart, travelRangeEnd);
                        setTravelRangeStart("");
                        setTravelRangeEnd("");
                      }
                    }}
                    className="rounded-xl border border-brand-blue/30 bg-white px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5 disabled:opacity-50"
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
                              const newStart = String(ev.target.value ?? "").slice(0, 10);
                              const otherEnd = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : "";
                              if (/^\d{4}-\d{2}-\d{2}$/.test(newStart) && /^\d{4}-\d{2}-\d{2}$/.test(otherEnd))
                                void saveTimelineEvent(String(e.id), {
                                  effectiveMonth: newStart.slice(0, 7),
                                  payloadJson: { ...p, startDate: newStart, endDate: otherEnd },
                                });
                            }}
                            className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy md:col-span-2"
                          />
                          <input
                            type="date"
                            defaultValue={end}
                            onBlur={(ev) => {
                              const newEnd = String(ev.target.value ?? "").slice(0, 10);
                              const otherStart = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : "";
                              if (/^\d{4}-\d{2}-\d{2}$/.test(newEnd) && /^\d{4}-\d{2}-\d{2}$/.test(otherStart))
                                void saveTimelineEvent(String(e.id), {
                                  effectiveMonth: otherStart.slice(0, 7),
                                  payloadJson: { ...p, startDate: otherStart, endDate: newEnd },
                                });
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
              <button
                type="button"
                onClick={() => setShowAdvancedMonthly((s) => !s)}
                className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60 hover:text-brand-navy"
              >
                {showAdvancedMonthly ? "▼" : "▶"} Advanced monthly adjustments
              </button>
              {showAdvancedMonthly ? (
              <>
              <div className="mt-3 text-xs text-brand-navy/60">Add event (month)</div>
              <div className="mt-2 grid gap-2 md:grid-cols-5">
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

            <div className="mt-4 rounded-2xl border border-brand-blue/10 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Monthly adjustment events</div>
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
              </>
              ) : null}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}