"use client";

import * as React from "react";

type BackfillResult =
  | { ok: true; [k: string]: any }
  | { ok?: false; error?: string; message?: string; [k: string]: any };

function getAdminToken(): string {
  try {
    const ls = window.localStorage.getItem("intelliwatt_admin_token");
    if (ls && ls.trim()) return ls.trim();

    const ss = window.sessionStorage.getItem("ADMIN_TOKEN");
    if (ss && ss.trim()) return ss.trim();
  } catch {
    // ignore
  }
  return "";
}

export default function BackfillButton() {
  const [busy, setBusy] = React.useState(false);
  const [out, setOut] = React.useState<string>("");

  async function runBackfill() {
    const token = getAdminToken();
    if (!token) {
      setOut(
        "Missing admin token. Set localStorage['intelliwatt_admin_token'] or sessionStorage['ADMIN_TOKEN'].",
      );
      return;
    }

    setBusy(true);
    setOut("Running backfill...");

    try {
      const res = await fetch("/api/admin/efl/backfill", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({}),
      });

      const text = await res.text();
      let json: BackfillResult | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      if (!res.ok) {
        const msg = json?.error || json?.message || `HTTP ${res.status} ${res.statusText}` || "Backfill failed";
        setOut(`Backfill failed: ${msg}\n\nRaw:\n${text}`);
        return;
      }

      setOut(`Backfill OK\n\n${json ? JSON.stringify(json, null, 2) : text}`);
    } catch (e: any) {
      setOut(`Request error: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">EFL Template Backfill</div>
          <div className="text-xs text-slate-600">
            Runs{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">POST /api/admin/efl/backfill</code> using{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">x-admin-token</code>.
          </div>
        </div>

        <button
          type="button"
          onClick={runBackfill}
          disabled={busy}
          className={[
            "rounded-lg px-3 py-2 text-sm font-semibold",
            busy ? "cursor-not-allowed bg-slate-200 text-slate-600" : "bg-slate-900 text-white hover:bg-slate-800",
          ].join(" ")}
        >
          {busy ? "Running…" : "Backfill Now"}
        </button>
      </div>

      {out ? (
        <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100 whitespace-pre-wrap">
          {out}
        </pre>
      ) : null}
    </div>
  );
}


