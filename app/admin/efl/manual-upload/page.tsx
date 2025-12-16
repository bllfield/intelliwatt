/**
 * Manual Fact Card Loader (legacy page).
 * The full loader also lives on /admin/efl/fact-cards.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ManualFactCardLoader } from "@/components/admin/ManualFactCardLoader";

export default function ManualFactCardLoaderPage() {
  const searchParams = useSearchParams();

  const [token, setToken] = useState("");
  const [queueErr, setQueueErr] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueItems, setQueueItems] = useState<any[]>([]);

  // Prefill support (deep links from ops tables)
  const prefillEflUrl = ((searchParams?.get("eflUrl") ?? "").trim() || undefined) as string | undefined;
  const prefillOfferId = ((searchParams?.get("offerId") ?? "").trim() || undefined) as string | undefined;

  const headerToken = useMemo(() => token.trim(), [token]);

  async function loadOpenQueue() {
    if (!headerToken) {
      setQueueErr("Admin token required to load OPEN queue.");
      return;
    }
    setQueueLoading(true);
    setQueueErr(null);
    try {
      const params = new URLSearchParams();
      params.set("status", "OPEN");
      params.set("limit", "50");
      // DO NOT enable autoResolve here; this page is a convenience list only.
      const res = await fetch(`/api/admin/efl-review/list?${params.toString()}`, {
        headers: { "x-admin-token": headerToken },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setQueueItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      setQueueErr(e?.message || "Failed to load OPEN queue.");
    } finally {
      setQueueLoading(false);
    }
  }

  useEffect(() => {
    // best-effort token reuse for this legacy page (consistent with other admin pages)
    const t = localStorage.getItem("iw_admin_token") || "";
    if (t) setToken(t);
  }, []);
  useEffect(() => {
    if (token) localStorage.setItem("iw_admin_token", token);
  }, [token]);

  useEffect(() => {
    if (headerToken) void loadOpenQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerToken]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-8 px-4">
      <div className="rounded-lg border border-brand-blue/20 bg-brand-white p-4 text-sm">
        <div className="font-medium text-brand-navy">New unified Fact Card ops page</div>
        <div className="text-xs text-brand-navy/70 mt-1">
          For batch parsing + review queue + templates + manual loader with URL/upload/text in one place, use{" "}
          <a className="underline" href="/admin/efl/fact-cards">
            /admin/efl/fact-cards
          </a>
          .
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-sm mb-1">x-admin-token</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="paste admin token"
            />
          </div>
          <button
            className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60"
            disabled={queueLoading || !headerToken}
            onClick={() => void loadOpenQueue()}
          >
            {queueLoading ? "Loading…" : "Refresh OPEN queue"}
          </button>
        </div>

        <div className="text-xs text-gray-600">
          Needs review: OPEN items from <span className="font-mono">EflParseReviewQueue</span>. This list is UI-only and does not change queue logic.
        </div>
        {queueErr ? <div className="text-sm text-red-700">{queueErr}</div> : null}

        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-700">
              <tr className="h-9">
                <th className="px-2 py-2 text-left">Supplier</th>
                <th className="px-2 py-2 text-left">Plan</th>
                <th className="px-2 py-2 text-right">Term</th>
                <th className="px-2 py-2 text-left">TDSP</th>
                <th className="px-2 py-2 text-left">Final</th>
                <th className="px-2 py-2 text-left">Reason</th>
                <th className="px-2 py-2 text-left">PUCT</th>
                <th className="px-2 py-2 text-left">Ver</th>
                <th className="px-2 py-2 text-left">SHA</th>
                <th className="px-2 py-2 text-left">Created</th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queueItems.map((it) => {
                const sha = String(it?.eflPdfSha256 ?? "");
                const shaShort = sha ? `${sha.slice(0, 10)}…${sha.slice(-6)}` : "—";
                const runHref = `/admin/efl/manual-upload?${new URLSearchParams({
                  ...(it?.eflUrl ? { eflUrl: String(it.eflUrl) } : {}),
                  ...(it?.offerId ? { offerId: String(it.offerId) } : {}),
                }).toString()}`;

                return (
                  <tr key={String(it?.id)} className="border-t">
                    <td className="px-2 py-2">{it?.supplier ?? "—"}</td>
                    <td className="px-2 py-2">
                      <div className="max-w-[220px] truncate" title={it?.planName ?? ""}>
                        {it?.planName ?? "—"}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">{typeof it?.termMonths === "number" ? `${it.termMonths} mo` : "—"}</td>
                    <td className="px-2 py-2">{it?.tdspName ?? "—"}</td>
                    <td className="px-2 py-2">{it?.finalStatus ?? "—"}</td>
                    <td className="px-2 py-2 max-w-[320px] truncate" title={it?.queueReason ?? ""}>
                      {it?.queueReason ?? "—"}
                    </td>
                    <td className="px-2 py-2 font-mono">{it?.repPuctCertificate ?? "—"}</td>
                    <td className="px-2 py-2">
                      <div className="max-w-[160px] truncate font-mono" title={it?.eflVersionCode ?? ""}>
                        {it?.eflVersionCode ?? "—"}
                      </div>
                    </td>
                    <td className="px-2 py-2 font-mono" title={sha}>
                      {shaShort}
                    </td>
                    <td className="px-2 py-2 font-mono">
                      {it?.createdAt ? String(it.createdAt).slice(0, 10) : "—"}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        {it?.eflUrl ? (
                          <a className="underline" href={String(it.eflUrl)} target="_blank" rel="noreferrer noopener">
                            Open EFL URL
                          </a>
                        ) : (
                          <span className="text-gray-400">No URL</span>
                        )}
                        <a className="underline" href={runHref}>
                          Run manual
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {queueItems.length === 0 ? (
                <tr>
                  <td className="px-2 py-6 text-center text-gray-500" colSpan={11}>
                    No OPEN queue items.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <ManualFactCardLoader adminToken={headerToken} prefillEflUrl={prefillEflUrl} prefillOfferId={prefillOfferId} />
    </div>
  );
}


