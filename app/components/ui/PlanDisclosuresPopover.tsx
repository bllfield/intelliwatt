"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Disclosures = {
  supplierPuctRegistration?: string | null;
  supplierContactEmail?: string | null;
  supplierContactPhone?: string | null;
  cancellationFeeText?: string | null;
  tosUrl?: string | null;
  yracUrl?: string | null;
};

type Props = {
  trigger: React.ReactNode;
  title?: string;
  supplierName?: string | null;
  planName?: string | null;
  distributorName?: string | null;
  disclosures?: Disclosures | null;
  eflUrl?: string | null;
};

function displayOrFallback(v: any): { text: string; isFallback: boolean } {
  const s = typeof v === "string" ? v.trim() : "";
  if (s) return { text: s, isFallback: false };
  return { text: "Not provided by supplier", isFallback: true };
}

function linkOrNull(u: any): string | null {
  const s = typeof u === "string" ? u.trim() : "";
  if (!s) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function PlanDisclosuresPopover(props: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  const rows = useMemo(() => {
    const d = props.disclosures ?? {};
    return [
      { label: "Supplier (PUCT #)", ...displayOrFallback(d.supplierPuctRegistration) },
      { label: "Supplier email", ...displayOrFallback(d.supplierContactEmail) },
      { label: "Supplier phone", ...displayOrFallback(d.supplierContactPhone) },
      { label: "Distributor (TDSP)", ...displayOrFallback(props.distributorName) },
      { label: "Cancellation fee", ...displayOrFallback(d.cancellationFeeText) },
    ];
  }, [props.disclosures, props.distributorName]);

  const links = useMemo(() => {
    const d = props.disclosures ?? {};
    return {
      efl: linkOrNull(props.eflUrl),
      tos: linkOrNull(d.tosUrl),
      yrac: linkOrNull(d.yracUrl),
    };
  }, [props.disclosures, props.eflUrl]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (e.target && root.contains(e.target as Node)) return;
      setOpen(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const hasAnyLinks = Boolean(links.efl || links.tos || links.yrac);
  const headerTitle = props.title ?? "Disclosures";
  const subtitle = [props.supplierName, props.planName].filter(Boolean).join(" — ");

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        className="text-xs font-semibold text-brand-blue hover:underline underline-offset-2"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {props.trigger}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[460px] max-w-[92vw] rounded-2xl border border-brand-cyan/25 bg-brand-navy/95 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="flex flex-col gap-1">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">
              {headerTitle}
            </div>
            {subtitle ? (
              <div className="text-xs text-brand-white/85">{subtitle}</div>
            ) : null}
          </div>

          <div className="mt-3 rounded-xl border border-brand-cyan/15 bg-brand-navy px-3 py-2">
            <div className="grid grid-cols-1 gap-2">
              {rows.map((r) => (
                <div key={r.label} className="grid grid-cols-2 gap-2 items-start">
                  <div className="text-[0.72rem] text-brand-cyan/65">{r.label}</div>
                  <div
                    className={`text-[0.72rem] ${
                      r.isFallback ? "text-brand-cyan/45 italic" : "text-brand-white/90"
                    }`}
                  >
                    {r.text}
                  </div>
                </div>
              ))}
            </div>

            {hasAnyLinks ? (
              <>
                <div className="mt-3 border-t border-brand-cyan/15 pt-3">
                  <div className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">
                    Documents
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {links.efl ? (
                      <a
                        href={links.efl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-brand-blue hover:underline"
                      >
                        EFL
                      </a>
                    ) : (
                      <span className="text-brand-cyan/45 italic">EFL not provided</span>
                    )}
                    {links.tos ? (
                      <a
                        href={links.tos}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-brand-blue hover:underline"
                      >
                        Terms
                      </a>
                    ) : (
                      <span className="text-brand-cyan/45 italic">Terms not provided</span>
                    )}
                    {links.yrac ? (
                      <a
                        href={links.yrac}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-brand-blue hover:underline"
                      >
                        YRAC
                      </a>
                    ) : (
                      <span className="text-brand-cyan/45 italic">YRAC not provided</span>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}


