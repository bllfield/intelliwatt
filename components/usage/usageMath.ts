export function sumKwh(rows: { kwh: number }[]) {
  return rows.reduce((sum, r) => sum + r.kwh, 0);
}

export function pct(part: number, total: number): string {
  const p = total > 0 ? (part / total) * 100 : 0;
  if (!Number.isFinite(p)) return "0%";
  return `${p.toFixed(0)}%`;
}

