"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type UsageSourceMode = "SMT" | "GREEN_BUTTON";

type UsageCommittedSourceSelectorProps = {
  homeId: string;
  initialSource: UsageSourceMode | null;
  smtAvailable: boolean;
  greenButtonAvailable: boolean;
};

export default function UsageCommittedSourceSelector({
  homeId,
  initialSource,
  smtAvailable,
  greenButtonAvailable,
}: UsageCommittedSourceSelectorProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<UsageSourceMode | null>(initialSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canPickSmt = smtAvailable;
  const canPickGreenButton = greenButtonAvailable;

  const commitSource = async (source: UsageSourceMode) => {
    if (busy) return;
    if (selected === source) return;

    const otherLabel = source === "SMT" ? "Green Button" : "Smart Meter Texas";
    const confirmed = window.confirm(
      `Use ${source === "SMT" ? "Smart Meter Texas" : "Green Button"} as your active usage source?\n\n` +
        `Stored ${otherLabel} usage for this home will be removed so only your current choice is used.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/user/usage/committed-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeId, source }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Could not update usage source.");
      }
      setSelected(source);
      setNotice(
        typeof data?.message === "string"
          ? data.message
          : source === "SMT"
            ? "Smart Meter Texas is now your active usage source."
            : "Green Button is now your active usage source.",
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update usage source.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-brand-cyan/60">
        Active usage source
      </p>
      <p className="mt-2 text-sm leading-relaxed text-brand-cyan/85">
        IntelliWatt uses one source at a time for charts, plans, and simulations. Preferred order on this page is{" "}
        <span className="font-semibold text-brand-white">Smart Meter Texas</span>, then{" "}
        <span className="font-semibold text-brand-white">Green Button</span>. Starting either flow selects that mode and
        clears the other source&apos;s stored data for this home.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
            selected === "SMT"
              ? "border-[#39FF14]/60 bg-[#39FF14]/10"
              : "border-brand-cyan/25 bg-brand-navy/70 hover:border-brand-cyan/40"
          } ${!canPickSmt || busy ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <input
            type="radio"
            name="committed-usage-source"
            className="mt-1"
            checked={selected === "SMT"}
            disabled={!canPickSmt || busy}
            onChange={() => void commitSource("SMT")}
          />
          <span>
            <span className="block text-sm font-semibold text-brand-white">Smart Meter Texas (preferred)</span>
            <span className="mt-1 block text-xs text-brand-cyan/70">
              {canPickSmt
                ? "Automatic 15-minute sync from SMT."
                : "Connect SMT above first, then select this option."}
            </span>
          </span>
        </label>

        <label
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
            selected === "GREEN_BUTTON"
              ? "border-[#39FF14]/60 bg-[#39FF14]/10"
              : "border-brand-cyan/25 bg-brand-navy/70 hover:border-brand-cyan/40"
          } ${!canPickGreenButton || busy ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <input
            type="radio"
            name="committed-usage-source"
            className="mt-1"
            checked={selected === "GREEN_BUTTON"}
            disabled={!canPickGreenButton || busy}
            onChange={() => void commitSource("GREEN_BUTTON")}
          />
          <span>
            <span className="block text-sm font-semibold text-brand-white">Green Button upload</span>
            <span className="mt-1 block text-xs text-brand-cyan/70">
              {canPickGreenButton
                ? "Uses your uploaded utility export file."
                : "Upload a Green Button file first, then select this option."}
            </span>
          </span>
        </label>
      </div>

      {selected ? (
        <p className="mt-3 text-xs text-brand-cyan/60">
          Current selection:{" "}
          <span className="font-semibold text-brand-cyan">
            {selected === "SMT" ? "Smart Meter Texas" : "Green Button"}
          </span>
        </p>
      ) : (
        <p className="mt-3 text-xs text-amber-200/90">
          No active source selected yet. Connect SMT or upload Green Button to choose one.
        </p>
      )}

      {notice ? <p className="mt-2 text-xs text-lime-200/90">{notice}</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-200/90">{error}</p> : null}
    </div>
  );
}
