"use client";

import React, { useEffect, useMemo, useState } from "react";
import type {
  DailyCurveCompareAggregate,
  DailyCurveCompareDay,
  DailyCurveCompareSummary,
} from "@/modules/usageSimulator/dailyCurveCompareSummary";

function round(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function slotLabel(slot: number): string {
  const hour = Math.floor(slot / 4);
  const minute = (slot % 4) * 15;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildPolyline(values: number[], height: number, width: number): string {
  const maxValue = Math.max(...values, 0.0001);
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - (value / maxValue) * height;
      return `${round(x, 1)},${round(y, 1)}`;
    })
    .join(" ");
}

function normalizeSeries(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 1e-9) return values.map(() => 0);
  return values.map((value) => value / total);
}

function NormalizedCurveOverlay(props: {
  title: string;
  actualValues: number[];
  simulatedValues: number[];
  correlation: number | null;
}) {
  const actualLine = buildPolyline(props.actualValues, 180, 760);
  const simulatedLine = buildPolyline(props.simulatedValues, 180, 760);
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-brand-navy">{props.title}</div>
          <div className="mt-1 text-xs text-brand-navy/70">
            Normalized shape compare only. Each curve is scaled to a total share of 1.0 before comparison.
          </div>
        </div>
        <div className="text-xs text-brand-navy/70">
          Shape correlation: <span className="font-semibold text-brand-navy">{round(props.correlation, 3)}</span>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <svg viewBox="0 0 760 180" className="min-w-[760px]">
          <polyline fill="none" stroke="#1d4ed8" strokeWidth="3" points={actualLine} />
          <polyline fill="none" stroke="#7c3aed" strokeWidth="3" points={simulatedLine} />
        </svg>
      </div>
    </div>
  );
}

function CurveOverlay(props: { title: string; day: DailyCurveCompareDay }) {
  const actualValues = props.day.slots.map((slot) => slot.actualKwh);
  const simulatedValues = props.day.slots.map((slot) => slot.simulatedKwh);
  const deltaValues = props.day.slots.map((slot) => slot.deltaKwh);
  const actualLine = buildPolyline(actualValues, 180, 760);
  const simulatedLine = buildPolyline(simulatedValues, 180, 760);
  const maxDelta = Math.max(...deltaValues.map((value) => Math.abs(value)), 0.0001);

  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-brand-navy">{props.title}</div>
          <div className="mt-1 text-xs text-brand-navy/70">
            Actual 96-slot curve, simulated 96-slot curve, and slot delta for the scored day.
          </div>
        </div>
        <div className="text-xs text-brand-navy/70">
          Peak timing error: <span className="font-semibold text-brand-navy">{props.day.peakTimingErrorSlots} slots</span>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <svg viewBox="0 0 760 180" className="min-w-[760px]">
          <polyline fill="none" stroke="#1d4ed8" strokeWidth="3" points={actualLine} />
          <polyline fill="none" stroke="#7c3aed" strokeWidth="3" points={simulatedLine} />
        </svg>
      </div>
      <div className="mt-3 flex items-end gap-px overflow-hidden rounded border border-brand-blue/10 bg-brand-blue/5 p-2">
        {props.day.slots.map((slot) => (
          <div key={slot.slot} className="flex flex-1 flex-col items-center">
            <div
              className={`w-full rounded-sm ${slot.deltaKwh >= 0 ? "bg-amber-400/80" : "bg-sky-500/80"}`}
              style={{
                height: `${Math.max(4, (Math.abs(slot.deltaKwh) / maxDelta) * 40)}px`,
              }}
              title={`${slot.hhmm} delta ${round(slot.deltaKwh, 3)} kWh`}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs text-brand-navy/80">
          <div className="font-semibold text-brand-navy">Actual day kWh</div>
          <div className="mt-1 text-base">{round(props.day.actualDayKwh)}</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs text-brand-navy/80">
          <div className="font-semibold text-brand-navy">Simulated day kWh</div>
          <div className="mt-1 text-base">{round(props.day.simulatedDayKwh)}</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs text-brand-navy/80">
          <div className="font-semibold text-brand-navy">Peak magnitude error</div>
          <div className="mt-1 text-base">{round(props.day.peakMagnitudeErrorKwh, 3)} kWh</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs text-brand-navy/80">
          <div className="font-semibold text-brand-navy">Curve correlation</div>
          <div className="mt-1 text-base">{round(props.day.curveCorrelation, 3)}</div>
        </div>
      </div>
    </div>
  );
}

function DayDecisionPanel(props: { day: DailyCurveCompareDay }) {
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-brand-navy">Why this day looks the way it does</div>
      <div className="mt-1 text-xs text-brand-navy/70">
        Run-specific decision details tied to the selected scored/test day.
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-xs text-brand-navy/80">
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Passthrough vs modeled</div>
          <div className="mt-1">{props.day.passthroughStatus}</div>
          <div className="text-brand-navy/60">{props.day.sourceDetail ?? "source detail not attached"}</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Modeled reason code</div>
          <div className="mt-1">{props.day.modeledReasonCode ?? "not attached"}</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Daily fallback level</div>
          <div className="mt-1">{props.day.fallbackLevel ?? "not attached"}</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Shape variant</div>
          <div className="mt-1">{props.day.shapeVariantUsed ?? "not attached"}</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Weather classification</div>
          <div className="mt-1">{props.day.weatherClassification ?? "not attached"}</div>
          <div className="text-brand-navy/60">{props.day.weatherModeUsed ?? "weather mode not attached"}</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Donor selection mode</div>
          <div className="mt-1">{props.day.donorSelectionModeUsed ?? "not attached"}</div>
          <div className="text-brand-navy/60">
            Pool: {props.day.donorCandidatePoolSize ?? 0} candidate day(s)
          </div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Selected donor day(s)</div>
          <div className="mt-1">
            {props.day.selectedDonorLocalDates.length > 0
              ? props.day.selectedDonorLocalDates.join(", ")
              : "not attached"}
          </div>
          <div className="text-brand-navy/60">
            Regime: {props.day.donorWeatherRegimeUsed ?? "not attached"} | Bucket month:{" "}
            {props.day.donorMonthKeyUsed ?? "not attached"}
          </div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Thermal similarity + adjustment</div>
          <div className="mt-1">Distance: {round(props.day.thermalDistanceScore, 3)}</div>
          <div className="text-brand-navy/60">
            Broad fallback: {props.day.broadFallbackUsed ? "yes" : "no"} | Adjustment:{" "}
            {props.day.weatherAdjustmentModeUsed ?? "not attached"}
          </div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Raw-vs-compare parity</div>
          <div className="mt-1">Actual delta: {round(props.day.actualCompareParityDeltaKwh, 3)} kWh</div>
          <div>Sim delta: {round(props.day.simulatedCompareParityDeltaKwh, 3)} kWh</div>
        </div>
      </div>
    </div>
  );
}

function AggregateCard(props: {
  aggregate: DailyCurveCompareAggregate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={`rounded-xl border p-4 text-left shadow-sm transition ${
        props.selected
          ? "border-brand-blue bg-brand-blue/5"
          : "border-brand-blue/10 bg-white hover:bg-brand-blue/5"
      }`}
    >
      <div className="text-sm font-semibold text-brand-navy">{props.aggregate.label}</div>
      <div className="mt-1 text-xs text-brand-navy/65">{props.aggregate.grouping.replace(/_/g, " ")}</div>
      <div className="mt-3 grid gap-2 text-xs text-brand-navy/80">
        <div>Days: {props.aggregate.dayCount}</div>
        <div>Mean peak timing error: {round(props.aggregate.meanPeakTimingErrorSlots, 2)} slots</div>
        <div>Mean peak magnitude error: {round(props.aggregate.meanPeakMagnitudeErrorKwh, 3)} kWh</div>
        <div>Mean curve correlation: {round(props.aggregate.meanCurveCorrelation, 3)}</div>
      </div>
    </button>
  );
}

function AggregateOverlay(props: { aggregate: DailyCurveCompareAggregate | null }) {
  if (!props.aggregate) {
    return (
      <div className="rounded-xl border border-brand-blue/10 bg-white p-4 text-sm text-brand-navy/70 shadow-sm">
        Select a representative grouping to see the aggregate interval-shape overlay.
      </div>
    );
  }
  const actualValues = props.aggregate.slotSummary.map((slot) => slot.actualMeanKwh);
  const simulatedValues = props.aggregate.slotSummary.map((slot) => slot.simulatedMeanKwh);
  const actualLine = buildPolyline(actualValues, 160, 760);
  const simulatedLine = buildPolyline(simulatedValues, 160, 760);
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-brand-navy">{props.aggregate.label} representative curve overlay</div>
      <div className="mt-1 text-xs text-brand-navy/70">
        Mean 96-slot overlay built only from the selected scored/test days already attached to the artifact-backed compare surface.
      </div>
      <div className="mt-4 overflow-x-auto">
        <svg viewBox="0 0 760 160" className="min-w-[760px]">
          <polyline fill="none" stroke="#1d4ed8" strokeWidth="3" points={actualLine} />
          <polyline fill="none" stroke="#7c3aed" strokeWidth="3" points={simulatedLine} />
        </svg>
      </div>
      <div className="mt-4 max-h-52 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-brand-blue/5">
            <tr>
              <th className="px-2 py-1 text-left">Slot</th>
              <th className="px-2 py-1 text-right">Actual</th>
              <th className="px-2 py-1 text-right">Simulated</th>
              <th className="px-2 py-1 text-right">Delta</th>
            </tr>
          </thead>
          <tbody>
            {props.aggregate.slotSummary
              .filter((slot) => Math.abs(slot.deltaMeanKwh) > 0.005)
              .slice(0, 16)
              .map((slot) => (
                <tr key={slot.slot} className="border-t border-brand-blue/10">
                  <td className="px-2 py-1">{slot.hhmm}</td>
                  <td className="px-2 py-1 text-right">{round(slot.actualMeanKwh, 3)}</td>
                  <td className="px-2 py-1 text-right">{round(slot.simulatedMeanKwh, 3)}</td>
                  <td className="px-2 py-1 text-right">{round(slot.deltaMeanKwh, 3)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function GapFillDailyCurveCompare(props: {
  summary: DailyCurveCompareSummary | null;
  rawReadStatus?: string | null;
}) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedAggregateKey, setSelectedAggregateKey] = useState<string>("");
  const [viewMode, setViewMode] = useState<"raw" | "normalized">("raw");

  useEffect(() => {
    const summary = props.summary;
    if (summary?.days.length) {
      setSelectedDate((current) =>
        summary.days.some((day) => day.localDate === current)
          ? current
          : summary.days[0]!.localDate
      );
    } else {
      setSelectedDate("");
    }
  }, [props.summary]);

  useEffect(() => {
    const summary = props.summary;
    if (summary?.aggregates.length) {
      setSelectedAggregateKey((current) =>
        summary.aggregates.some((aggregate) => aggregate.key === current)
          ? current
          : summary.aggregates[0]!.key
      );
    } else {
      setSelectedAggregateKey("");
    }
  }, [props.summary]);

  const selectedDay = useMemo(
    () => props.summary?.days.find((day) => day.localDate === selectedDate) ?? null,
    [props.summary, selectedDate]
  );
  const selectedAggregate = useMemo(
    () => props.summary?.aggregates.find((aggregate) => aggregate.key === selectedAggregateKey) ?? null,
    [props.summary, selectedAggregateKey]
  );
  const normalizedSelectedDay = useMemo(() => {
    if (!selectedDay) return null;
    return {
      actual: normalizeSeries(selectedDay.slots.map((slot) => slot.actualKwh)),
      simulated: normalizeSeries(selectedDay.slots.map((slot) => slot.simulatedKwh)),
      correlation: selectedDay.curveCorrelation,
    };
  }, [selectedDay]);
  const normalizedSelectedAggregate = useMemo(() => {
    if (!selectedAggregate) return null;
    return {
      actual: normalizeSeries(selectedAggregate.slotSummary.map((slot) => slot.actualMeanKwh)),
      simulated: normalizeSeries(selectedAggregate.slotSummary.map((slot) => slot.simulatedMeanKwh)),
      correlation: selectedAggregate.meanCurveCorrelation,
    };
  }, [selectedAggregate]);

  if (!props.summary) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Daily Curve Compare appears only when GapFill already has persisted actual-vs-sim compare days plus both artifact-backed interval datasets to overlay.
        {props.rawReadStatus ? ` Raw compare read status: ${props.rawReadStatus}.` : ""}
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-brand-navy">Daily Curve Compare</h3>
        <p className="mt-1 text-sm text-brand-navy/70">
          Admin-only, read-only interval-shape diagnostic built from actual-house interval truth plus raw test-house artifact intervals for the same scored/test days.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setViewMode("raw")}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            viewMode === "raw" ? "bg-brand-blue text-white" : "border border-brand-blue/20 bg-white text-brand-navy"
          }`}
        >
          Raw Interval kWh Compare
        </button>
        <button
          type="button"
          onClick={() => setViewMode("normalized")}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            viewMode === "normalized" ? "bg-brand-blue text-white" : "border border-brand-blue/20 bg-white text-brand-navy"
          }`}
        >
          Normalized Shape Compare
        </button>
      </div>

      {viewMode === "raw" ? (
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs text-brand-navy/80">
            <div className="font-semibold text-brand-navy">Selected compare days</div>
            <div className="mt-1 text-base">{props.summary.metrics.selectedDayCount}</div>
          </div>
          <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs text-brand-navy/80">
            <div className="font-semibold text-brand-navy">Mean peak timing error</div>
            <div className="mt-1 text-base">{round(props.summary.metrics.meanPeakTimingErrorSlots, 2)} slots</div>
          </div>
          <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs text-brand-navy/80">
            <div className="font-semibold text-brand-navy">Mean peak magnitude error</div>
            <div className="mt-1 text-base">{round(props.summary.metrics.meanPeakMagnitudeErrorKwh, 3)} kWh</div>
          </div>
          <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs text-brand-navy/80">
            <div className="font-semibold text-brand-navy">Mean curve correlation</div>
            <div className="mt-1 text-base">{round(props.summary.metrics.meanCurveCorrelation, 3)}</div>
          </div>
        </div>
      ) : (
        <div className="rounded border border-brand-blue/10 bg-brand-blue/5 p-3 text-sm text-brand-navy/80">
          Normalized shape mode intentionally strips day-kWh scale. Use the raw tab for peak timing error, peak magnitude error, MAE/RMSE/Bias, and hour-block bias in kWh.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-xl border border-brand-blue/10 bg-brand-navy/5 p-4">
          <div className="text-sm font-semibold text-brand-navy">Per-day curve overlay</div>
          <div className="mt-1 text-xs text-brand-navy/70">
            Pick a scored/test day to compare actual vs simulated 15-minute intervals directly, or switch to normalized shape-only view.
          </div>
          <select
            className="mt-3 w-full rounded border border-brand-blue/20 bg-white px-3 py-2 text-sm text-brand-navy"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          >
            {props.summary.days.map((day) => (
              <option key={day.localDate} value={day.localDate}>
                {day.localDate} | {day.dayType} | {day.weatherRegime}
              </option>
            ))}
          </select>
          {selectedDay ? (
            <div className="mt-3 space-y-2 text-xs text-brand-navy/80">
              <div>Peak actual slot: {slotLabel(selectedDay.peakActualSlot)}</div>
              <div>Peak simulated slot: {slotLabel(selectedDay.peakSimulatedSlot)}</div>
              <div>Day delta: {round(selectedDay.deltaDayKwh, 3)} kWh</div>
              <div>Weather regime: {selectedDay.weatherRegime}</div>
            </div>
          ) : null}
        </div>
        {selectedDay && viewMode === "raw" ? <CurveOverlay title={`${selectedDay.localDate} raw kWh curve overlay`} day={selectedDay} /> : null}
        {selectedDay && viewMode === "normalized" && normalizedSelectedDay ? (
          <NormalizedCurveOverlay
            title={`${selectedDay.localDate} normalized shape overlay`}
            actualValues={normalizedSelectedDay.actual}
            simulatedValues={normalizedSelectedDay.simulated}
            correlation={normalizedSelectedDay.correlation}
          />
        ) : null}
      </div>

      {selectedDay ? <DayDecisionPanel day={selectedDay} /> : null}

      <div className="space-y-3">
        <div>
          <div className="text-sm font-semibold text-brand-navy">Representative-day overlays</div>
          <div className="mt-1 text-xs text-brand-navy/70">
            Aggregated from the same artifact-backed compare days only: weekday/weekend, month, season, and weather regime when weather metadata exists.
          </div>
        </div>
        <div className="grid gap-3 xl:grid-cols-4">
          {props.summary.aggregates.map((aggregate) => (
            <AggregateCard
              key={aggregate.key}
              aggregate={aggregate}
              selected={aggregate.key === selectedAggregateKey}
              onSelect={() => setSelectedAggregateKey(aggregate.key)}
            />
          ))}
        </div>
        {viewMode === "raw" ? <AggregateOverlay aggregate={selectedAggregate} /> : null}
        {viewMode === "normalized" && selectedAggregate && normalizedSelectedAggregate ? (
          <NormalizedCurveOverlay
            title={`${selectedAggregate.label} normalized representative shape`}
            actualValues={normalizedSelectedAggregate.actual}
            simulatedValues={normalizedSelectedAggregate.simulated}
            correlation={normalizedSelectedAggregate.correlation}
          />
        ) : null}
      </div>

      {viewMode === "raw" ? (
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-brand-navy">Slot-level metrics</div>
          <div className="mt-1 text-xs text-brand-navy/70">
            MAE, RMSE, and signed bias by 15-minute slot from actual vs simulated interval rows.
          </div>
          <div className="mt-3 max-h-80 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-brand-blue/5">
                <tr>
                  <th className="px-2 py-1 text-left">Slot</th>
                  <th className="px-2 py-1 text-right">MAE</th>
                  <th className="px-2 py-1 text-right">RMSE</th>
                  <th className="px-2 py-1 text-right">Bias</th>
                  <th className="px-2 py-1 text-right">N</th>
                </tr>
              </thead>
              <tbody>
                {props.summary.slotMetrics
                  .filter((slot) => slot.sampleCount > 0)
                  .sort((a, b) => b.maeKwh - a.maeKwh)
                  .slice(0, 20)
                  .map((slot) => (
                    <tr key={slot.slot} className="border-t border-brand-blue/10">
                      <td className="px-2 py-1">{slot.hhmm}</td>
                      <td className="px-2 py-1 text-right">{round(slot.maeKwh, 3)}</td>
                      <td className="px-2 py-1 text-right">{round(slot.rmseKwh, 3)}</td>
                      <td className="px-2 py-1 text-right">{round(slot.biasKwh, 3)}</td>
                      <td className="px-2 py-1 text-right">{slot.sampleCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-brand-navy">Hour-block bias summary</div>
          <div className="mt-1 text-xs text-brand-navy/70">
            Quick read on overnight baseload, morning ramp, afternoon peak, and evening tail bias.
          </div>
          <div className="mt-3 space-y-3">
            {props.summary.hourBlockBiases.map((block) => (
              <div key={block.label} className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs text-brand-navy/80">
                <div className="font-semibold text-brand-navy">{block.label}</div>
                <div className="mt-1">Mean bias: {round(block.meanBiasKwh, 3)} kWh</div>
                <div>Mean MAE: {round(block.maeKwh, 3)} kWh</div>
                <div>Slots: {slotLabel(block.startSlot)}-{slotLabel(block.endSlot)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      ) : (
        <div className="rounded-xl border border-brand-blue/10 bg-white p-4 text-sm text-brand-navy/75 shadow-sm">
          Normalized shape mode is intentionally separate from raw kWh truth. It helps compare timing and shape without conflating it with the raw interval-kWh metrics above.
        </div>
      )}
    </section>
  );
}
