"use client";

import { useState } from "react";

export default function GreenButtonHelpSection() {
  const [open, setOpen] = useState(false);

  return (
    <section
      id="green-button-instructions"
      className="rounded-3xl border-2 border-brand-navy bg-white p-6 shadow-[0_24px_70px_rgba(16,46,90,0.08)] sm:p-8 space-y-6 text-sm leading-relaxed text-brand-slate"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-brand-navy">
            Green Button usage data
          </h2>
          <p className="mt-2">
            Green Button is a standardized download offered by many utilities so you can export the
            same detailed usage history they see internally. Uploading it here lets IntelliWatt
            analyze your real consumption patterns without waiting on Smart Meter Texas.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-semibold text-brand-navy">How to download your Green Button file</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Log in to your electric utility’s online account.</li>
            <li>
              Browse to sections labeled{" "}
              <span className="font-semibold">Usage</span>,{" "}
              <span className="font-semibold">Energy Use</span>,{" "}
              <span className="font-semibold">Usage History</span>, or a{" "}
              <span className="font-semibold">Green Button / Download My Data</span> link.
            </li>
            <li>
              When prompted for a date range, choose the{" "}
              <span className="font-semibold">last 12 months</span> whenever possible. For newer
              homes, export as much history as you have.
            </li>
            <li>
              Download the file—preferably the Green Button{" "}
              <span className="font-semibold">XML</span>. If XML isn’t offered, download the
              available Green Button CSV instead.
            </li>
            <li>
              Return to the <span className="font-semibold">Green Button Upload</span> step below and
              upload that file so we can run the analysis.
            </li>
          </ol>
        </div>

        <div className="space-y-1">
          <p className="font-semibold text-brand-navy">How much data should I upload?</p>
          <p>
            Uploading a full <span className="font-semibold">12 months</span> captures both summer
            and winter usage peaks. If you do not have a year of history yet, send everything
            available—we will still model your savings using what you provide.
          </p>
        </div>

        <div className="space-y-1">
          <p className="font-semibold text-brand-navy">If you can’t find Green Button</p>
          <p>
            Utilities sometimes relabel it as{" "}
            <span className="font-semibold">Energy Insights</span>,{" "}
            <span className="font-semibold">Usage History</span>, or{" "}
            <span className="font-semibold">Download My Usage</span>. If you still can’t locate an
            export, contact your utility’s support team and ask how to download your data in Green
            Button format.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-base font-semibold text-brand-navy">
              Which utilities support Green Button?
            </h3>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center rounded-full border border-brand-navy/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-navy/60 hover:bg-brand-navy/5"
            >
              View utilities &amp; directory
            </button>
          </div>
          <p>
            Green Button is available from many utilities across the U.S. and Canada. If your
            provider supports it, you can download a standardized usage file from their portal and
            upload it here for IntelliWatt to analyze.
          </p>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-brand-navy/40 bg-white p-5 shadow-[0_28px_80px_rgba(16,46,90,0.25)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-brand-navy">
                  Utilities with Green Button support
                </h4>
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

