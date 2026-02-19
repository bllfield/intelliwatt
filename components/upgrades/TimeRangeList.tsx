"use client";

import type { ScheduleWindow } from "@/modules/upgradesLedger/catalog-types";

const TIME_REGEX = /^([01]?\d|2[0-3]):[0-5]\d$/;
function normalizeTime(s: string): string {
  const t = String(s).trim();
  if (TIME_REGEX.test(t)) return t;
  const [h, m] = t.split(":");
  const hh = Math.min(23, Math.max(0, parseInt(h ?? "0", 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m ?? "0", 10)));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export type TimeRangeListProps = {
  value: ScheduleWindow[];
  onChange: (value: ScheduleWindow[]) => void;
  disabled?: boolean;
  /** Optional label above the list */
  label?: string;
};

export function TimeRangeList({ value, onChange, disabled, label }: TimeRangeListProps) {
  const windows = Array.isArray(value) ? value : [];
  const update = (i: number, key: "start" | "end", v: string) => {
    const next = windows.map((w, idx) =>
      idx === i ? { ...w, [key]: normalizeTime(v) } : w
    );
    onChange(next);
  };
  const add = () => {
    onChange([...windows, { start: "17:00", end: "23:00" }]);
  };
  const remove = (i: number) => {
    onChange(windows.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-2">
      {label && <div className="text-xs font-medium text-brand-navy/80">{label}</div>}
      <div className="space-y-2">
        {windows.map((w, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="time"
              value={w.start}
              onChange={(e) => update(i, "start", e.target.value)}
              disabled={disabled}
              className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
            />
            <span className="text-xs text-brand-navy/60">–</span>
            <input
              type="time"
              value={w.end}
              onChange={(e) => update(i, "end", e.target.value)}
              disabled={disabled}
              className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={disabled}
              className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="rounded-lg border border-brand-blue/30 bg-white px-2 py-1.5 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5 disabled:opacity-50"
      >
        Add window
      </button>
    </div>
  );
}
