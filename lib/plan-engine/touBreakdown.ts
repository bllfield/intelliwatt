type TouPeriodLike = {
  dayType?: unknown;
  startHHMM?: unknown;
  endHHMM?: unknown;
  months?: unknown;
  repEnergyCentsPerKwh?: unknown;
};

function bucketKeyForPeriod(p: TouPeriodLike): string | null {
  const dayType = String(p?.dayType ?? "").trim();
  const startHHMM = String(p?.startHHMM ?? "").trim();
  const endHHMM = String(p?.endHHMM ?? "").trim();
  if (!dayType || !startHHMM || !endHHMM) return null;
  return startHHMM === "0000" && endHHMM === "2400"
    ? `kwh.m.${dayType}.total`
    : `kwh.m.${dayType}.${startHHMM}-${endHHMM}`;
}

export function pickTouPeriodForMonth(args: {
  periods: TouPeriodLike[];
  bucketKey: string;
  monthOfYear: number | null;
}): TouPeriodLike | null {
  const periods = Array.isArray(args.periods) ? args.periods : [];
  const bucketKey = String(args.bucketKey ?? "").trim();
  if (!bucketKey) return null;
  const monthOfYear =
    typeof args.monthOfYear === "number" && Number.isFinite(args.monthOfYear) && args.monthOfYear >= 1 && args.monthOfYear <= 12
      ? args.monthOfYear
      : null;

  const candidates = periods.filter((p) => bucketKeyForPeriod(p) === bucketKey);
  if (!candidates.length) return null;

  // For seasonal TOU (multiple periods share same bucket key), prefer a period that explicitly includes the target month.
  if (monthOfYear != null) {
    const hit = candidates.find((p) => Array.isArray(p?.months) && (p.months as any[]).includes(monthOfYear));
    if (hit) return hit;
  }

  // Otherwise prefer "all months" (no months array), then fall back to the first candidate.
  const allMonths = candidates.find((p) => !Array.isArray(p?.months) || (p.months as any[]).length === 0);
  return allMonths ?? candidates[0] ?? null;
}

