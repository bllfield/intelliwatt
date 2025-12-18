export type DayType = "ALL" | "WEEKDAY" | "WEEKEND";
export type Season = "ALL" | "SUMMER" | "WINTER" | "SHOULDER";

// We intentionally keep this as a lightweight string type (validated at runtime in normalizeTime()).
export type TimeHHMM = string; // expected "HH:MM" (e.g. "20:00", "07:00", "24:00")

export type Window = { start: TimeHHMM; end: TimeHHMM };

export type UsageBucketDef = {
  key: string; // canonical stable key
  label: string; // human-friendly
  dayType: DayType;
  window: { start: TimeHHMM; end: TimeHHMM };
  season?: Season;
  tz: "America/Chicago";
};

// Canonical key format (stable, deterministic):
//   kwh.m.<dayType>.<startHHMM>-<endHHMM>[.<season>]
//
// Examples:
//   kwh.m.ALL.0000-2400
//   kwh.m.WEEKDAY.2000-0700
//   kwh.m.WEEKEND.0000-2400

export function normalizeTime(hhmm: TimeHHMM): "HHMM" {
  const s = String(hhmm ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid time (expected HH:MM): ${s}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || hh < 0 || hh > 24) throw new Error(`Invalid hour in time: ${s}`);
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) throw new Error(`Invalid minutes in time: ${s}`);
  if (hh === 24 && mm !== 0) throw new Error(`Invalid time beyond 24:00: ${s}`);
  return `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}` as "HHMM";
}

export function isOvernight(window: Window): boolean {
  const a = normalizeTime(window.start);
  const b = normalizeTime(window.end);
  return b < a;
}

export function makeBucketKey(args: { dayType: DayType; window: Window; season?: Season }): string {
  const start = normalizeTime(args.window.start);
  const end = normalizeTime(args.window.end);
  const season = args.season && args.season !== "ALL" ? `.${args.season}` : "";
  return `kwh.m.${args.dayType}.${start}-${end}${season}`;
}

function makeDef(args: {
  dayType: DayType;
  window: { start: TimeHHMM; end: TimeHHMM };
  season?: Season;
  label: string;
}): UsageBucketDef {
  const key = makeBucketKey({ dayType: args.dayType, window: args.window, season: args.season });
  return {
    key,
    label: args.label,
    dayType: args.dayType,
    window: args.window,
    ...(args.season ? { season: args.season } : {}),
    tz: "America/Chicago",
  };
}

// Minimal “always compute” set (covers most plans; keep it small):
//  - Monthly totals (ALL/WEEKDAY/WEEKEND)
//  - Generic “free nights / nights” (20:00-07:00) and complement window (07:00-20:00)
// Total: 9 buckets
export const CORE_MONTHLY_BUCKETS: UsageBucketDef[] = [
  // A) Monthly totals
  makeDef({ dayType: "ALL", window: { start: "00:00", end: "24:00" }, label: "ALL 00:00-24:00" }),
  makeDef({ dayType: "WEEKDAY", window: { start: "00:00", end: "24:00" }, label: "WEEKDAY 00:00-24:00" }),
  makeDef({ dayType: "WEEKEND", window: { start: "00:00", end: "24:00" }, label: "WEEKEND 00:00-24:00" }),

  // B) Generic nights windows (common in TX)
  makeDef({ dayType: "ALL", window: { start: "20:00", end: "07:00" }, label: "ALL 20:00-07:00" }),
  makeDef({ dayType: "ALL", window: { start: "07:00", end: "20:00" }, label: "ALL 07:00-20:00" }),
  makeDef({ dayType: "WEEKDAY", window: { start: "20:00", end: "07:00" }, label: "WEEKDAY 20:00-07:00" }),
  makeDef({ dayType: "WEEKDAY", window: { start: "07:00", end: "20:00" }, label: "WEEKDAY 07:00-20:00" }),
  makeDef({ dayType: "WEEKEND", window: { start: "20:00", end: "07:00" }, label: "WEEKEND 20:00-07:00" }),
  makeDef({ dayType: "WEEKEND", window: { start: "07:00", end: "20:00" }, label: "WEEKEND 07:00-20:00" }),
];

export function declareMonthlyBuckets(
  req: Array<{ dayType: DayType; window: Window; season?: Season; label?: string }>,
): UsageBucketDef[] {
  const out: UsageBucketDef[] = [];
  const seen = new Set<string>();

  for (const r of req ?? []) {
    const dayType = r?.dayType;
    if (dayType !== "ALL" && dayType !== "WEEKDAY" && dayType !== "WEEKEND") continue;

    const start = String(r?.window?.start ?? "").trim() as any;
    const end = String(r?.window?.end ?? "").trim() as any;
    const season =
      r?.season === "ALL" || r?.season === "SUMMER" || r?.season === "WINTER" || r?.season === "SHOULDER"
        ? r.season
        : undefined;

    const key = makeBucketKey({ dayType, window: { start, end }, ...(season ? { season } : {}) });
    if (seen.has(key)) continue;
    seen.add(key);

    const label = typeof r?.label === "string" && r.label.trim() ? r.label.trim() : `${dayType} ${start}-${end}`;
    out.push({
      key,
      label,
      dayType,
      window: { start, end },
      ...(season ? { season } : {}),
      tz: "America/Chicago",
    });
  }

  return out;
}

/*
Intended downstream flow (future):
- Plan template parsing extracts required buckets (TOU windows, weekday/weekend splits, seasonal windows).
- System ensures monthly bucket totals exist for required bucket keys (tall table; e.g., HomeMonthlyBucket).
- Aggregator computes monthly kWh totals per bucket from raw 15-min intervals once (per home, per month).
- Plan cost engine uses bucket totals + rules engine (tiers/credits/base fees) to compute accurate bill totals.
*/


