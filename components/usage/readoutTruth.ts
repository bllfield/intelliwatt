export function buildWeekdayWeekendBreakdownNote(args: {
  weekdayKwh: number;
  weekendKwh: number;
  summaryTotalKwh?: number | null;
}): string | null {
  const summaryTotal =
    typeof args.summaryTotalKwh === "number" && Number.isFinite(args.summaryTotalKwh)
      ? args.summaryTotalKwh
      : null;
  const breakdownTotal = (Number(args.weekdayKwh) || 0) + (Number(args.weekendKwh) || 0);

  if (summaryTotal == null || Math.abs(breakdownTotal - summaryTotal) <= 0.05) {
    return null;
  }

  return `Breakdown total ${breakdownTotal.toFixed(1)} kWh comes from the persisted weekday/weekend analytics buckets and may differ from the summary net-usage total ${summaryTotal.toFixed(1)} kWh.`;
}
