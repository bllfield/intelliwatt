"use client";

import * as React from "react";

type BackfillResult =
  | { ok: true; [k: string]: any }
  | { ok?: false; error?: string; message?: string; [k: string]: any };

type TokenSourceKey = "localStorage.intelliwatt_admin_token" | "localStorage.iw_admin_token" | "sessionStorage.ADMIN_TOKEN";

function safeGetToken(key: TokenSourceKey): string {
  try {
    if (key === "localStorage.intelliwatt_admin_token") return window.localStorage.getItem("intelliwatt_admin_token") || "";
    if (key === "localStorage.iw_admin_token") return window.localStorage.getItem("iw_admin_token") || "";
    return window.sessionStorage.getItem("ADMIN_TOKEN") || "";
  } catch {
    return "";
  }
}

function maskToken(token: string): string {
  const t = String(token ?? "").trim();
  if (!t) return "(missing)";
  if (t.length <= 8) return "********";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function pickAdminToken(): { token: string; source: TokenSourceKey | null; diag: Record<TokenSourceKey, string> } {
  const diag: Record<TokenSourceKey, string> = {
    "localStorage.intelliwatt_admin_token": safeGetToken("localStorage.intelliwatt_admin_token").trim(),
    "localStorage.iw_admin_token": safeGetToken("localStorage.iw_admin_token").trim(),
    "sessionStorage.ADMIN_TOKEN": safeGetToken("sessionStorage.ADMIN_TOKEN").trim(),
  };

  // Priority:
  // 1) localStorage['intelliwatt_admin_token']
  // 2) sessionStorage['ADMIN_TOKEN']
  // Extra fallback for this page's existing token input:
  // 3) localStorage['iw_admin_token']
  if (diag["localStorage.intelliwatt_admin_token"]) return { token: diag["localStorage.intelliwatt_admin_token"], source: "localStorage.intelliwatt_admin_token", diag };
  if (diag["sessionStorage.ADMIN_TOKEN"]) return { token: diag["sessionStorage.ADMIN_TOKEN"], source: "sessionStorage.ADMIN_TOKEN", diag };
  if (diag["localStorage.iw_admin_token"]) return { token: diag["localStorage.iw_admin_token"], source: "localStorage.iw_admin_token", diag };

  return { token: "", source: null, diag };
}

function setLocalStorageAdminTokenFromIwToken(): { ok: boolean; msg: string } {
  try {
    const iw = (window.localStorage.getItem("iw_admin_token") || "").trim();
    if (!iw) return { ok: false, msg: "localStorage['iw_admin_token'] is empty. Use the x-admin-token input above first." };
    window.localStorage.setItem("intelliwatt_admin_token", iw);
    return { ok: true, msg: "Copied iw_admin_token → intelliwatt_admin_token." };
  } catch {
    return { ok: false, msg: "Failed to write localStorage. Check browser privacy settings." };
  }
}

export default function BackfillButton() {
  const [busy, setBusy] = React.useState(false);
  const [out, setOut] = React.useState<string>("");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [zip, setZip] = React.useState<string>("75201");

  const picked = React.useMemo(() => pickAdminToken(), [refreshKey]);

  async function runBackfill() {
    const token = picked.token;
    if (!token) {
      setOut(
        [
          "Missing admin token.",
          "",
          "Expected ONE of:",
          "- localStorage['intelliwatt_admin_token']",
          "- sessionStorage['ADMIN_TOKEN']",
          "",
          "This page also stores the typed token under localStorage['iw_admin_token'] (x-admin-token input).",
          "Use the 'Use token from x-admin-token input' button below to copy it into the expected key.",
        ].join("\n"),
      );
      return;
    }

    setBusy(true);
    setOut(`Running backfill... (token source: ${picked.source ?? "unknown"})`);

    try {
      const res = await fetch("/api/admin/efl/backfill", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ zip: (zip || "75201").trim() }),
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

        <div className="flex items-center gap-2">
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            inputMode="numeric"
            placeholder="ZIP (e.g., 75201)"
            className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
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
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold text-slate-900">Token diagnostics</div>
          <button
            type="button"
            onClick={() => setRefreshKey((n) => n + 1)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>
        <div className="mt-2 grid gap-1">
          <div>
            <span className="font-mono">localStorage["intelliwatt_admin_token"]</span>:{" "}
            <span className={picked.diag["localStorage.intelliwatt_admin_token"] ? "text-emerald-700" : "text-rose-700"}>
              {maskToken(picked.diag["localStorage.intelliwatt_admin_token"])}
            </span>
          </div>
          <div>
            <span className="font-mono">sessionStorage["ADMIN_TOKEN"]</span>:{" "}
            <span className={picked.diag["sessionStorage.ADMIN_TOKEN"] ? "text-emerald-700" : "text-rose-700"}>
              {maskToken(picked.diag["sessionStorage.ADMIN_TOKEN"])}
            </span>
          </div>
          <div>
            <span className="font-mono">localStorage["iw_admin_token"]</span>:{" "}
            <span className={picked.diag["localStorage.iw_admin_token"] ? "text-emerald-700" : "text-rose-700"}>
              {maskToken(picked.diag["localStorage.iw_admin_token"])}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const r = setLocalStorageAdminTokenFromIwToken();
                setOut(r.ok ? `OK: ${r.msg}` : `Error: ${r.msg}`);
                setRefreshKey((n) => n + 1);
              }}
              className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Use token from x-admin-token input
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  window.localStorage.removeItem("intelliwatt_admin_token");
                } catch {
                  // ignore
                }
                setOut("Cleared localStorage['intelliwatt_admin_token'].");
                setRefreshKey((n) => n + 1);
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
            >
              Clear intelliwatt_admin_token
            </button>
          </div>
        </div>
      </div>

      {out ? (
        <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100 whitespace-pre-wrap">
          {out}
        </pre>
      ) : null}
    </div>
  );
}


