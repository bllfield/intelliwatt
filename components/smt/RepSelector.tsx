"use client";

import * as React from "react";

export type RepOption = {
  id: string;
  puctNumber: string;
  legalName: string;
  dbaName: string | null;
};

export interface RepSelectorProps {
  repPuctNumber?: string;
  onChange: (nextPuctNumber: string | undefined) => void;
  label?: string;
  helperText?: string;
  requiredMessage?: string;
}

export function RepSelector(props: RepSelectorProps) {
  const {
    repPuctNumber,
    onChange,
    label = "Retail Electric Provider",
    helperText = "Select the Retail Electric Provider who issued your plan.",
    requiredMessage = "Please select a Retail Electric Provider.",
  } = props;

  const [search, setSearch] = React.useState("");
  const [options, setOptions] = React.useState<RepOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadReps() {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (search.trim()) {
          params.set("q", search.trim());
        }
        params.set("limit", "100");
        const res = await fetch(`/api/puct/reps?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled && json?.ok && Array.isArray(json.reps)) {
          setOptions(json.reps as RepOption[]);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          setLoadError("Failed to load Retail Electric Providers.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadReps();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [search]);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    onChange(value ? value : undefined);
  };

  const hasSelection = Boolean(repPuctNumber);

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
      <label htmlFor="repPuctNumber" className="block text-xs font-semibold text-slate-900">
        {label} <span className="text-red-600">*</span>
      </label>
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by REP legal name or DBA…"
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <select
        id="repPuctNumber"
        name="repPuctNumber"
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        value={repPuctNumber ?? ""}
        onChange={handleChange}
      >
        <option value="" disabled>
          Select a Retail Electric Provider…
        </option>
        {options.map((rep) => (
          <option key={rep.id} value={rep.puctNumber}>
            {rep.legalName}
            {rep.dbaName ? ` (${rep.dbaName})` : ""} – PUCT {rep.puctNumber}
          </option>
        ))}
      </select>
      {loading ? (
        <p className="text-[0.7rem] text-slate-500">Loading REPs…</p>
      ) : loadError ? (
        <p className="text-[0.7rem] text-red-600">{loadError}</p>
      ) : !hasSelection ? (
        <p className="text-[0.7rem] text-red-600">{requiredMessage}</p>
      ) : null}
      <p className="text-[0.7rem] text-slate-600">{helperText}</p>
    </div>
  );
}

