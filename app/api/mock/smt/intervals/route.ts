// app/api/mock/smt/intervals/route.ts
// Generates realistic 15-min intervals for a month in America/Chicago,
// with a day/night load shape and optional weekend dip.

import { NextRequest, NextResponse } from 'next/server';

type Payload = {
  month: string;        // "2025-08" (YYYY-MM)
  avgMonthlyKwh?: number; // target monthly kWh, default 1200
  weekendFactor?: number; // 0.8 = weekends 20% lower. default 0.9
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<Payload>;
  const month = (body.month || nowYm()).slice(0, 7);
  const avgMonthlyKwh = body.avgMonthlyKwh ?? 1200;
  const weekendFactor = body.weekendFactor ?? 0.9;

  const intervals = synthesizeMonth(month, avgMonthlyKwh, weekendFactor);
  return NextResponse.json({ month, intervals, totalKwh: sum(intervals) });
}

function synthesizeMonth(ym: string, targetMonthlyKwh: number, weekendFactor: number) {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(y, m - 1, 1, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0);

  const arr: { ts: string; kwh: number }[] = [];
  let minutes = +start;
  while (minutes < +end) {
    const d = new Date(minutes);
    const hh = d.getHours();
    const day = d.getDay(); // 0 Sun ... 6 Sat
    const isWeekend = day === 0 || day === 6;

    // Simple shape: base + peak midday/evening
    // Peak 16:00-21:00, shoulder 07:00-09:00, 22:00-23:00
    const base = 0.15; // kWh per 15-min
    let k = base;
    if ((hh >= 16 && hh < 21)) k += 0.20;         // peak
    else if ((hh >= 7 && hh < 9) || (hh >= 22)) k += 0.08; // shoulder
    if (isWeekend) k *= weekendFactor;

    arr.push({ ts: toIsoLocal(d), kwh: k });
    minutes += 15 * 60 * 1000;
  }

  // Scale to hit targetMonthlyKwh
  const current = sum(arr);
  const scale = current > 0 ? targetMonthlyKwh / current : 1;
  return arr.map((r) => ({ ...r, kwh: round4(r.kwh * scale) }));
}

function sum(a: { kwh: number }[]) {
  return a.reduce((s, r) => s + r.kwh, 0);
}
function round4(n: number) { return Math.round(n * 10000) / 10000; }
function nowYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function toIsoLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}
