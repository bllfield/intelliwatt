"use client";

import { useState } from "react";

export default function GreenButtonUtilitiesCard() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-6 rounded-3xl border border-brand-navy/60 bg-white p-5 shadow-[0_18px_45px_rgba(16,46,90,0.08)] sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-brand-navy">
            Which utilities support Green Button?
          </h2>
          <p className="text-xs text-brand-slate max-w-2xl">
            Green Button is available from many utilities across the U.S. and Canada. If your
            provider supports it, you can download a standardized usage file from their portal and
            upload it here for IntelliWatt to analyze.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center rounded-full border border-brand-navy/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-navy/60 hover:bg-brand-navy/5"
        >
          View utilities &amp; directory
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-brand-navy/40 bg-white p-5 shadow-[0_28px_80px_rgba(16,46,90,0.25)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-brand-navy">
                  Utilities with Green Button support
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-brand-slate">
                  The official Green Button Directory maintains the list of utilities offering
                  Green Button Download My Data or Connect My Data. Use it to confirm whether your
                  provider supports Green Button.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-brand-slate transition hover:text-brand-navy"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <p className="font-semibold text-brand-navy">Official Green Button Directory</p>
                <p className="text-brand-slate">
                  Search the directory by utility name to check if they offer Green Button:
                </p>
                <a
                  href="https://www.greenbuttonalliance.org/ds-utilities"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex text-xs font-semibold text-brand-blue underline underline-offset-2"
                >
                  Open Green Button Utilities Directory
                </a>
              </div>

              <div className="border-t border-brand-navy/10 pt-3">
                <p className="font-semibold text-brand-navy">
                  Examples of utilities with Green Button
                </p>
                <p className="text-brand-slate">
                  Many large utilities already provide Green Button, including:
                </p>
                <ul className="mt-1 list-disc list-inside space-y-0.5 text-[11px] text-brand-slate">
                  <li>Pacific Gas &amp; Electric (PG&amp;E)</li>
                  <li>San Diego Gas &amp; Electric (SDG&amp;E)</li>
                  <li>Southern California Edison (SCE)</li>
                  <li>Alectra Utilities (Canada)</li>
                  <li>Louisville Gas &amp; Electric / KU (LGE/KU)</li>
                </ul>
                <p className="mt-1 text-[11px] text-brand-slate">
                  This is only a partial list. Use the official directory above to search for your
                  utility or co-op.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

