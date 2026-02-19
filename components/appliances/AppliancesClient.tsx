"use client";

import * as React from "react";

type ApplianceRow = {
  id: string;
  type: string;
  data: Record<string, any>;
};

type LoadResp =
  | {
      ok: true;
      houseId: string;
      profile?: { version?: number; fuelConfiguration?: string; appliances?: ApplianceRow[] } | null;
      appliances?: ApplianceRow[];
      fuelConfiguration?: string;
      updatedAt: string | null;
    }
  | { ok: false; error: string };

type ApplianceType =
  | "hvac"
  | "wh"
  | "ev"
  | "refrigerator"
  | "dishwasher"
  | "washer"
  | "dryer"
  | "oven"
  | "microwave"
  | "pool"
  | "highload";

type FuelConfiguration = "" | "all_electric" | "mixed";

function friendlyErrorMessage(codeOrMessage: string): string {
  const s = String(codeOrMessage ?? "").trim();
  if (!s) return "Unknown error";
  if (s.startsWith("appliances_db_missing_env")) {
    return "Appliances service is temporarily unavailable (missing configuration). Please contact support.";
  }
  if (s.startsWith("appliances_db_unreachable") || s.startsWith("appliances_db_error_P1001")) {
    return "Appliances service is temporarily unavailable. Please try again in a moment.";
  }
  if (s.startsWith("appliances_db_permission_denied")) {
    return "Appliances service cannot save right now (permission denied). Please contact support.";
  }
  if (s.startsWith("appliances_db_timeout")) {
    return "Appliances service timed out. Please try again.";
  }
  if (s.startsWith("appliances_db_error_P2002")) {
    return "An appliances profile already exists for this house. Please refresh and try again.";
  }
  if (s.startsWith("appliances_db_error_")) {
    return "Appliances service error. Please try again.";
  }
  return s;
}

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function inputClass() {
  return "mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan";
}

function checkboxClass() {
  return "h-4 w-4 accent-brand-blue";
}

function requireNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function normalizeServerProfile(json: LoadResp | null): { fuelConfiguration: FuelConfiguration; appliances: ApplianceRow[] } {
  if (!json || (json as any).ok !== true) return { fuelConfiguration: "", appliances: [] };
  const profileAny = (json as any).profile ?? null;
  const fuel =
    (requireNonEmptyString(profileAny?.fuelConfiguration) ??
      requireNonEmptyString((json as any).fuelConfiguration) ??
      "") as FuelConfiguration;
  const appliances = Array.isArray(profileAny?.appliances)
    ? (profileAny.appliances as ApplianceRow[])
    : Array.isArray((json as any).appliances)
      ? ((json as any).appliances as ApplianceRow[])
      : [];
  return { fuelConfiguration: fuel, appliances };
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M9 3h6m-8 4h10m-9 0 1 14h6l1-14M10 11v7m4-7v7M6 7h12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type FieldDef =
  | {
      key: string;
      label: string;
      kind: "text" | "number";
      placeholder?: string;
      min?: number;
      step?: number;
      suffix?: string;
      showWhen?: (data: Record<string, any>) => boolean;
    }
  | {
      key: string;
      label: string;
      kind: "select";
      options: { value: string; label: string }[];
      placeholder?: string;
      showWhen?: (data: Record<string, any>) => boolean;
    }
  | {
      key: string;
      label: string;
      kind: "checkbox";
      showWhen?: (data: Record<string, any>) => boolean;
    };

type CategoryDef = {
  type: ApplianceType;
  title: string;
  addLabel: string;
  fields: FieldDef[];
};

const CATEGORIES: CategoryDef[] = [
  {
    type: "hvac",
    title: "HVAC",
    addLabel: "Add HVAC",
    fields: [
      {
        key: "system_type",
        label: "System type",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "central", label: "Central" },
          { value: "heat_pump", label: "Heat pump" },
          { value: "mini_split", label: "Mini split" },
          { value: "window", label: "Window" },
          { value: "portable", label: "Portable" },
        ],
      },
      {
        key: "heat_source",
        label: "Heat source",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "electric", label: "Electric" },
          { value: "gas", label: "Gas" },
          { value: "heat_pump", label: "Heat pump" },
        ],
      },
      { key: "age", label: "Age (years)", kind: "number", min: 0 },
      { key: "seer", label: "SEER", kind: "number", min: 0, step: 0.1 },
      { key: "tonnage", label: "Tonnage", kind: "number", min: 0, step: 0.1 },
      { key: "btu", label: "BTU", kind: "number", min: 0, step: 1 },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "wh",
    title: "Water Heater",
    addLabel: "Add Water Heater",
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "tank", label: "Tank" },
          { value: "tankless", label: "Tankless" },
          { value: "heat_pump", label: "Heat pump" },
          { value: "solar", label: "Solar" },
          { value: "indirect", label: "Indirect" },
        ],
      },
      {
        key: "fuel_type",
        label: "Fuel type",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "electric", label: "Electric" },
          { value: "gas", label: "Gas" },
          { value: "propane", label: "Propane" },
          { value: "oil", label: "Oil" },
          { value: "solar", label: "Solar" },
        ],
      },
      {
        key: "heat_source",
        label: "Heat source",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "electric", label: "Electric" },
          { value: "gas", label: "Gas" },
          { value: "heat_pump", label: "Heat pump" },
          { value: "solar", label: "Solar" },
        ],
      },
      { key: "age", label: "Age (years)", kind: "number", min: 0 },
      {
        key: "tank_size",
        label: "Tank size (gallons)",
        kind: "number",
        min: 0,
        showWhen: (d) => String(d?.type ?? "") !== "tankless",
      },
      {
        key: "flow_rate",
        label: "Flow rate (GPM)",
        kind: "number",
        min: 0,
        step: 0.1,
        showWhen: (d) => String(d?.type ?? "") === "tankless",
      },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "ev",
    title: "EV Charger",
    addLabel: "Add EV Charger",
    fields: [
      {
        key: "vehicle_model",
        label: "Vehicle model",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "tesla", label: "Tesla" },
          { value: "chevy", label: "Chevy" },
          { value: "nissan", label: "Nissan" },
          { value: "ford", label: "Ford" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "vehicle_model_other",
        label: "Other vehicle model",
        kind: "text",
        placeholder: "Enter model…",
        showWhen: (d) => String(d?.vehicle_model ?? "") === "other",
      },
      { key: "miles_per_day", label: "Miles per day", kind: "number", min: 0, step: 1 },
      {
        key: "charger_type",
        label: "Charger type",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "level1", label: "Level 1" },
          { value: "level2", label: "Level 2" },
          { value: "dc_fast", label: "DC fast" },
        ],
      },
      {
        key: "charging_location",
        label: "Charging location",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "garage", label: "Garage" },
          { value: "driveway", label: "Driveway" },
          { value: "street", label: "Street" },
        ],
      },
      {
        key: "charging_schedule",
        label: "Charging schedule",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "overnight", label: "Overnight" },
          { value: "daytime", label: "Daytime" },
          { value: "flexible", label: "Flexible" },
        ],
      },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "refrigerator",
    title: "Refrigerator",
    addLabel: "Add Refrigerator",
    fields: [
      { key: "age", label: "Age (years)", kind: "number", min: 0 },
      { key: "capacity", label: "Capacity (cu ft)", kind: "number", min: 0, step: 0.1 },
      { key: "garage_location", label: "Garage location", kind: "checkbox" },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "dishwasher",
    title: "Dishwasher",
    addLabel: "Add Dishwasher",
    fields: [
      { key: "age", label: "Age (years)", kind: "number", min: 0 },
      { key: "loads_per_week", label: "Loads per week", kind: "number", min: 0, step: 1 },
      {
        key: "usage_pattern",
        label: "Usage pattern",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "morning", label: "Morning" },
          { value: "evening", label: "Evening" },
          { value: "flexible", label: "Flexible" },
        ],
      },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "washer",
    title: "Washer",
    addLabel: "Add Washer",
    fields: [
      { key: "age", label: "Age (years)", kind: "number", min: 0 },
      { key: "loads_per_week", label: "Loads per week", kind: "number", min: 0, step: 1 },
      {
        key: "usage_pattern",
        label: "Usage pattern",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "morning", label: "Morning" },
          { value: "evening", label: "Evening" },
          { value: "flexible", label: "Flexible" },
        ],
      },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "dryer",
    title: "Dryer",
    addLabel: "Add Dryer",
    fields: [
      {
        key: "fuel_type",
        label: "Fuel type",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "electric", label: "Electric" },
          { value: "gas", label: "Gas" },
          { value: "propane", label: "Propane" },
        ],
      },
      { key: "age", label: "Age (years)", kind: "number", min: 0 },
      { key: "loads_per_week", label: "Loads per week", kind: "number", min: 0, step: 1 },
      {
        key: "usage_pattern",
        label: "Usage pattern",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "morning", label: "Morning" },
          { value: "evening", label: "Evening" },
          { value: "flexible", label: "Flexible" },
        ],
      },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "oven",
    title: "Oven/Range",
    addLabel: "Add Oven/Range",
    fields: [
      {
        key: "fuel_type",
        label: "Fuel type",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "electric", label: "Electric" },
          { value: "gas", label: "Gas" },
          { value: "propane", label: "Propane" },
          { value: "induction", label: "Induction" },
        ],
      },
      { key: "age", label: "Age (years)", kind: "number", min: 0 },
      { key: "weekday_hours", label: "Weekday hours (morning)", kind: "number", min: 0, step: 0.1 },
      { key: "weekend_hours", label: "Weekend hours (afternoon)", kind: "number", min: 0, step: 0.1 },
      {
        key: "usage_pattern",
        label: "Usage pattern",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "morning", label: "Morning" },
          { value: "evening", label: "Evening" },
          { value: "flexible", label: "Flexible" },
        ],
      },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "microwave",
    title: "Microwave",
    addLabel: "Add Microwave",
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "countertop", label: "Countertop" },
          { value: "built_in", label: "Built-in" },
          { value: "over_the_range", label: "Over the range" },
          { value: "drawer", label: "Drawer" },
        ],
      },
      { key: "age", label: "Age (years)", kind: "number", min: 0 },
      { key: "wattage", label: "Wattage", kind: "number", min: 0, step: 1 },
      { key: "usage_frequency", label: "Usage frequency (hours/week)", kind: "number", min: 0, step: 0.1 },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "pool",
    title: "Pool Equipment",
    addLabel: "Add Pool Equipment",
    fields: [
      { key: "pool_size", label: "Pool size (gallons)", kind: "number", min: 0, step: 1 },
      {
        key: "pump_type",
        label: "Pump type",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "single_speed", label: "Single speed" },
          { value: "dual_speed", label: "Dual speed" },
          { value: "variable_speed", label: "Variable speed" },
        ],
      },
      { key: "pump_hp", label: "Pump HP", kind: "number", min: 0, step: 0.1 },
      { key: "has_heater", label: "Has heater", kind: "checkbox" },
      {
        key: "heater_type",
        label: "Heater type",
        kind: "select",
        showWhen: (d) => Boolean(d?.has_heater),
        options: [
          { value: "", label: "Select…" },
          { value: "gas", label: "Gas" },
          { value: "electric", label: "Electric" },
          { value: "heat_pump", label: "Heat pump" },
          { value: "solar", label: "Solar" },
        ],
      },
      { key: "summer_run_time", label: "Summer run time (hours/day)", kind: "number", min: 0, step: 0.1 },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
    ],
  },
  {
    type: "highload",
    title: "High-Load Appliance",
    addLabel: "Add High-Load Appliance",
    fields: [
      {
        key: "appliance_type",
        label: "Appliance type",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "well_pump", label: "Well pump" },
          { value: "septic_system", label: "Septic system" },
          { value: "shop_equipment", label: "Shop equipment" },
          { value: "server_rack", label: "Server rack" },
          { value: "arcade_machines", label: "Arcade machines" },
          { value: "aquarium", label: "Aquarium" },
          { value: "hot_tub", label: "Hot tub" },
          { value: "sauna", label: "Sauna" },
          { value: "workshop_tools", label: "Workshop tools" },
          { value: "gym_equipment", label: "Gym equipment" },
          { value: "air_compressor", label: "Air compressor" },
          { value: "mini_split", label: "Mini split" },
          { value: "subzero_fridge", label: "Sub-Zero fridge" },
          { value: "dehumidifier", label: "Dehumidifier" },
          { value: "air_purifier", label: "Air purifier" },
          { value: "ozone_generator", label: "Ozone generator" },
          { value: "exhaust_system", label: "Exhaust system" },
          { value: "heated_garage", label: "Heated garage" },
          { value: "home_theater", label: "Home theater" },
          { value: "electric_kiln", label: "Electric kiln" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "other_name",
        label: "Other name",
        kind: "text",
        placeholder: "Enter name…",
        showWhen: (d) => String(d?.appliance_type ?? "") === "other",
      },
      { key: "description", label: "Model / description", kind: "text", placeholder: "Optional…" },
      { key: "wattage", label: "Wattage", kind: "number", min: 0, step: 1 },
      { key: "hours_per_day", label: "Hours per day", kind: "number", min: 0, step: 0.1 },
      { key: "days_per_week", label: "Days per week", kind: "number", min: 0, step: 1 },
      { key: "quantity", label: "Quantity", kind: "number", min: 0, step: 1 },
      { key: "age", label: "Age (years)", kind: "number", min: 0, step: 1 },
      {
        key: "seasonal_use",
        label: "Seasonal use",
        kind: "select",
        options: [
          { value: "", label: "Select…" },
          { value: "year_round", label: "Year round" },
          { value: "summer_only", label: "Summer only" },
          { value: "winter_only", label: "Winter only" },
          { value: "spring_fall", label: "Spring/Fall" },
          { value: "occasional", label: "Occasional" },
        ],
      },
      { key: "energy_star", label: "Energy Star", kind: "checkbox" },
      { key: "smart_appliance", label: "Smart appliance", kind: "checkbox" },
    ],
  },
];

export function AppliancesClient({ houseId, onSaved }: { houseId: string; onSaved?: () => void | Promise<void> }) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [fuelConfiguration, setFuelConfiguration] = React.useState<FuelConfiguration>("");
  const [rows, setRows] = React.useState<ApplianceRow[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/user/appliances?houseId=${encodeURIComponent(houseId)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as LoadResp | null;
        if (!res.ok || !json || json.ok !== true) throw new Error(friendlyErrorMessage((json as any)?.error || `HTTP ${res.status}`));
        if (cancelled) return;
        const normalized = normalizeServerProfile(json);
        setRows(normalized.appliances);
        setFuelConfiguration(normalized.fuelConfiguration);
        setSavedAt(json.updatedAt ?? null);
      } catch (e: any) {
        if (!cancelled) setError(friendlyErrorMessage(e?.message || "Failed to load"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [houseId]);

  const removeRow = (id: string) => setRows((r) => r.filter((x) => x.id !== id));
  const addUnit = (type: ApplianceType) => setRows((r) => [...r, { id: uid(), type, data: {} }]);
  const setRowData = (id: string, patch: Record<string, any>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, data: { ...r.data, ...patch } } : r)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!requireNonEmptyString(fuelConfiguration)) {
        throw new Error("Please select a fuel configuration before saving.");
      }
      const res = await fetch("/api/user/appliances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId, profile: { version: 1, fuelConfiguration, appliances: rows } }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok !== true) {
        throw new Error(friendlyErrorMessage(json?.error || `HTTP ${res.status}`));
      }
      setSavedAt(json.updatedAt ?? new Date().toISOString());

      // Best-effort entry award.
      try {
        const stored = localStorage.getItem("intelliwatt_appliances_complete");
        if (stored !== "true") {
          await fetch("/api/user/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "appliance_details_complete", amount: 1, houseId }),
          });
          window.dispatchEvent(new CustomEvent("entriesUpdated"));
          localStorage.setItem("intelliwatt_appliances_complete", "true");
        }
      } catch {
        // ignore
      }

      if (onSaved) await Promise.resolve(onSaved());
    } catch (e: any) {
      setError(friendlyErrorMessage(e?.message || "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const unknownRows = rows.filter((r) => !CATEGORIES.some((c) => c.type === (r.type as any)));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-cyan/60">Appliances</p>
            <p className="mt-2 text-sm text-brand-cyan/80">
              Add appliances for simulated scenarios and future what‑if modeling. Per‑appliance fields are optional; the only required field to save is
              fuel configuration.
            </p>
            {savedAt ? <p className="mt-2 text-xs text-brand-cyan/60">Last saved: {new Date(savedAt).toLocaleString()}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
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

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
              Fuel configuration <span className="text-rose-200/90">*</span>
            </label>
            <select
              value={fuelConfiguration}
              onChange={(e) => setFuelConfiguration(e.target.value as FuelConfiguration)}
              className={inputClass()}
            >
              <option value="">Select…</option>
              <option value="all_electric">All electric</option>
              <option value="mixed">Mixed (electric + gas/other)</option>
            </select>
            <p className="mt-2 text-xs text-brand-cyan/60">Required before saving. Appliance details are optional.</p>
          </div>
        </div>
      </div>

      {CATEGORIES.map((cat) => {
        const units = rows.filter((r) => r.type === cat.type);
        return (
          <div
            key={cat.type}
            className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-cyan/60">{cat.title}</p>
                <p className="mt-2 text-sm text-brand-cyan/75">
                  Add one or more {cat.title.toLowerCase()} units. All fields optional.
                </p>
              </div>
              <button
                type="button"
                onClick={() => addUnit(cat.type)}
                className="rounded-full border border-brand-cyan/30 bg-brand-navy px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan/80 transition hover:bg-brand-cyan/5"
              >
                {cat.addLabel}
              </button>
            </div>

            {units.length === 0 ? (
              <p className="mt-4 text-sm text-brand-cyan/70">No units added.</p>
            ) : (
              <div className="mt-5 space-y-5">
                {units.map((unit, idx) => (
                  <div key={unit.id} className="rounded-2xl border border-brand-cyan/20 bg-brand-navy/60 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-cyan/60">
                        {cat.title} #{idx + 1}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeRow(unit.id)}
                        className="inline-flex items-center gap-2 rounded-full border border-rose-300/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:bg-rose-500/15"
                        aria-label={`Remove ${cat.title} ${idx + 1}`}
                        title="Remove"
                      >
                        <TrashIcon />
                        Remove
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {cat.fields
                        .filter((f) => (typeof (f as any).showWhen === "function" ? (f as any).showWhen(unit.data) : true))
                        .map((field) => {
                          if (field.kind === "checkbox") {
                            const id = `${cat.type}_${field.key}_${unit.id}`;
                            return (
                              <div key={field.key} className="flex items-end gap-3">
                                <input
                                  id={id}
                                  type="checkbox"
                                  checked={Boolean(unit.data[field.key])}
                                  onChange={(e) => setRowData(unit.id, { [field.key]: e.target.checked })}
                                  className={checkboxClass()}
                                />
                                <label htmlFor={id} className="text-sm text-brand-cyan/85">
                                  {field.label}
                                </label>
                              </div>
                            );
                          }

                          if (field.kind === "select") {
                            return (
                              <div key={field.key}>
                                <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                                  {field.label}
                                </label>
                                <select
                                  value={String(unit.data[field.key] ?? "")}
                                  onChange={(e) => setRowData(unit.id, { [field.key]: e.target.value })}
                                  className={inputClass()}
                                >
                                  {field.options.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          }

                          const value = unit.data[field.key];
                          const inputValue =
                            value === null || value === undefined ? "" : field.kind === "number" ? String(value) : String(value);

                          return (
                            <div key={field.key}>
                              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                                {field.label}
                              </label>
                              <input
                                type={field.kind === "number" ? "number" : "text"}
                                min={field.kind === "number" ? field.min : undefined}
                                step={field.kind === "number" ? field.step : undefined}
                                value={inputValue}
                                placeholder={field.kind === "text" ? field.placeholder : undefined}
                                onChange={(e) => {
                                  if (field.kind === "number") {
                                    const v = e.target.value === "" ? null : Number(e.target.value);
                                    setRowData(unit.id, { [field.key]: v });
                                  } else {
                                    setRowData(unit.id, { [field.key]: e.target.value });
                                  }
                                }}
                                className={inputClass()}
                              />
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {unknownRows.length ? (
        <div className="rounded-3xl border border-amber-200/40 bg-amber-100/10 p-6 text-amber-100 shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/70">Legacy / Unknown rows</p>
          <p className="mt-2 text-sm text-amber-100/80">
            These were saved under older schemas or unknown types. You can remove them if they’re not needed.
          </p>
          <div className="mt-4 space-y-3">
            {unknownRows.map((r, idx) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200/30 bg-amber-100/5 px-4 py-3">
                <p className="text-sm text-amber-100/80">
                  Row #{idx + 1} · <span className="font-semibold">{String(r.type ?? "—")}</span>
                </p>
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  className="inline-flex items-center gap-2 rounded-full border border-rose-300/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:bg-rose-500/15"
                >
                  <TrashIcon />
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

