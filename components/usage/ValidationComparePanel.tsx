"use client";

import type { ReactNode } from "react";
import type { ValidationCompareRowWeather } from "@/modules/usageSimulator/compareProjection";

type ValidationCompareRow = {
  localDate: string;
  dayType: "weekday" | "weekend";
  actualDayKwh: number;
  simulatedDayKwh: number;
  errorKwh: number;
  percentError: number | null;
  weather?: ValidationCompareRowWeather;
};

function fmtTempF(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? v.toFixed(1) : "\u2014";
}

function fmtDegDay(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? v.toFixed(1) : "\u2014";
}

export function ValidationComparePanel(props: {
  rows: ValidationCompareRow[];
  metrics?: Record<string, unknown> | null;
  className?: string;
  /** When false, only the table is rendered (e.g. metrics already shown in a collapsed header). */
  showMetricsSummary?: boolean;
}) {
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const metrics = props.metrics && typeof props.metrics === "object" ? props.metrics : {};
  const showMetrics = props.showMetricsSummary !== false;
  if (rows.length === 0) return null;

  let metricsSummaryEl: ReactNode = null;
  if (showMetrics) {
    metricsSummaryEl = (
      <div className={["mt-2 text-xs text-brand-navy/80", props.className ?? ""].join(" ").trim()}>
        WAPE {Number(metrics?.wape ?? 0).toFixed(2)}% | MAE {Number(metrics?.mae ?? 0).toFixed(2)} | RMSE{" "}
        {Number(metrics?.rmse ?? 0).toFixed(2)}
      </div>
    );
  }

  return (
    <div>
      {metricsSummaryEl}
      <div className="mt-3 overflow-auto">
        <table className="min-w-full text-xs border border-brand-blue/10">
          <thead className="bg-brand-blue/5">
            <tr>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Date</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-left">Day Type</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">{`Avg \u00b0F`}</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">{`Min \u00b0F`}</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">{`Max \u00b0F`}</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">HDD65</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">CDD65</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Actual kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Sim kWh</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">Error</th>
              <th className="border border-brand-blue/10 px-2 py-1 text-right">% Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const w = row.weather;
              const wxRowMissing = !w || w.weatherMissing === true;
              return (
                <tr key={row.localDate}>
                  <td className="border border-brand-blue/10 px-2 py-1">{row.localDate}</td>
                  <td className="border border-brand-blue/10 px-2 py-1">{row.dayType}</td>
                  <td className="border border-brand-blue/10 px-2 py-1 text-right tabular-nums">
                    {wxRowMissing ? "\u2014" : fmtTempF(w.tAvgF)}
                  </td>
                  <td className="border border-brand-blue/10 px-2 py-1 text-right tabular-nums">
                    {wxRowMissing ? "\u2014" : fmtTempF(w.tMinF)}
                  </td>
                  <td className="border border-brand-blue/10 px-2 py-1 text-right tabular-nums">
                    {wxRowMissing ? "\u2014" : fmtTempF(w.tMaxF)}
                  </td>
                  <td className="border border-brand-blue/10 px-2 py-1 text-right tabular-nums">
                    {wxRowMissing ? "\u2014" : fmtDegDay(w.hdd65)}
                  </td>
                  <td className="border border-brand-blue/10 px-2 py-1 text-right tabular-nums">
                    {wxRowMissing ? "\u2014" : fmtDegDay(w.cdd65)}
                  </td>
                  <td className="border border-brand-blue/10 px-2 py-1 text-right">{Number(row.actualDayKwh ?? 0).toFixed(2)}</td>
                  <td className="border border-brand-blue/10 px-2 py-1 text-right">{Number(row.simulatedDayKwh ?? 0).toFixed(2)}</td>
                  <td className="border border-brand-blue/10 px-2 py-1 text-right">{Number(row.errorKwh ?? 0).toFixed(2)}</td>
                  <td className="border border-brand-blue/10 px-2 py-1 text-right">
                    {row.percentError == null ? "\u2014" : `${Number(row.percentError).toFixed(2)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[0.65rem] text-neutral-500">
          Weather columns use the same day-level values as the Past daily table when <code className="font-mono">dailyWeather</code> is
          available for that date (read-only context; not used for scoring).
        </p>
      </div>
    </div>
  );
}
