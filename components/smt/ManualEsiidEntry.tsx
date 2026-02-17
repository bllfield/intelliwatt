"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  houseAddressId: string;
  className?: string;
};

function cleanDigits(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/[^\d]/g, "");
}

export default function ManualEsiidEntry({ houseAddressId, className }: Props) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const cleaned = useMemo(() => cleanDigits(value), [value]);
  const looksValid = cleaned.length >= 17 && cleaned.length <= 22;

  const onSave = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      if (!houseAddressId) {
        throw new Error("Missing home id.");
      }
      if (!looksValid) {
        throw new Error("Enter a valid ESIID (usually 17 digits).");
      }

      const res = await fetch("/api/user/house/set-esiid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseAddressId, esiid: cleaned }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || json?.message || "Failed to save ESIID.");
      }

      setSuccess("ESIID saved.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("smt-init-updated"));
      }
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to save ESIID.");
    } finally {
      setLoading(false);
    }
  }, [houseAddressId, cleaned, looksValid, router]);

  return (
    <div className={className}>
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Manual ESIID (optional)</div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter ESIID (17 digits)"
          className="w-full rounded-xl border border-amber-300/70 bg-white/70 px-3 py-2 text-sm font-medium text-amber-950 placeholder:text-amber-900/40 focus:outline-none focus:ring-2 focus:ring-amber-300/70 sm:max-w-sm"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={loading || !looksValid}
          className="inline-flex items-center justify-center rounded-full border border-amber-300/80 bg-amber-200/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-900 transition hover:bg-amber-200/55 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Saving…" : "Save ESIID"}
        </button>
      </div>
      {error ? <div className="mt-2 text-xs font-medium text-red-700">{error}</div> : null}
      {success ? <div className="mt-2 text-xs font-medium text-amber-900/80">{success}</div> : null}
    </div>
  );
}

