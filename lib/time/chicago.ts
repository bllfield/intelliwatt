export function isYearMonth(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(String(s ?? "").trim());
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInUtcMonth(year: number, monthIndex0: number): number {
  // monthIndex0: 0-11
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export function anchorEndDateUtc(anchorEndMonth: string, billEndDay: number): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(anchorEndMonth ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex0 = Number(m[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex0) || monthIndex0 < 0 || monthIndex0 > 11) return null;

  const dim = daysInUtcMonth(year, monthIndex0);
  const day = Math.max(1, Math.min(dim, Math.trunc(billEndDay)));
  return new Date(Date.UTC(year, monthIndex0, day, 0, 0, 0, 0));
}

export function monthAdd(ym: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return ym;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + delta);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function monthsEndingAt(endYm: string, count = 12): string[] {
  const n = Math.max(1, Math.min(24, Math.trunc(count)));
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthAdd(endYm, -i));
  return out;
}

export function lastFullMonthChicago(now = new Date()): string {
  // Determine current Chicago year/month, then subtract 1 month.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "");
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    // Fallback: local clock
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  return month === 1 ? `${year - 1}-12` : `${year}-${pad2(month - 1)}`;
}

