"use client";

import * as React from "react";

type ApplianceRow = {
  id: string;
  type: string;
  data: Record<string, any>;
};

type LoadResp =
  | { ok: true; houseId: string; appliances: ApplianceRow[]; updatedAt: string | null }
  | { ok: false; error: string };

const APPLIANCE_TYPES = [
  "hvac",
  "wh",
  "ev",
  "refrigerator",
  "dishwasher",
  "washer",
  "dryer",
  "oven",
  "microwave",
  "pool",
  "highload",
] as const;

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function labelType(t: string) {
  return t ? t.replace(/_/g, " ").toUpperCase() : "—";
}

function inputClass() {
  return "mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan";
}

export function AppliancesClient({ houseId }: { houseId: string }) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ApplianceRow[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/user/appliances?houseId=${encodeURIComponent(houseId)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as LoadResp | null;
        if (!res.ok || !json || json.ok !== true) throw new Error((json as any)?.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setRows(Array.isArray(json.appliances) ? json.appliances : []);
        setSavedAt(json.updatedAt ?? null);
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

  const addRow = () => setRows((r) => [...r, { id: uid(), type: "hvac", data: {} }]);
  const removeRow = (id: string) => setRows((r) => r.filter((x) => x.id !== id));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user/appliances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId, appliances: rows }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok !== true) throw new Error(json?.error || `HTTP ${res.status}`);
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
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-cyan/60">Appliances</p>
            <p className="mt-2 text-sm text-brand-cyan/80">
              Add appliances for simulated scenarios (optional now; future math hooks will plug into these profiles).
            </p>
            {savedAt ? <p className="mt-2 text-xs text-brand-cyan/60">Last saved: {new Date(savedAt).toLocaleString()}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addRow}
              className="rounded-full border border-brand-cyan/30 bg-brand-navy px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan/80 transition hover:bg-brand-cyan/5"
            >
              Add appliance
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-full border border-brand-blue/60 bg-brand-blue/15 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/25 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-200">Error: {error}</p> : null}
        {loading ? <p className="mt-3 text-sm text-brand-cyan/70">Loading…</p> : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
          <p className="text-sm text-brand-cyan/80">No appliances added yet.</p>
        </div>
      ) : null}

      {rows.map((row, idx) => (
        <div
          key={row.id}
          className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-cyan/60">
              Appliance #{idx + 1} · {labelType(row.type)}
            </p>
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="rounded-full border border-rose-300/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:bg-rose-500/15"
            >
              Remove
            </button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Type</label>
              <select
                value={row.type}
                onChange={(e) => {
                  const type = e.target.value;
                  setRows((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, type, data: {} } : r)),
                  );
                }}
                className={inputClass()}
              >
                {APPLIANCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">Age (years)</label>
              <input
                type="number"
                min={0}
                value={row.data.age ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setRows((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, data: { ...r.data, age: v } } : r)),
                  );
                }}
                className={inputClass()}
              />
            </div>

            <div className="flex items-end gap-3">
              <input
                id={`energy_star_${row.id}`}
                type="checkbox"
                checked={Boolean(row.data.energy_star)}
                onChange={(e) => {
                  setRows((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, data: { ...r.data, energy_star: e.target.checked } } : r)),
                  );
                }}
                className="h-4 w-4 accent-brand-blue"
              />
              <label htmlFor={`energy_star_${row.id}`} className="text-sm text-brand-cyan/85">
                Energy Star
              </label>
            </div>
          </div>

          {/* Minimal per-type fields (expand later without schema changes) */}
          {row.type === "ev" ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                  Miles per day
                </label>
                <input
                  type="number"
                  min={0}
                  value={row.data.miles_per_day ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    setRows((prev) =>
                      prev.map((r) => (r.id === row.id ? { ...r, data: { ...r.data, miles_per_day: v } } : r)),
                    );
                  }}
                  className={inputClass()}
                />
              </div>
              <div>
                <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                  Charger type
                </label>
                <select
                  value={row.data.charger_type ?? ""}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r) => (r.id === row.id ? { ...r, data: { ...r.data, charger_type: e.target.value } } : r)),
                    )
                  }
                  className={inputClass()}
                >
                  <option value="">Select…</option>
                  <option value="level1">Level 1</option>
                  <option value="level2">Level 2</option>
                  <option value="dc_fast">DC fast</option>
                </select>
              </div>
            </div>
          ) : null}

          {row.type === "highload" ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                  Appliance type
                </label>
                <input
                  type="text"
                  value={row.data.appliance_type ?? ""}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r) => (r.id === row.id ? { ...r, data: { ...r.data, appliance_type: e.target.value } } : r)),
                    )
                  }
                  className={inputClass()}
                  placeholder="e.g. server_rack, hot_tub, other"
                />
              </div>
              <div>
                <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                  Power (watts)
                </label>
                <input
                  type="number"
                  min={0}
                  value={row.data.power_watts ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    setRows((prev) =>
                      prev.map((r) => (r.id === row.id ? { ...r, data: { ...r.data, power_watts: v } } : r)),
                    );
                  }}
                  className={inputClass()}
                />
              </div>
              <div>
                <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                  Hours/day
                </label>
                <input
                  type="number"
                  min={0}
                  value={row.data.hours_per_day ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    setRows((prev) =>
                      prev.map((r) => (r.id === row.id ? { ...r, data: { ...r.data, hours_per_day: v } } : r)),
                    );
                  }}
                  className={inputClass()}
                />
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

