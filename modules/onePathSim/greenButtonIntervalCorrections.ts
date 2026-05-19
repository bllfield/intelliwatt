export type GreenButtonIntervalPoint = { timestamp: string; kwh: number };

export type GreenButtonZeroRedistributionResult = {
  intervals: GreenButtonIntervalPoint[];
  redistributedIntervalCount: number;
};

function dateKeyFromUtcGridTimestamp(timestamp: string): string | null {
  const ts = new Date(timestamp);
  if (!Number.isFinite(ts.getTime())) return null;
  return ts.toISOString().slice(0, 10);
}

function isAdjacentSameUtcGridDay(
  left: GreenButtonIntervalPoint | undefined,
  right: GreenButtonIntervalPoint | undefined
): boolean {
  if (!left || !right) return false;
  if (dateKeyFromUtcGridTimestamp(left.timestamp) !== dateKeyFromUtcGridTimestamp(right.timestamp)) return false;
  const leftTs = new Date(left.timestamp).getTime();
  const rightTs = new Date(right.timestamp).getTime();
  return Number.isFinite(leftTs) && Number.isFinite(rightTs) && rightTs - leftTs === 15 * 60 * 1000;
}

export function redistributeGreenButtonGridZeroSamples(
  rows: Array<{ timestamp: string; kwh: number }>
): GreenButtonZeroRedistributionResult {
  const intervals = rows
    .map((row) => ({
      timestamp: String(row.timestamp ?? ""),
      kwh: Number(row.kwh) || 0,
    }))
    .filter((row) => row.timestamp)
    .sort((left, right) => (left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0));
  let redistributedIntervalCount = 0;

  for (let index = 0; index < intervals.length; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index]!;
    const next = intervals[index + 1];
    if (current.kwh !== 0) continue;
    const previousCandidate =
      isAdjacentSameUtcGridDay(previous, current) && previous && previous.kwh > 0 ? previous : null;
    const nextCandidate = isAdjacentSameUtcGridDay(current, next) && next && next.kwh > 0 ? next : null;
    const donor =
      previousCandidate && nextCandidate
        ? previousCandidate.kwh >= nextCandidate.kwh
          ? previousCandidate
          : nextCandidate
        : previousCandidate ?? nextCandidate;
    if (!donor) continue;
    const splitKwh = donor.kwh / 2;
    current.kwh = splitKwh;
    donor.kwh = splitKwh;
    redistributedIntervalCount += 1;
  }

  return { intervals, redistributedIntervalCount };
}
