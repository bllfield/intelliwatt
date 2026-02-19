"use client";

import * as React from "react";
import { mergePrefillIntoHomeDetailsState } from "@/lib/home/prefillMerge";

type PrefillValue<T> = { value: T | null; source: "PREFILL" | "DEFAULT" | "UNKNOWN" };
type PrefillResp =
  | {
      ok: true;
      houseId: string;
      prefill: {
        homeStyle: PrefillValue<string>;
        insulationType: PrefillValue<string>;
        windowType: PrefillValue<string>;
        foundation: PrefillValue<string>;
        squareFeet: PrefillValue<number>;
        stories: PrefillValue<number>;
        homeAge: PrefillValue<number>;
        summerTemp: PrefillValue<number>;
        winterTemp: PrefillValue<number>;
      };
    }
  | { ok: false; error: string };

type LoadResp =
  | {
      ok: true;
      houseId: string;
      profile: null | {
        homeAge: number;
        homeStyle: string;
        squareFeet: number;
        stories: number;
        insulationType: string;
        windowType: string;
        foundation: string;
        ledLights: boolean;
        smartThermostat: boolean;
        summerTemp: number;
        winterTemp: number;
        occupantsWork: number;
        occupantsSchool: number;
        occupantsHomeAllDay: number;
        fuelConfiguration: string;
      };
      provenance?: any;
      prefill?: any;
      updatedAt: string | null;
    }
  | { ok: false; error: string };

type SaveResp = { ok: true; houseId: string; updatedAt: string } | { ok: false; error: string };

function friendlyErrorMessage(codeOrMessage: string): string {
  const s = String(codeOrMessage ?? "").trim();
  if (!s) return "Unknown error";
  if (s.startsWith("home_details_db_missing_env")) {
    return "Home Details service is temporarily unavailable (missing configuration). Please contact support.";
  }
  if (s.startsWith("home_details_db_unreachable") || s.startsWith("home_details_db_error_P1001")) {
    return "Home Details service is temporarily unavailable. Please try again in a moment.";
  }
  if (s.startsWith("home_details_db_permission_denied")) {
    return "Home Details service cannot save right now (permission denied). Please contact support.";
  }
  if (s.startsWith("home_details_db_timeout")) {
    return "Home Details service timed out. Please try again.";
  }
  if (s.startsWith("home_details_db_error_P2002")) {
    return "A home profile already exists for this house. Please refresh and try again.";
  }
  if (s.startsWith("home_details_db_error_")) {
    return "Home Details service error. Please try again.";
  }
  return s;
}

const HOME_STYLE = ["brick", "wood", "stucco", "metal", "manufactured"] as const;
const INSULATION = ["fiberglass", "open_cell_spray_foam", "closed_cell_spray_foam", "mineral_wool"] as const;
const WINDOW = ["single_pane", "double_pane", "triple_pane"] as const;
const FOUNDATION = ["slab", "crawlspace", "basement"] as const;
const FUEL = ["all_electric", "mixed"] as const;

function clampInt(n: unknown, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : Number(n);
  const y = Number.isFinite(x) ? x : lo;
  return Math.max(lo, Math.min(hi, y));
}

type FormState = {
  homeAge: number | "";
  homeStyle: string;
  squareFeet: number | "";
  stories: number | "";
  insulationType: string;
  windowType: string;
  foundation: string;
  ledLights: boolean;
  smartThermostat: boolean;
  summerTemp: number | "";
  winterTemp: number | "";
  occupantsWork: number | "";
  occupantsSchool: number | "";
  occupantsHomeAllDay: number | "";
  fuelConfiguration: string;
};

function emptyState(): FormState {
  return {
    homeAge: "",
    homeStyle: "",
    squareFeet: "",
    stories: "",
    insulationType: "",
    windowType: "",
    foundation: "",
    ledLights: false,
    smartThermostat: false,
    summerTemp: 73,
    winterTemp: 70,
    occupantsWork: "",
    occupantsSchool: "",
    occupantsHomeAllDay: "",
    fuelConfiguration: "",
  };
}

function applyPrefill(state: FormState, p: any): FormState {
  return mergePrefillIntoHomeDetailsState(state as any, p as any) as any;
}

export function HomeDetailsClient({ houseId, onSaved }: { houseId: string; onSaved?: () => void | Promise<void> }) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [prefill, setPrefill] = React.useState<PrefillResp | null>(null);
  const [state, setState] = React.useState<FormState>(emptyState());
  const [provenance, setProvenance] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileRes, prefillRes] = await Promise.all([
          fetch(`/api/user/home-profile?houseId=${encodeURIComponent(houseId)}`, { cache: "no-store" }),
          fetch(`/api/user/home-profile/prefill?houseId=${encodeURIComponent(houseId)}`, { cache: "no-store" }),
        ]);
        const profileJson = (await profileRes.json().catch(() => null)) as LoadResp | null;
        const prefillJson = (await prefillRes.json().catch(() => null)) as PrefillResp | null;

        if (!cancelled && prefillJson) setPrefill(prefillJson);

        if (!profileRes.ok || !profileJson || profileJson.ok !== true) {
          throw new Error((profileJson as any)?.error || `HTTP ${profileRes.status}`);
        }
        if (cancelled) return;

        setSavedAt(profileJson.updatedAt ?? null);

        if (profileJson.profile) {
          setState({
            homeAge: profileJson.profile.homeAge,
            homeStyle: profileJson.profile.homeStyle,
            squareFeet: profileJson.profile.squareFeet,
            stories: profileJson.profile.stories,
            insulationType: profileJson.profile.insulationType,
            windowType: profileJson.profile.windowType,
            foundation: profileJson.profile.foundation,
            ledLights: profileJson.profile.ledLights,
            smartThermostat: profileJson.profile.smartThermostat,
            summerTemp: profileJson.profile.summerTemp,
            winterTemp: profileJson.profile.winterTemp,
            occupantsWork: profileJson.profile.occupantsWork,
            occupantsSchool: profileJson.profile.occupantsSchool,
            occupantsHomeAllDay: profileJson.profile.occupantsHomeAllDay,
            fuelConfiguration: profileJson.profile.fuelConfiguration,
          });
          setProvenance((profileJson as any).provenance ?? {});
        } else if (prefillJson && (prefillJson as any).ok === true) {
          setState((s) => applyPrefill(s, (prefillJson as any).prefill));
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [houseId]);

  const resetToPrefill = () => {
    if (prefill && (prefill as any).ok === true) {
      setState((s) => applyPrefill(emptyState(), (prefill as any).prefill));
      setProvenance({});
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const occupantsWork = state.occupantsWork === "" ? 0 : Number(state.occupantsWork);
      const occupantsSchool = state.occupantsSchool === "" ? 0 : Number(state.occupantsSchool);
      const occupantsHomeAllDay = state.occupantsHomeAllDay === "" ? 0 : Number(state.occupantsHomeAllDay);

      const profile = {
        homeAge: state.homeAge === "" ? 0 : clampInt(state.homeAge, 0, 200),
        homeStyle: state.homeStyle,
        squareFeet: state.squareFeet === "" ? 0 : clampInt(state.squareFeet, 100, 50_000),
        stories: state.stories === "" ? 1 : clampInt(state.stories, 1, 10),
        insulationType: state.insulationType,
        windowType: state.windowType,
        foundation: state.foundation,
        ledLights: Boolean(state.ledLights),
        smartThermostat: Boolean(state.smartThermostat),
        summerTemp: state.summerTemp === "" ? 73 : clampInt(state.summerTemp, 60, 90),
        winterTemp: state.winterTemp === "" ? 70 : clampInt(state.winterTemp, 50, 80),
        occupantsWork: clampInt(occupantsWork, 0, 50),
        occupantsSchool: clampInt(occupantsSchool, 0, 50),
        occupantsHomeAllDay: clampInt(occupantsHomeAllDay, 0, 50),
        fuelConfiguration: state.fuelConfiguration,
      };

      const res = await fetch("/api/user/home-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId,
          profile,
          provenance,
          prefill: prefill && (prefill as any).ok === true ? (prefill as any).prefill : null,
        }),
      });
      const json = (await res.json().catch(() => null)) as SaveResp | null;
      if (!res.ok || !json || (json as any).ok === false) {
        throw new Error(friendlyErrorMessage((json as any)?.error || `HTTP ${res.status}`));
      }
      setSavedAt((json as any).updatedAt ?? new Date().toISOString());

      // Award entry (client-side best-effort; server-side status refresh can also compute later).
      try {
        const stored = localStorage.getItem("intelliwatt_home_details_complete");
        if (stored !== "true") {
          await fetch("/api/user/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "home_details_complete", amount: 1, houseId }),
          });
          window.dispatchEvent(new CustomEvent("entriesUpdated"));
          localStorage.setItem("intelliwatt_home_details_complete", "true");
        }
      } catch {
        // ignore
      }

      if (onSaved) await Promise.resolve(onSaved());
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const occupantsTotal =
    (state.occupantsWork === "" ? 0 : Number(state.occupantsWork)) +
    (state.occupantsSchool === "" ? 0 : Number(state.occupantsSchool)) +
    (state.occupantsHomeAllDay === "" ? 0 : Number(state.occupantsHomeAllDay));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-cyan/60">Home profile</p>
            <p className="mt-2 text-sm text-brand-cyan/80">
              Add a few details to power simulated usage and future what‑if scenarios.
            </p>
            {savedAt ? <p className="mt-2 text-xs text-brand-cyan/60">Last saved: {new Date(savedAt).toLocaleString()}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetToPrefill}
              className="rounded-full border border-brand-cyan/30 bg-brand-navy px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan/80 transition hover:bg-brand-cyan/5"
              disabled={!prefill || (prefill as any).ok !== true}
            >
              Reset to prefill
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-full border border-brand-blue/60 bg-brand-blue/15 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:bg-brand-blue/25 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-200">Error: {error}</p> : null}
        {loading ? <p className="mt-3 text-sm text-brand-cyan/70">Loading…</p> : null}
      </div>

      <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Home age</label>
            <input
              type="number"
              min={0}
              max={200}
              value={state.homeAge}
              onChange={(e) => setState((s) => ({ ...s, homeAge: e.target.value === "" ? "" : Number(e.target.value) }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            />
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Home style</label>
            <select
              value={state.homeStyle}
              onChange={(e) => setState((s) => ({ ...s, homeStyle: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            >
              <option value="">Select…</option>
              {HOME_STYLE.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Square feet</label>
            <input
              type="number"
              min={100}
              max={50000}
              value={state.squareFeet}
              onChange={(e) => setState((s) => ({ ...s, squareFeet: e.target.value === "" ? "" : Number(e.target.value) }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            />
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Stories</label>
            <input
              type="number"
              min={1}
              max={10}
              value={state.stories}
              onChange={(e) => setState((s) => ({ ...s, stories: e.target.value === "" ? "" : Number(e.target.value) }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            />
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Insulation</label>
            <select
              value={state.insulationType}
              onChange={(e) => setState((s) => ({ ...s, insulationType: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            >
              <option value="">Select…</option>
              {INSULATION.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Windows</label>
            <select
              value={state.windowType}
              onChange={(e) => setState((s) => ({ ...s, windowType: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            >
              <option value="">Select…</option>
              {WINDOW.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Foundation</label>
            <select
              value={state.foundation}
              onChange={(e) => setState((s) => ({ ...s, foundation: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            >
              <option value="">Select…</option>
              {FOUNDATION.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Fuel configuration</label>
            <select
              value={state.fuelConfiguration}
              onChange={(e) => setState((s) => ({ ...s, fuelConfiguration: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            >
              <option value="">Select…</option>
              {FUEL.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Summer temp (°F)</label>
            <input
              type="number"
              min={60}
              max={90}
              value={state.summerTemp}
              onChange={(e) => setState((s) => ({ ...s, summerTemp: e.target.value === "" ? "" : Number(e.target.value) }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            />
          </div>

          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Winter temp (°F)</label>
            <input
              type="number"
              min={50}
              max={80}
              value={state.winterTemp}
              onChange={(e) => setState((s) => ({ ...s, winterTemp: e.target.value === "" ? "" : Number(e.target.value) }))}
              className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
            />
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center gap-3">
            <input
              id="ledLights"
              type="checkbox"
              checked={state.ledLights}
              onChange={(e) => setState((s) => ({ ...s, ledLights: e.target.checked }))}
              className="h-4 w-4 accent-brand-blue"
            />
            <label htmlFor="ledLights" className="text-sm text-brand-cyan/85">
              LED lights
            </label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="smartThermostat"
              type="checkbox"
              checked={state.smartThermostat}
              onChange={(e) => setState((s) => ({ ...s, smartThermostat: e.target.checked }))}
              className="h-4 w-4 accent-brand-blue"
            />
            <label htmlFor="smartThermostat" className="text-sm text-brand-cyan/85">
              Smart thermostat
            </label>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-brand-cyan/15 bg-brand-navy px-5 py-5">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Occupants</p>
          <p className="mt-2 text-xs text-brand-cyan/70">Must sum to at least 1.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Work</label>
              <input
                type="number"
                min={0}
                value={state.occupantsWork}
                onChange={(e) => setState((s) => ({ ...s, occupantsWork: e.target.value === "" ? "" : Number(e.target.value) }))}
                className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
              />
            </div>
            <div>
              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">School</label>
              <input
                type="number"
                min={0}
                value={state.occupantsSchool}
                onChange={(e) => setState((s) => ({ ...s, occupantsSchool: e.target.value === "" ? "" : Number(e.target.value) }))}
                className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
              />
            </div>
            <div>
              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Home all day</label>
              <input
                type="number"
                min={0}
                value={state.occupantsHomeAllDay}
                onChange={(e) => setState((s) => ({ ...s, occupantsHomeAllDay: e.target.value === "" ? "" : Number(e.target.value) }))}
                className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
              />
            </div>
          </div>
          <p className={`mt-3 text-xs ${occupantsTotal > 0 ? "text-emerald-200" : "text-rose-200"}`}>
            Total occupants: {occupantsTotal}
          </p>
        </div>
      </div>
    </div>
  );
}

