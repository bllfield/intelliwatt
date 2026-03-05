/**
 * Sim Platform Contract — overlay application and clamp helpers.
 * kwh_final[t] = clamp0(kwh_base[t] + Σ overlayDelta[t])
 */

import { canonicalIntervalKey } from "./time";
import type { IntervalDataset, IntervalPoint, OverlayResult } from "./types";

/**
 * Apply overlays in order to base dataset. Sums deltas per tsIso, then clamps negative to 0.
 * Returns new dataset plus clamp diagnostics.
 */
export function applyOverlays(
  base: IntervalDataset,
  overlays: OverlayResult[]
): { dataset: IntervalDataset; clampedCount: number; clampedSample: string[] } {
  const deltaByTs = new Map<string, number>();
  for (const p of base.points) {
    const tsIso = p?.tsIso ?? "";
    const key = canonicalIntervalKey(tsIso);
    const mapKey = key || tsIso;
    if (mapKey) deltaByTs.set(mapKey, Number(p?.kwh) ?? 0);
  }
  for (const ov of overlays) {
    for (const d of ov.deltas ?? []) {
      const tsIso = d?.tsIso ?? "";
      const key = canonicalIntervalKey(tsIso);
      const mapKey = key || tsIso;
      if (mapKey) deltaByTs.set(mapKey, (deltaByTs.get(mapKey) ?? 0) + (Number(d?.deltaKwh) ?? 0));
    }
  }
  const points: IntervalPoint[] = [];
  let clampedCount = 0;
  const clampedSample: string[] = [];
  for (const [tsIso, kwh] of Array.from(deltaByTs.entries())) {
    const clamped = Math.max(0, kwh);
    if (kwh < 0) {
      clampedCount++;
      if (clampedSample.length < 10) clampedSample.push(tsIso);
    }
    points.push({ tsIso, kwh: clamped });
  }
  return {
    dataset: { kind: base.kind, points, meta: { ...base.meta } },
    clampedCount,
    clampedSample,
  };
}

/**
 * Clamp negative kWh to 0 in place (returns new array). Returns clamp diagnostics.
 */
export function clampToZero(
  points: IntervalPoint[]
): { points: IntervalPoint[]; clampedCount: number; clampedSample: string[] } {
  const out: IntervalPoint[] = [];
  let clampedCount = 0;
  const clampedSample: string[] = [];
  for (const p of points) {
    const kwh = Number(p?.kwh) ?? 0;
    const clamped = Math.max(0, kwh);
    if (kwh < 0) {
      clampedCount++;
      if (clampedSample.length < 10) clampedSample.push(p?.tsIso ?? "");
    }
    out.push({ tsIso: p?.tsIso ?? "", kwh: clamped });
  }
  return { points: out, clampedCount, clampedSample };
}