"use client";

import * as React from "react";

export type RepOption = {
  puctNumber: number;
  name: string;
};

export interface RepSelectorProps {
  repPuctNumber: number;
  onChange: (nextPuctNumber: number) => void;
  label?: string;
  helperText?: string;
}

/**
 * RepSelector
 *
 * Minimal REP selector for SMT agreements.
 * - Today: static Just Energy (PUCT #10052).
 * - Future: can be fed from a PuctRep-backed API without changing call sites.
 */
export function RepSelector(props: RepSelectorProps) {
  const {
    repPuctNumber,
    onChange,
    label = "Retail Electric Provider",
    helperText = "This is the Retail Electric Provider we use when setting up your Smart Meter Texas subscription.",
  } = props;

  // Static options for now; shape matches future PuctRep rows.
  const options: RepOption[] = React.useMemo(
    () => [
      {
        puctNumber: 10052,
        name: "Just Energy - PUCT #10052",
      },
      // Future: populate from API / PuctRep when DB alignment is complete.
    ],
    [],
  );

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value <= 0) {
      const fallback = options[0]?.puctNumber ?? 10052;
      onChange(fallback);
      return;
    }
    onChange(value);
  };

  return (
    <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
      <label htmlFor="repPuctNumber" className="block text-xs font-semibold text-slate-900">
        {label}
      </label>
      <select
        id="repPuctNumber"
        name="repPuctNumber"
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        value={repPuctNumber}
        onChange={handleChange}
      >
        {options.map((opt) => (
          <option key={opt.puctNumber} value={opt.puctNumber}>
            {opt.name}
          </option>
        ))}
      </select>
      <p className="text-[0.7rem] text-slate-600">
        {helperText} For now, IntelliWatt uses Just Energy (PUCT #10052) as the default until additional REPs are
        enabled.
      </p>
    </div>
  );
}

