export type DayTypeKey = "all" | "weekday" | "weekend";

export type TouRatePeriod = {
  dayType: DayTypeKey;
  startHHMM: string; // "0000".."2400"
  endHHMM: string; // supports overnight (end < start)
  months?: number[]; // optional 1-12
  repEnergyCentsPerKwh: number; // deterministic fixed cents
  label?: string;
};

export type TouSchedule = {
  periods: TouRatePeriod[];
  notes?: string[];
};

type ExtractTouResult =
  | { schedule: TouSchedule; notes?: string[] }
  | { schedule: null; reasonCode: string; notes?: string[] };

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseHHMMishToHHMM(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  const m1 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m1?.[1] && m1?.[2]) {
    const hh = Number(m1[1]);
    const mm = Number(m1[2]);
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
    if (hh === 24 && mm === 0) return "2400";
    if (hh < 0 || hh > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}`;
  }

  const m2 = s.match(/^(\d{4})$/);
  if (m2?.[1]) {
    const hh = Number(s.slice(0, 2));
    const mm = Number(s.slice(2, 4));
    if (hh === 24 && mm === 0) return "2400";
    if (!Number.isInteger(hh) || hh < 0 || hh > 23) return null;
    if (!Number.isInteger(mm) || mm < 0 || mm > 59) return null;
    return s;
  }

  return null;
}

function hhmmToMinutes(hhmm: string): number | null {
  const s = String(hhmm ?? "").trim();
  if (!/^\d{4}$/.test(s)) return null;
  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh === 24 && mm === 0) return 1440;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function normalizeMonths(v: unknown): number[] | undefined {
  const raw = Array.isArray(v) ? v : null;
  if (!raw) return undefined;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const x of raw) {
    const n = numOrNull(x);
    if (n == null) continue;
    const m = Math.floor(n);
    if (m < 1 || m > 12) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out.length > 0 ? out.sort((a, b) => a - b) : undefined;
}

function daysToDayTypeKey(daysOfWeek: unknown): DayTypeKey | null {
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) return "all";
  const days = daysOfWeek
    .map((d) => (typeof d === "number" ? d : typeof d === "string" ? Number(d) : NaN))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.floor(n));
  if (days.length === 0) return "all";

  const uniq = Array.from(new Set(days)).sort((a, b) => a - b);
  const isWeekday = uniq.length === 5 && uniq.every((d) => d >= 1 && d <= 5);
  const isWeekend = uniq.length === 2 && uniq.includes(0) && uniq.includes(6);
  if (isWeekday) return "weekday";
  if (isWeekend) return "weekend";
  return null;
}

function validateNonOverlappingFullCoverage(periods: TouRatePeriod[]): { ok: true } | { ok: false; reasonCode: string } {
  // Group by dayType + months signature.
  const groups = new Map<string, TouRatePeriod[]>();
  for (const p of periods) {
    const monthsSig = p.months && p.months.length > 0 ? p.months.join(",") : "";
    const k = `${p.dayType}|${monthsSig}`;
    const arr = groups.get(k) ?? [];
    arr.push(p);
    groups.set(k, arr);
  }

  // Avoid `for..of` over Map to support older TS downlevel targets.
  groups.forEach((arr) => {
    type Seg = { start: number; end: number };
    const segs: Seg[] = [];

    for (const p of arr) {
      const a = hhmmToMinutes(p.startHHMM);
      const b = hhmmToMinutes(p.endHHMM);
      if (a == null || b == null) return { ok: false, reasonCode: "UNSUPPORTED_SCHEDULE_INVALID_HHMM" };
      if (a === b) return { ok: false, reasonCode: "UNSUPPORTED_SCHEDULE_ZERO_LENGTH" };

      if (b < a) {
        segs.push({ start: a, end: 1440 });
        segs.push({ start: 0, end: b });
      } else {
        segs.push({ start: a, end: b });
      }
    }

    segs.sort((x, y) => x.start - y.start || x.end - y.end);

    // Overlap + coverage
    let curEnd = 0;
    for (const s of segs) {
      if (s.start < curEnd) return { ok: false, reasonCode: "UNSUPPORTED_SCHEDULE_OVERLAP" };
      if (s.start > curEnd) return { ok: false, reasonCode: "UNSUPPORTED_SCHEDULE_PARTIAL_COVERAGE" };
      curEnd = s.end;
    }
    if (curEnd !== 1440) return { ok: false, reasonCode: "UNSUPPORTED_SCHEDULE_PARTIAL_COVERAGE" };
  });

  return { ok: true };
}

export function extractDeterministicTouSchedule(rateStructure: any): ExtractTouResult {
  const notes: string[] = [];
  if (!rateStructure || !isObject(rateStructure)) return { schedule: null, reasonCode: "UNSUPPORTED_RATE_STRUCTURE", notes };

  // Fail closed on known non-deterministic constructs.
  if (Array.isArray((rateStructure as any).billCredits) && (rateStructure as any).billCredits.length > 0) {
    return { schedule: null, reasonCode: "NON_DETERMINISTIC_PRICING", notes: ["billCredits present"] };
  }
  if (Array.isArray((rateStructure as any).usageTiers) && (rateStructure as any).usageTiers.length > 0) {
    return { schedule: null, reasonCode: "NON_DETERMINISTIC_PRICING", notes: ["usageTiers present"] };
  }

  const rs: any = rateStructure;
  const periodsRaw: any[] = Array.isArray(rs?.timeOfUsePeriods)
    ? rs.timeOfUsePeriods
    : Array.isArray(rs?.planRules?.timeOfUsePeriods)
      ? rs.planRules.timeOfUsePeriods
      : [];

  // Support current-plan TIME_OF_USE tiers too (hour/minute windows).
  const tiersRaw: any[] =
    rs?.type === "TIME_OF_USE" && Array.isArray(rs?.tiers)
      ? rs.tiers
      : Array.isArray(rs?.timeOfUseTiers)
        ? rs.timeOfUseTiers
        : [];

  const periods: TouRatePeriod[] = [];

  if (periodsRaw.length > 0) {
    for (const p of periodsRaw) {
      const rate = numOrNull(p?.rateCentsPerKwh);
      if (rate == null) return { schedule: null, reasonCode: "NON_DETERMINISTIC_PRICING", notes: ["missing rateCentsPerKwh"] };

      const startHHMM =
        parseHHMMishToHHMM(p?.startHHMM ?? p?.startTime) ??
        (() => {
          const startHour = numOrNull(p?.startHour);
          const startMinute = numOrNull(p?.startMinute ?? p?.startMin);
          if (startHour == null) return null;
          const hh = Math.floor(startHour);
          const mm = startMinute != null ? Math.floor(startMinute) : 0;
          if (hh === 24 && mm === 0) return "2400";
          if (hh < 0 || hh > 23) return null;
          if (mm < 0 || mm > 59) return null;
          return `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}`;
        })();
      const endHHMM =
        parseHHMMishToHHMM(p?.endHHMM ?? p?.endTime) ??
        (() => {
          const endHour = numOrNull(p?.endHour);
          const endMinute = numOrNull(p?.endMinute ?? p?.endMin);
          if (endHour == null) return null;
          const hh = Math.floor(endHour);
          const mm = endMinute != null ? Math.floor(endMinute) : 0;
          if (hh === 24 && mm === 0) return "2400";
          if (hh < 0 || hh > 23) return null;
          if (mm < 0 || mm > 59) return null;
          return `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}`;
        })();
      if (!startHHMM || !endHHMM) return { schedule: null, reasonCode: "UNSUPPORTED_SCHEDULE", notes: ["missing start/end time"] };

      const dayType =
        (typeof p?.dayType === "string" && ["all", "weekday", "weekend"].includes(String(p.dayType).trim().toLowerCase())
          ? (String(p.dayType).trim().toLowerCase() as DayTypeKey)
          : null) ?? daysToDayTypeKey(p?.daysOfWeek);
      if (!dayType) return { schedule: null, reasonCode: "UNSUPPORTED_SCHEDULE", notes: ["daysOfWeek not reducible to weekday/weekend/all"] };

      const months = normalizeMonths(p?.months ?? p?.monthNumbers);
      periods.push({
        dayType,
        startHHMM,
        endHHMM,
        months,
        repEnergyCentsPerKwh: rate,
        label: typeof p?.label === "string" ? p.label : typeof p?.name === "string" ? p.name : undefined,
      });
    }
  } else if (tiersRaw.length > 0) {
    for (const t of tiersRaw) {
      const rate = numOrNull(t?.priceCents ?? t?.rateCentsPerKwh);
      if (rate == null) return { schedule: null, reasonCode: "NON_DETERMINISTIC_PRICING", notes: ["missing priceCents"] };

      const startHHMM = parseHHMMishToHHMM(t?.startTime ?? t?.startHHMM);
      const endHHMM = parseHHMMishToHHMM(t?.endTime ?? t?.endHHMM);
      if (!startHHMM || !endHHMM) return { schedule: null, reasonCode: "UNSUPPORTED_SCHEDULE", notes: ["missing start/end time"] };

      const dayType = daysToDayTypeKey(t?.daysOfWeek);
      if (!dayType) return { schedule: null, reasonCode: "UNSUPPORTED_SCHEDULE", notes: ["daysOfWeek not reducible to weekday/weekend/all"] };

      const months = normalizeMonths(t?.months ?? t?.monthNumbers);
      periods.push({
        dayType,
        startHHMM,
        endHHMM,
        months,
        repEnergyCentsPerKwh: rate,
        label: typeof t?.label === "string" ? t.label : typeof t?.name === "string" ? t.name : undefined,
      });
    }
  } else {
    return { schedule: null, reasonCode: "UNSUPPORTED_RATE_STRUCTURE", notes: ["no timeOfUsePeriods / tiers"] };
  }

  // Disallow mixing ALL with WEEKDAY/WEEKEND in this phase (keeps accounting strict).
  const hasAll = periods.some((p) => p.dayType === "all");
  const hasSplit = periods.some((p) => p.dayType === "weekday" || p.dayType === "weekend");
  if (hasAll && hasSplit) {
    return { schedule: null, reasonCode: "UNSUPPORTED_SCHEDULE", notes: ["mixed all + weekday/weekend dayTypes"] };
  }

  const v = validateNonOverlappingFullCoverage(periods);
  if (!v.ok) return { schedule: null, reasonCode: v.reasonCode, notes };

  return { schedule: { periods, notes }, notes };
}

