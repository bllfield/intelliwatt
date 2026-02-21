export function formatMonthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${m}/${y.slice(2)}`;
}

export function formatDateShort(date: string) {
  const [_y, m, d] = date.split("-");
  return `${m}/${d}`;
}

/** Use when the range spans two years so the axis isn’t ambiguous (e.g. Past anchor). */
export function formatDateShortWithYear(date: string) {
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export function formatDateLong(date: string) {
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${m}/${d}/${y}`;
}

export function formatTimeLabel(hhmm: string) {
  const [hh, mm] = hhmm.split(":").map(Number);
  const ampm = hh >= 12 ? "pm" : "am";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")}${ampm}`;
}

