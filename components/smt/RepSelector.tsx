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
  preferredProviderName?: string | null;
  label?: string;
  helperText?: string;
  requiredMessage?: string;
}

export function RepSelector(props: RepSelectorProps) {
  const {
    repPuctNumber,
    onChange,
    preferredProviderName,
    label = "Retail Electric Provider",
    helperText = "Select the Retail Electric Provider who issued your plan.",
    requiredMessage = "Please select a Retail Electric Provider.",
  } = props;

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
        // Load a base list for browsing, but also do a targeted query when we have a preferred provider
        // or a prefilled PUCT number so the correct REP is guaranteed to be in the options.
        const merged: RepOption[] = [];
        const seen = new Set<string>();
        const add = (rows: any) => {
          const list = Array.isArray(rows) ? (rows as RepOption[]) : [];
          for (const r of list) {
            const id = String((r as any)?.id ?? "");
            if (!id || seen.has(id)) continue;
            seen.add(id);
            merged.push(r);
          }
        };

        const fetchReps = async (params: URLSearchParams) => {
          const res = await fetch(`/api/puct/reps?${params.toString()}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `HTTP ${res.status}`);
          }
          const json = await res.json();
          if (json?.ok && Array.isArray(json.reps)) add(json.reps);
        };

        // Base list (small)
        const baseParams = new URLSearchParams();
        baseParams.set("limit", "200");
        await fetchReps(baseParams);

        // Targeted list (by provider name)
        if (preferredProviderName && preferredProviderName.trim()) {
          const qParams = new URLSearchParams();
          qParams.set("q", preferredProviderName.trim());
          qParams.set("limit", "200");
          await fetchReps(qParams);
        }

        // Targeted list (by PUCT number)
        if (repPuctNumber && repPuctNumber.trim()) {
          const qParams = new URLSearchParams();
          qParams.set("q", repPuctNumber.trim());
          qParams.set("limit", "200");
          await fetchReps(qParams);
        }

        if (!cancelled) {
          setOptions(merged);
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
  }, [preferredProviderName, repPuctNumber]);

  React.useEffect(() => {
    if (repPuctNumber) return;
    if (!preferredProviderName || !preferredProviderName.trim()) return;
    if (!Array.isArray(options) || options.length === 0) return;

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const target = norm(preferredProviderName);
    if (!target) return;

    // Try to match against legal name / DBA name. Only auto-pick if we find a clear match.
    const matches = options.filter((rep) => {
      const legal = norm(rep.legalName ?? "");
      const dba = norm(rep.dbaName ?? "");
      if (!legal && !dba) return false;
      return (
        legal === target ||
        dba === target ||
        (legal.length >= 6 && target.length >= 6 && (legal.includes(target) || target.includes(legal))) ||
        (dba.length >= 6 && target.length >= 6 && (dba.includes(target) || target.includes(dba)))
      );
    });

    if (matches.length === 1) {
      onChange(matches[0]!.puctNumber);
      return;
    }

    // If multiple, prefer exact legalName match.
    const exactLegal = matches.find((rep) => norm(rep.legalName ?? "") === target);
    if (exactLegal) {
      onChange(exactLegal.puctNumber);
    }
  }, [repPuctNumber, preferredProviderName, options, onChange]);

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
      <select
        id="repPuctNumber"
        name="repPuctNumber"
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        value={repPuctNumber ?? ""}
        onChange={handleChange}
      >
        <option value="" disabled>
          Select your Retail Electric Provider…
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

