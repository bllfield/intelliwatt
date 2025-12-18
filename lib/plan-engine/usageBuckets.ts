export type DayType = "ALL" | "WEEKDAY" | "WEEKEND";
export type Season = "ALL" | "SUMMER" | "WINTER" | "SHOULDER";

export type OvernightAttribution = "ACTUAL_DAY" | "START_DAY";

// Canonical v1 rule format that the aggregator evaluates (and stores as ruleJson in the usage module DB).
// - HHMM strings are 4-digit "0000".."2400" (2400 allowed only as an end boundary).
export type BucketRuleV1 = {
  v: 1;
  tz: "America/Chicago";
  // One of:
  dayType?: DayType; // coarse filter
  daysOfWeek?: number[]; // 0=Sun..6=Sat (finer filter)
  months?: number[]; // 1..12 (seasonality)
  window: { startHHMM: string; endHHMM: string };
  overnightAttribution?: OvernightAttribution; // default ACTUAL_DAY
};

export type UsageBucketDef = {
  key: string; // canonical stable key
  label: string; // human-friendly
  rule: BucketRuleV1; // canonical matching rule
};

// We intentionally keep this as a lightweight string type (validated at runtime in normalizeTime()).
export type TimeHHMM = string; // expected "HH:MM" (e.g. "20:00", "07:00", "24:00")
export type Window = { start: TimeHHMM; end: TimeHHMM };

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

function assertHHMM(hhmm: string): "HHMM" {
  const s = String(hhmm ?? "").trim();
  if (!/^\d{4}$/.test(s)) throw new Error(`Invalid HHMM (expected 4 digits): ${s}`);
  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  if (hh === 24 && mm === 0) return s as "HHMM";
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) throw new Error(`Invalid hour in HHMM: ${s}`);
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) throw new Error(`Invalid minute in HHMM: ${s}`);
  return s as "HHMM";
}

export function isOvernight(window: { startHHMM: string; endHHMM: string }): boolean {
  const a = assertHHMM(window.startHHMM);
  const b = assertHHMM(window.endHHMM);
  return b < a;
}

export function makeBucketKey(args: { dayType: DayType; window: { startHHMM: string; endHHMM: string }; season?: Season }): string {
  const start = assertHHMM(args.window.startHHMM);
  const end = assertHHMM(args.window.endHHMM);
  const season = args.season && args.season !== "ALL" ? `.${args.season}` : "";
  return `kwh.m.${args.dayType}.${start}-${end}${season}`;
}

// Stable JSON representation of a bucket definition (stored as ruleJson in usage DB).
export function bucketDefToRuleJson(def: UsageBucketDef): BucketRuleV1 {
  return def.rule;
}

function makeDef(args: {
  dayType: DayType;
  window: { startHHMM: string; endHHMM: string };
  season?: Season;
  label: string;
  overnightAttribution?: OvernightAttribution;
}): UsageBucketDef {
  const key = makeBucketKey({ dayType: args.dayType, window: args.window, season: args.season });
  return {
    key,
    label: args.label,
    rule: {
      v: 1,
      tz: "America/Chicago",
      dayType: args.dayType,
      window: { startHHMM: assertHHMM(args.window.startHHMM), endHHMM: assertHHMM(args.window.endHHMM) },
      ...(args.overnightAttribution ? { overnightAttribution: args.overnightAttribution } : {}),
    },
  };
}

// Minimal “always compute” set (covers most plans; keep it small):
//  - Monthly totals (ALL/WEEKDAY/WEEKEND)
//  - Generic “free nights / nights” (20:00-07:00) and complement window (07:00-20:00)
// Total: 9 buckets
export const CORE_MONTHLY_BUCKETS: UsageBucketDef[] = [
  // A) Monthly totals
  makeDef({ dayType: "ALL", window: { startHHMM: "0000", endHHMM: "2400" }, label: "ALL 00:00-24:00" }),
  makeDef({ dayType: "WEEKDAY", window: { startHHMM: "0000", endHHMM: "2400" }, label: "WEEKDAY 00:00-24:00" }),
  makeDef({ dayType: "WEEKEND", window: { startHHMM: "0000", endHHMM: "2400" }, label: "WEEKEND 00:00-24:00" }),

  // B) Generic nights windows (common in TX)
  makeDef({ dayType: "ALL", window: { startHHMM: "2000", endHHMM: "0700" }, label: "ALL 20:00-07:00" }),
  makeDef({ dayType: "ALL", window: { startHHMM: "0700", endHHMM: "2000" }, label: "ALL 07:00-20:00" }),
  makeDef({
    dayType: "WEEKDAY",
    window: { startHHMM: "2000", endHHMM: "0700" },
    label: "WEEKDAY 20:00-07:00",
    overnightAttribution: "START_DAY",
  }),
  makeDef({ dayType: "WEEKDAY", window: { startHHMM: "0700", endHHMM: "2000" }, label: "WEEKDAY 07:00-20:00" }),
  makeDef({
    dayType: "WEEKEND",
    window: { startHHMM: "2000", endHHMM: "0700" },
    label: "WEEKEND 20:00-07:00",
    overnightAttribution: "START_DAY",
  }),
  makeDef({ dayType: "WEEKEND", window: { startHHMM: "0700", endHHMM: "2000" }, label: "WEEKEND 07:00-20:00" }),
];

export function declareMonthlyBuckets(
  req: Array<{ dayType: DayType; window: Window; season?: Season; label?: string }>,
): UsageBucketDef[] {
  const out: UsageBucketDef[] = [];
  const seen = new Set<string>();

  for (const r of req ?? []) {
    const dayType = r?.dayType;
    if (dayType !== "ALL" && dayType !== "WEEKDAY" && dayType !== "WEEKEND") continue;

    const start = String(r?.window?.start ?? "").trim();
    const end = String(r?.window?.end ?? "").trim();
    const season =
      r?.season === "ALL" || r?.season === "SUMMER" || r?.season === "WINTER" || r?.season === "SHOULDER"
        ? r.season
        : undefined;

    const startHHMM = normalizeTime(start);
    const endHHMM = normalizeTime(end);
    const key = makeBucketKey({ dayType, window: { startHHMM, endHHMM }, ...(season ? { season } : {}) });
    if (seen.has(key)) continue;
    seen.add(key);

    const label = typeof r?.label === "string" && r.label.trim() ? r.label.trim() : `${dayType} ${start}-${end}`;
    out.push({
      key,
      label,
      rule: {
        v: 1,
        tz: "America/Chicago",
        dayType,
        window: { startHHMM, endHHMM },
      },
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


