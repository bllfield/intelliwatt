"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  houseAddressId: string;
  className?: string;
};

export default function RefreshEsiidButton({ houseAddressId, className }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    if (!houseAddressId) return;
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const res = await fetch("/api/user/house/refresh-esiid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseAddressId }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || json?.message || "Failed to refresh ESIID.");
      }

      const esiid = typeof json?.esiid === "string" && json.esiid.trim().length > 0 ? json.esiid.trim() : null;
      setSuccess(esiid ? `ESIID updated: ${esiid}` : "Lookup completed (no ESIID returned).");

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("smt-init-updated"));
      }
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to refresh ESIID.");
    } finally {
      setLoading(false);
    }
  }, [houseAddressId, router]);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center rounded-full border border-amber-300/80 bg-amber-200/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-900 transition hover:bg-amber-200/55 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Retrying ESIID lookup…" : "Retry ESIID lookup"}
      </button>
      {error ? <div className="mt-2 text-xs font-medium text-red-700">{error}</div> : null}
      {success ? <div className="mt-2 text-xs font-medium text-amber-900/80">{success}</div> : null}
    </div>
  );
}

