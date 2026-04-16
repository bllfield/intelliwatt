export const VALIDATION_DAY_SELECTION_MODES = [
  "manual",
  "random_simple",
  "customer_style_seasonal_mix",
  "stratified_weather_balanced",
] as const;

export type ValidationDaySelectionMode =
  | "manual"
  | "random_simple"
  | "customer_style_seasonal_mix"
  | "stratified_weather_balanced";

export type ValidationDaySelectionDiagnostics = {
  modeUsed: ValidationDaySelectionMode;
  targetCount: number;
  selectedCount: number;
  fallbackSubstitutions: number;
  excludedTravelVacantCount: number;
  excludedWeakCoverageCount: number;
  weekdayWeekendSplit: { weekday: number; weekend: number };
  seasonalSplit: { winter: number; summer: number; shoulder: number };
  bucketCounts: Record<string, number>;
  shortfallReason: string | null;
};

export function normalizeValidationSelectionMode(value: unknown): ValidationDaySelectionMode | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if ((VALIDATION_DAY_SELECTION_MODES as readonly string[]).includes(raw)) {
    return raw as ValidationDaySelectionMode;
  }
  return null;
}

function seededRng(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  let state = Math.abs(h) || 1;
  return () => {
    state = (Math.imul(1103515245, state) + 12345) | 0;
    return ((state >>> 0) / 0x1_0000_0000) % 1;
  };
}

function getLocalDayOfWeekFromDateKey(dateKey: string, timezone: string): number {
  try {
    const d = new Date(dateKey + "T12:00:00.000Z");
    if (!Number.isFinite(d.getTime())) return 0;
    const short = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "short" }).format(d);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[short] ?? 0;
  } catch {
    return 0;
  }
}

function pickRandomDateKeys(args: {
  candidateDateKeys: string[];
  testDays: number;
  seed: string;
  stratifyByMonth: boolean;
  stratifyByWeekend: boolean;
  isWeekendLocalKey: (dk: string) => boolean;
  monthKeyFromLocalKey: (dk: string) => string;
}): string[] {
  const {
    candidateDateKeys,
    testDays,
    seed,
    stratifyByMonth,
    stratifyByWeekend,
    isWeekendLocalKey,
    monthKeyFromLocalKey,
  } = args;
  if (candidateDateKeys.length <= testDays) return [...candidateDateKeys].sort();
  const rng = seededRng(seed);
  const shuffle = <T>(arr: T[]): T[] => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  if (!stratifyByMonth && !stratifyByWeekend) {
    return shuffle(candidateDateKeys).slice(0, testDays).sort();
  }

  const key = (dk: string) =>
    stratifyByMonth && stratifyByWeekend
      ? `${monthKeyFromLocalKey(dk)}:${isWeekendLocalKey(dk) ? "we" : "wd"}`
      : stratifyByMonth
        ? monthKeyFromLocalKey(dk)
        : isWeekendLocalKey(dk)
          ? "we"
          : "wd";
  const groups = new Map<string, string[]>();
  for (const dk of candidateDateKeys) {
    const k = key(dk);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(dk);
  }
  const groupKeys = Array.from(groups.keys()).sort();
  const shuffledGroups = new Map<string, string[]>();
  for (const gk of groupKeys) shuffledGroups.set(gk, shuffle(groups.get(gk)!));

  const picked: string[] = [];
  let index = 0;
  while (picked.length < testDays) {
    let added = 0;
    for (const gk of groupKeys) {
      const arr = shuffledGroups.get(gk)!;
      const dk = arr[index];
      if (dk && !picked.includes(dk)) {
        picked.push(dk);
        added++;
        if (picked.length >= testDays) break;
      }
    }
    if (added === 0) break;
    index++;
  }
  if (picked.length < testDays) {
    const remaining = candidateDateKeys.filter((dk) => !picked.includes(dk));
    picked.push(...shuffle(remaining).slice(0, testDays - picked.length));
  }
  return picked.slice(0, testDays).sort();
}

function seasonFromDateKey(dateKey: string): "winter" | "summer" | "shoulder" {
  const mm = dateKey.slice(5, 7);
  if (mm === "12" || mm === "01" || mm === "02") return "winter";
  if (mm === "06" || mm === "07" || mm === "08") return "summer";
  return "shoulder";
}

function withBasicSelectionDiagnostics(args: {
  modeUsed: ValidationDaySelectionMode;
  targetCount: number;
  selectedDateKeys: string[];
  candidateDateKeys: string[];
  travelDateKeysSet: Set<string>;
  timezone: string;
  bucketCounts: Record<string, number>;
  fallbackSubstitutions: number;
  shortfallReason?: string | null;
}): ValidationDaySelectionDiagnostics {
  const excludedTravelVacantCount = args.candidateDateKeys.filter((dk) => args.travelDateKeysSet.has(dk)).length;
  const excludedWeakCoverageCount = Math.max(
    0,
    args.candidateDateKeys.length - args.selectedDateKeys.length - excludedTravelVacantCount
  );
  let weekday = 0;
  let weekend = 0;
  const seasonal = { winter: 0, summer: 0, shoulder: 0 };
  for (const dk of args.selectedDateKeys) {
    const dow = getLocalDayOfWeekFromDateKey(dk, args.timezone);
    if (dow === 0 || dow === 6) weekend++;
    else weekday++;
    seasonal[seasonFromDateKey(dk)] += 1;
  }
  return {
    modeUsed: args.modeUsed,
    targetCount: args.targetCount,
    selectedCount: args.selectedDateKeys.length,
    fallbackSubstitutions: args.fallbackSubstitutions,
    excludedTravelVacantCount,
    excludedWeakCoverageCount,
    weekdayWeekendSplit: { weekday, weekend },
    seasonalSplit: seasonal,
    bucketCounts: args.bucketCounts,
    shortfallReason:
      args.selectedDateKeys.length < args.targetCount ? args.shortfallReason ?? "insufficient_clean_candidates" : null,
  };
}

function roundRobinPickBuckets(args: {
  targetCount: number;
  orderedBuckets: Array<{ key: string; keys: string[] }>;
}): { picked: string[]; bucketCounts: Record<string, number>; fallbackSubstitutions: number } {
  const picked: string[] = [];
  const bucketCounts: Record<string, number> = {};
  let fallbackSubstitutions = 0;
  let index = 0;
  const seen = new Set<string>();
  while (picked.length < args.targetCount) {
    let addedThisRound = 0;
    for (const bucket of args.orderedBuckets) {
      const dk = bucket.keys[index];
      if (!dk || seen.has(dk)) continue;
      picked.push(dk);
      seen.add(dk);
      bucketCounts[bucket.key] = (bucketCounts[bucket.key] ?? 0) + 1;
      addedThisRound++;
      if (picked.length >= args.targetCount) break;
    }
    if (addedThisRound === 0) break;
    if (index > 0) fallbackSubstitutions += addedThisRound;
    index++;
  }
  return { picked, bucketCounts, fallbackSubstitutions };
}

export function selectValidationDayKeys(args: {
  mode: ValidationDaySelectionMode;
  targetCount: number;
  candidateDateKeys: string[];
  travelDateKeysSet: Set<string>;
  timezone: string;
  seed: string;
  manualDateKeys?: string[];
}): {
  selectedDateKeys: string[];
  diagnostics: ValidationDaySelectionDiagnostics;
} {
  const targetCount = Math.max(1, Math.floor(args.targetCount || 21));
  const candidateDateKeys = Array.from(
    new Set(
      (args.candidateDateKeys ?? [])
        .map((dk) => String(dk ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    )
  ).sort();
  const cleanCandidates = candidateDateKeys.filter((dk) => !args.travelDateKeysSet.has(dk));

  if (args.mode === "manual") {
    const picked = Array.from(
      new Set(
        (args.manualDateKeys ?? [])
          .map((dk) => String(dk ?? "").slice(0, 10))
          .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk) && !args.travelDateKeysSet.has(dk))
      )
    ).sort();
    return {
      selectedDateKeys: picked,
      diagnostics: withBasicSelectionDiagnostics({
        modeUsed: args.mode,
        targetCount,
        selectedDateKeys: picked,
        candidateDateKeys,
        travelDateKeysSet: args.travelDateKeysSet,
        timezone: args.timezone,
        bucketCounts: { manual: picked.length },
        fallbackSubstitutions: 0,
      }),
    };
  }

  if (args.mode === "random_simple") {
    const picked = pickRandomDateKeys({
      candidateDateKeys: cleanCandidates,
      testDays: targetCount,
      seed: args.seed,
      stratifyByMonth: false,
      stratifyByWeekend: false,
      isWeekendLocalKey: (dk) => {
        const dow = getLocalDayOfWeekFromDateKey(dk, args.timezone);
        return dow === 0 || dow === 6;
      },
      monthKeyFromLocalKey: (dk) => dk.slice(0, 7),
    });
    return {
      selectedDateKeys: picked,
      diagnostics: withBasicSelectionDiagnostics({
        modeUsed: args.mode,
        targetCount,
        selectedDateKeys: picked,
        candidateDateKeys,
        travelDateKeysSet: args.travelDateKeysSet,
        timezone: args.timezone,
        bucketCounts: { random_simple: picked.length },
        fallbackSubstitutions: 0,
      }),
    };
  }

  if (args.mode === "customer_style_seasonal_mix") {
    const picked = pickRandomDateKeys({
      candidateDateKeys: cleanCandidates,
      testDays: targetCount,
      seed: args.seed,
      stratifyByMonth: true,
      stratifyByWeekend: true,
      isWeekendLocalKey: (dk) => {
        const dow = getLocalDayOfWeekFromDateKey(dk, args.timezone);
        return dow === 0 || dow === 6;
      },
      monthKeyFromLocalKey: (dk) => dk.slice(0, 7),
    });
    return {
      selectedDateKeys: picked,
      diagnostics: withBasicSelectionDiagnostics({
        modeUsed: args.mode,
        targetCount,
        selectedDateKeys: picked,
        candidateDateKeys,
        travelDateKeysSet: args.travelDateKeysSet,
        timezone: args.timezone,
        bucketCounts: { customer_style_seasonal_mix: picked.length },
        fallbackSubstitutions: 0,
      }),
    };
  }

  const winter = cleanCandidates.filter((dk) => seasonFromDateKey(dk) === "winter");
  const summer = cleanCandidates.filter((dk) => seasonFromDateKey(dk) === "summer");
  const shoulder = cleanCandidates.filter((dk) => seasonFromDateKey(dk) === "shoulder");
  const weekday = cleanCandidates.filter((dk) => {
    const dow = getLocalDayOfWeekFromDateKey(dk, args.timezone);
    return dow !== 0 && dow !== 6;
  });
  const weekend = cleanCandidates.filter((dk) => {
    const dow = getLocalDayOfWeekFromDateKey(dk, args.timezone);
    return dow === 0 || dow === 6;
  });
  const shuffle = (arr: string[], seedSuffix: string) =>
    pickRandomDateKeys({
      candidateDateKeys: arr,
      testDays: arr.length,
      seed: `${args.seed}:${seedSuffix}`,
      stratifyByMonth: false,
      stratifyByWeekend: false,
      isWeekendLocalKey: (dk) => {
        const dow = getLocalDayOfWeekFromDateKey(dk, args.timezone);
        return dow === 0 || dow === 6;
      },
      monthKeyFromLocalKey: (dk) => dk.slice(0, 7),
    });

  const { picked, bucketCounts, fallbackSubstitutions } = roundRobinPickBuckets({
    targetCount,
    orderedBuckets: [
      { key: "winter", keys: shuffle(winter, "winter") },
      { key: "summer", keys: shuffle(summer, "summer") },
      { key: "shoulder", keys: shuffle(shoulder, "shoulder") },
      { key: "weekday", keys: shuffle(weekday, "weekday") },
      { key: "weekend", keys: shuffle(weekend, "weekend") },
    ],
  });
  const deduped = Array.from(new Set(picked)).slice(0, targetCount).sort();
  return {
    selectedDateKeys: deduped,
    diagnostics: withBasicSelectionDiagnostics({
      modeUsed: "stratified_weather_balanced",
      targetCount,
      selectedDateKeys: deduped,
      candidateDateKeys,
      travelDateKeysSet: args.travelDateKeysSet,
      timezone: args.timezone,
      bucketCounts,
      fallbackSubstitutions,
      shortfallReason: "stratified_buckets_exhausted",
    }),
  };
}

