"use client";

import { useEffect, useMemo, useState } from "react";
import { eventsForPageKey } from "@/lib/intelliwattbot/events";

type PageRow = {
  pageKey: string;
  baseKey?: string;
  eventKey?: string | null;
  label: string;
  paths: string[];
  defaultMessage: string;
  current: { enabled: boolean; message: string | null; updatedAt: string | null };
};

type ApiListResp = { ok: boolean; pages?: PageRow[]; error?: string };
type ApiSaveResp = { ok: boolean; row?: any; error?: string };

export default function BotMessagesClient() {
  const [adminToken, setAdminToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { enabled: boolean; message: string }>>({});
  const [newEventByBase, setNewEventByBase] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const t = window.localStorage.getItem("intelliwattAdminToken");
      if (t) setAdminToken(t);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const trimmed = adminToken.trim();
      if (trimmed) window.localStorage.setItem("intelliwattAdminToken", trimmed);
      else window.localStorage.removeItem("intelliwattAdminToken");
    } catch {
      // ignore
    }
  }, [adminToken]);

  const headers = useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (adminToken.trim()) h["x-admin-token"] = adminToken.trim();
    return h;
  }, [adminToken]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/bot-messages", { headers, cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ApiListResp | null;
      if (!r.ok || !j?.ok) {
        setError(j?.error ?? `Request failed (${r.status})`);
        setPages([]);
        return;
      }
      const rows = Array.isArray(j.pages) ? j.pages : [];
      setPages(rows);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const p of rows) {
          if (!next[p.pageKey]) {
            next[p.pageKey] = { enabled: p.current.enabled, message: p.current.message ?? p.defaultMessage };
          }
        }
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(pageKey: string) {
    const d = drafts[pageKey];
    if (!d) return;
    setSavingKey(pageKey);
    setError(null);
    try {
      const r = await fetch("/api/admin/bot-messages", {
        method: "POST",
        headers,
        body: JSON.stringify({ pageKey, enabled: d.enabled, message: d.message }),
      });
      const j = (await r.json().catch(() => null)) as ApiSaveResp | null;
      if (!r.ok || !j?.ok) {
        setError(j?.error ?? `Save failed (${r.status})`);
        return;
      }
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSavingKey(null);
    }
  }

  function addEventVariant(baseKey: string) {
    const raw = String(newEventByBase[baseKey] ?? "").trim();
    const eventKey = raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
    if (!eventKey) return;
    const composite = `${baseKey}::${eventKey}`;

    setDrafts((prev) => {
      if (prev[composite]) return prev;
      const baseRow = pages.find((p) => p.pageKey === baseKey) ?? null;
      const fallback = baseRow?.defaultMessage ?? "";
      return { ...prev, [composite]: { enabled: true, message: fallback } };
    });
    setPages((prev) => {
      if (prev.some((p) => p.pageKey === composite)) return prev;
      const baseRow = pages.find((p) => p.pageKey === baseKey) ?? null;
      const label = baseRow ? `${baseRow.label} — event: ${eventKey}` : `${baseKey} — event: ${eventKey}`;
      const paths = baseRow?.paths ?? [];
      const defaultMessage = baseRow?.defaultMessage ?? "";
      return [
        ...prev,
        {
          pageKey: composite,
          baseKey,
          eventKey,
          label,
          paths,
          defaultMessage,
          current: { enabled: false, message: null, updatedAt: null },
        },
      ];
    });
    setNewEventByBase((prev) => ({ ...prev, [baseKey]: "" }));
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-6 text-brand-cyan shadow-[0_18px_40px_rgba(10,20,60,0.35)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-brand-white">🤖 IntelliWattBot Messages</h1>
            <p className="mt-2 text-sm text-brand-cyan/75">
              Edit the message shown in the bot speech bubble per dashboard page. Saving updates the live site (no code deploy
              needed).
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <label className="text-xs font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">Admin token</label>
            <input
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="x-admin-token"
              className="w-full sm:w-[360px] rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-4 py-2 text-sm text-brand-white placeholder:text-brand-cyan/40 outline-none focus:border-brand-blue/60"
            />
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10 disabled:opacity-60"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? <div className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div> : null}

        <div className="mt-6 space-y-4">
          {pages.map((p) => {
            const d = drafts[p.pageKey] ?? { enabled: p.current.enabled, message: p.current.message ?? p.defaultMessage };
            const isSaving = savingKey === p.pageKey;
            const isBase = !p.pageKey.includes("::");
            const baseKey = isBase ? p.pageKey : (p.baseKey ?? p.pageKey.split("::")[0]);
            const eventOptions = isBase ? eventsForPageKey(baseKey) : [];
            return (
              <div key={p.pageKey} className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-brand-white">{p.label}</div>
                    <div className="mt-1 text-xs text-brand-cyan/60 font-mono truncate">{p.paths.join("  ")}</div>
                    <div className="mt-1 text-xs text-brand-cyan/55">
                      Current:{" "}
                      <span className="font-mono">
                        {p.current.enabled ? "enabled" : "disabled"} {p.current.updatedAt ? `· updated ${p.current.updatedAt}` : ""}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {isBase ? (
                      <div className="hidden sm:flex items-center gap-2">
                        <select
                          value={newEventByBase[p.pageKey] ?? ""}
                          onChange={(e) => setNewEventByBase((prev) => ({ ...prev, [p.pageKey]: e.target.value }))}
                          className="w-[260px] rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                        >
                          <option className="text-brand-navy" value="">
                            Choose event…
                          </option>
                          {eventOptions.map((ev) => (
                            <option key={ev.key} className="text-brand-navy" value={ev.key}>
                              {ev.label}
                            </option>
                          ))}
                          <option className="text-brand-navy" value="__custom__">
                            Custom…
                          </option>
                        </select>
                        {newEventByBase[p.pageKey] === "__custom__" ? (
                          <input
                            value={newEventByBase[`${p.pageKey}::__custom_value__`] ?? ""}
                            onChange={(e) =>
                              setNewEventByBase((prev) => ({ ...prev, [`${p.pageKey}::__custom_value__`]: e.target.value }))
                            }
                            placeholder="custom event key"
                            className="w-[200px] rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white placeholder:text-brand-cyan/40 outline-none focus:border-brand-blue/60"
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            const selected = newEventByBase[p.pageKey] ?? "";
                            const custom = newEventByBase[`${p.pageKey}::__custom_value__`] ?? "";
                            if (selected === "__custom__") {
                              setNewEventByBase((prev) => ({ ...prev, [p.pageKey]: String(custom) }));
                              window.setTimeout(() => addEventVariant(p.pageKey), 0);
                            } else {
                              addEventVariant(p.pageKey);
                            }
                          }}
                          className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10"
                        >
                          Add event message
                        </button>
                      </div>
                    ) : null}
                    <label className="flex items-center gap-2 text-xs text-brand-cyan/75 select-none">
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [p.pageKey]: { ...d, enabled: e.target.checked },
                          }))
                        }
                        className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                      />
                      Enabled
                    </label>
                    <button
                      type="button"
                      onClick={() => void save(p.pageKey)}
                      disabled={isSaving || loading}
                      className="rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy hover:border-brand-blue hover:bg-brand-blue/20 disabled:opacity-60"
                    >
                      {isSaving ? "Saving…" : "Save / Publish"}
                    </button>
                  </div>
                </div>

                <textarea
                  value={d.message}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [p.pageKey]: { ...d, message: e.target.value },
                    }))
                  }
                  rows={6}
                  className="mt-3 w-full rounded-2xl border border-brand-cyan/25 bg-brand-navy px-4 py-3 text-sm text-brand-white outline-none focus:border-brand-blue/60"
                />

                <div className="mt-2 text-[0.75rem] text-brand-cyan/55">
                  Default (fallback if disabled/empty):{" "}
                  <span className="font-mono">{p.defaultMessage.slice(0, 80)}{p.defaultMessage.length > 80 ? "…" : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


