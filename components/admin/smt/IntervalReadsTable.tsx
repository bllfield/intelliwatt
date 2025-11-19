"use client";

import React from "react";

export interface IntervalReadRow {
  id: string;
  esiid: string | null;
  meter: string | null;
  ts: string | null;
  kwh: number | null;
  source: string | null;
}

interface IntervalReadsTableProps {
  rows: IntervalReadRow[];
}

const formatTimestamp = (value: string | null): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatNumber = (value: number | null): string => {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
};

export default function IntervalReadsTable({ rows }: IntervalReadsTableProps) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] table-auto border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left font-semibold text-foreground">
              <th className="px-3 py-2">Timestamp</th>
              <th className="px-3 py-2">ESIID</th>
              <th className="px-3 py-2">Meter</th>
              <th className="px-3 py-2 text-right">kWh</th>
              <th className="px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  No interval reads found for the current filter.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="px-3 py-2 text-foreground/80">
                    {formatTimestamp(row.ts)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-foreground/90">
                    {row.esiid ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-foreground/80">{row.meter ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-foreground/80">
                    {formatNumber(row.kwh)}
                  </td>
                  <td className="px-3 py-2 text-foreground/80">{row.source ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
