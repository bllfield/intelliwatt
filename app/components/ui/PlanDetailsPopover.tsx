"use client";

import React, { useMemo, useState } from "react";

type Props = {
  trigger: React.ReactNode;
  title?: string;
  data: any;
};

export function PlanDetailsPopover(props: Props) {
  const [open, setOpen] = useState(false);

  const json = useMemo(() => {
    try {
      return JSON.stringify(props.data ?? null, null, 2);
    } catch (e: any) {
      return `<<could not stringify>>\n${e?.message ?? String(e)}`;
    }
  }, [props.data]);

  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="text-xs font-semibold text-brand-blue hover:underline underline-offset-2"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        {props.trigger}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[90vw] rounded-2xl border border-brand-cyan/25 bg-brand-navy/95 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">
              {props.title ?? "Plan Details"}
            </div>
            <button
              type="button"
              className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1 text-[0.65rem] font-semibold text-brand-cyan hover:bg-brand-white/10"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(json);
                } catch {
                  // ignore
                }
              }}
            >
              Copy JSON
            </button>
          </div>

          <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-brand-cyan/15 bg-brand-navy px-3 py-2 text-[0.7rem] leading-relaxed text-brand-cyan/80">
{json}
          </pre>
        </div>
      ) : null}
    </span>
  );
}


