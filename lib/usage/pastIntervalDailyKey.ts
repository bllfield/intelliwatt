import { dateKeyFromIntervalPoint } from "@/lib/time/actualIntervalCalendar";
import { createHomeIntervalCalendar, localDateKey, localSlotIndex } from "@/lib/time/homeIntervalCalendar";
import { isGreenButtonBackedDatasetMeta } from "@/lib/time/greenButtonPersistedIntervalConvert";
import {
  materializeGreenButtonPastProducerIntervals,
  readGreenButtonTrustedHomeDateKeysFromPastMeta,
  resolvePastDatasetMetaActualSource,
} from "@/lib/usage/greenButtonPastTrustedPool";
import { isOnePathAdminGbPastRunCaller } from "@/lib/usage/userSiteSimulationIsolation";

/** Never assume SMT for GB admin/restored artifacts when meta is ambiguous. */
export function resolvePastDatasetRestoreActualSource(meta: unknown): "SMT" | "GREEN_BUTTON" {
  const explicit = resolvePastDatasetMetaActualSource(meta);
  if (explicit) return explicit;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const lockbox = (meta as Record<string, unknown>).lockboxRunContext;
    if (
      lockbox &&
      typeof lockbox === "object" &&
      isOnePathAdminGbPastRunCaller((lockbox as Record<string, unknown>).callerLabel)
    ) {
      return "GREEN_BUTTON";
    }
    if (readGreenButtonTrustedHomeDateKeysFromPastMeta(meta).size > 0) return "GREEN_BUTTON";
  }
  if (isGreenButtonBackedDatasetMeta(meta)) return "GREEN_BUTTON";
  return "SMT";
}

export type PastIntervalDailyKeyRow = {
  timestamp: string;
  kwh?: number;
  consumption_kwh?: number;
  homeDateKey?: string | null;
  homeSlot?: number | null;
};

/** Home-local calendar day for Past daily rows (never UTC slice when homeDateKey is present). */
export function pastDailyDateKeyFromInterval(row: PastIntervalDailyKeyRow): string {
  return dateKeyFromIntervalPoint({
    timestamp: String(row.timestamp ?? ""),
    homeDateKey: row.homeDateKey ?? null,
  });
}

/** Attach homeDateKey/homeSlot when missing so daily aggregation matches engine localDate keys. */
export function enrichPastDisplayIntervalsWithHomeDateKeys<T extends PastIntervalDailyKeyRow>(
  intervals: T[],
  args: { timezone: string; actualSource?: "SMT" | "GREEN_BUTTON" | null }
): Array<T & { homeDateKey: string; homeSlot?: number }> {
  if (!intervals.length) return intervals as Array<T & { homeDateKey: string; homeSlot?: number }>;
  const hasHome = intervals.some((row) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(row.homeDateKey ?? "").slice(0, 10))
  );
  if (hasHome) {
    return intervals.map((row) => {
      const homeDateKey = String(row.homeDateKey ?? pastDailyDateKeyFromInterval(row)).slice(0, 10);
      return { ...row, homeDateKey };
    });
  }

  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  if (args.actualSource === "GREEN_BUTTON") {
    const materialized = materializeGreenButtonPastProducerIntervals({
      sourceIntervals: intervals,
      timezone,
    });
    const byTs = new Map(materialized.map((row) => [row.timestamp, row]));
    return intervals.map((row) => {
      const projected = byTs.get(String(row.timestamp ?? ""));
      const homeDateKey = String(projected?.homeDateKey ?? pastDailyDateKeyFromInterval(row)).slice(0, 10);
      return {
        ...row,
        homeDateKey,
        ...(projected ? { homeSlot: projected.homeSlot } : {}),
      };
    });
  }

  const home = createHomeIntervalCalendar(timezone);
  return intervals.map((row) => {
    const ts = String(row.timestamp ?? "");
    return {
      ...row,
      homeDateKey: localDateKey(ts, home),
      homeSlot: localSlotIndex(ts, home),
    };
  });
}
