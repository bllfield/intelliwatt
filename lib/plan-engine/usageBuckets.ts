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
//   kwh.m.<dayType-lower>.<window>|total[.<season>]
//
// Examples:
//   kwh.m.all.total
//   kwh.m.weekday.2000-0700
//   kwh.m.weekend.total

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
  const day = String(args.dayType).toLowerCase();
  if (String(start) === "0000" && String(end) === "2400") {
    return `kwh.m.${day}.total${season}`;
  }
  return `kwh.m.${day}.${start}-${end}${season}`;
}

export function isAllDayWindow(startHHMM: string, endHHMM: string): boolean {
  const a = String(startHHMM ?? "").trim();
  const b = String(endHHMM ?? "").trim();
  return a === "0000" && b === "2400";
}

// Stable JSON representation of a bucket definition (stored as ruleJson in usage DB).
export function bucketDefToRuleJson(def: UsageBucketDef): BucketRuleV1 {
  return def.rule;
}

export type ParsedBucketKey = {
  key: string;
  granularity: "m";
  dayType: "all" | "weekday" | "weekend";
  startHHMM: string | null; // null when "total"
  endHHMM: string | null;
  tz: "America/Chicago";
  isTotal: boolean;
};

function isValidHHMM(s: string, opts?: { allow2400?: boolean }): boolean {
  const v = String(s ?? "").trim();
  if (!/^\d{4}$/.test(v)) return false;
  const hh = Number(v.slice(0, 2));
  const mm = Number(v.slice(2, 4));
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return false;
  if (hh === 24 && mm === 0) return !!opts?.allow2400;
  if (hh < 0 || hh > 23) return false;
  if (mm < 0 || mm > 59) return false;
  return true;
}

/**
 * Canonicalize monthly bucket keys for storage and lookups.
 *
 * Accepts legacy variants such as:
 * - `kwh.m.WEEKDAY.0000-2400` -> `kwh.m.weekday.total`
 * - `kwh.m.weekend.0000-2400` -> `kwh.m.weekend.total`
 * - `kwh.m.ALL.total` -> `kwh.m.all.total`
 * - `kwh.m.WEEKDAY.2000-0700` -> `kwh.m.weekday.2000-0700`
 *
 * Safety: if the key is not parseable by a compatible monthly grammar, returns the original key unchanged.
 */
export function canonicalizeMonthlyBucketKey(key: string): string {
  const k = String(key ?? "").trim();
  if (!k) return k;

  const parts = k.split(".");
  if (parts.length !== 4) return k;
  const [p0, granularity, dayTypeRaw, tailRaw] = parts;
  if (p0 !== "kwh") return k;
  if (granularity !== "m") return k;

  const dayType = String(dayTypeRaw ?? "").trim().toLowerCase();
  if (dayType !== "all" && dayType !== "weekday" && dayType !== "weekend") return k;

  const tail = String(tailRaw ?? "").trim();
  if (!tail) return k;

  if (tail.toLowerCase() === "total") {
    return `kwh.m.${dayType}.total`;
  }

  const m = tail.match(/^(\d{4})-(\d{4})$/);
  if (!m?.[1] || !m?.[2]) return k;
  const startHHMM = m[1];
  const endHHMM = m[2];
  if (!isValidHHMM(startHHMM, { allow2400: false })) return k;
  if (!isValidHHMM(endHHMM, { allow2400: true })) return k;
  if (startHHMM === endHHMM) return k;

  if (isAllDayWindow(startHHMM, endHHMM)) {
    return `kwh.m.${dayType}.total`;
  }

  return `kwh.m.${dayType}.${startHHMM}-${endHHMM}`;
}

/**
 * Bucket key grammar (v1, monthly only):
 * - kwh.m.<dayType>.total
 * - kwh.m.<dayType>.<HHMM>-<HHMM>
 * where dayType in {all,weekday,weekend} and HHMM in 0000..2359 (end may be 2400).
 */
export function parseMonthlyBucketKey(key: string): ParsedBucketKey | null {
  const k = String(key ?? "").trim();
  if (!k) return null;

  const parts = k.split(".");
  if (parts.length !== 4) return null;
  const [p0, granularity, dayType, tail] = parts;
  if (p0 !== "kwh") return null;
  if (granularity !== "m") return null;
  if (dayType !== "all" && dayType !== "weekday" && dayType !== "weekend") return null;

  if (tail === "total") {
    return {
      key: k,
      granularity: "m",
      dayType,
      startHHMM: null,
      endHHMM: null,
      tz: "America/Chicago",
      isTotal: true,
    };
  }

  const m = tail.match(/^(\d{4})-(\d{4})$/);
  if (!m?.[1] || !m?.[2]) return null;
  const startHHMM = m[1];
  const endHHMM = m[2];
  if (!isValidHHMM(startHHMM, { allow2400: false })) return null;
  if (!isValidHHMM(endHHMM, { allow2400: true })) return null;
  if (startHHMM === endHHMM) return null;

  return {
    key: k,
    granularity: "m",
    dayType,
    startHHMM,
    endHHMM,
    tz: "America/Chicago",
    isTotal: false,
  };
}

export function bucketRuleFromParsedKey(p: ParsedBucketKey): BucketRuleV1 {
  const dayType: DayType = p.dayType === "all" ? "ALL" : p.dayType === "weekday" ? "WEEKDAY" : "WEEKEND";

  const window =
    p.isTotal || (p.startHHMM == null && p.endHHMM == null)
      ? { startHHMM: "0000", endHHMM: "2400" }
      : { startHHMM: p.startHHMM!, endHHMM: p.endHHMM! };

  // Parse-time validation ensures HHMM format correctness.
  return {
    v: 1,
    tz: "America/Chicago",
    dayType,
    window,
    overnightAttribution: "ACTUAL_DAY",
  };
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


