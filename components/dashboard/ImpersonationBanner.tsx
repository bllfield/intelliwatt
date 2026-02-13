"use client";

import * as React from "react";

type Status =
  | { ok: true; impersonating: false }
  | {
      ok: true;
      impersonating: true;
      auditId: string | null;
      adminEmail: string | null;
      targetEmail: string | null;
      expiresAt: string | null;
    }
  | { ok?: false; error?: string; message?: string; [k: string]: any };

type TokenSourceKey =
  | "localStorage.intelliwattAdminToken"
  | "localStorage.intelliwatt_admin_token"
  | "localStorage.iw_admin_token"
  | "sessionStorage.ADMIN_TOKEN";

function safeGetToken(key: TokenSourceKey): string {
  try {
    if (key === "localStorage.intelliwattAdminToken") return window.localStorage.getItem("intelliwattAdminToken") || "";
    if (key === "localStorage.intelliwatt_admin_token") return window.localStorage.getItem("intelliwatt_admin_token") || "";
    if (key === "localStorage.iw_admin_token") return window.localStorage.getItem("iw_admin_token") || "";
    return window.sessionStorage.getItem("ADMIN_TOKEN") || "";
  } catch {
    return "";
  }
}

function pickAdminToken(): string {
  const a = safeGetToken("localStorage.intelliwattAdminToken").trim();
  if (a) return a;
  const b = safeGetToken("localStorage.intelliwatt_admin_token").trim();
  if (b) return b;
  const c = safeGetToken("sessionStorage.ADMIN_TOKEN").trim();
  if (c) return c;
  const d = safeGetToken("localStorage.iw_admin_token").trim();
  if (d) return d;
  return "";
}

function fmtTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  try {
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function ImpersonationBanner() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string>("");

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/user/impersonation/status", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as Status | null;
      if (!json) {
        setStatus({ ok: false, error: "Failed to read impersonation status" });
        return;
      }
      setStatus(json);
    } catch (e: any) {
      setStatus({ ok: false, error: e?.message || String(e) });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const impersonating = status && (status as any).ok === true && (status as any).impersonating === true;
  if (!impersonating) return null;

  const s = status as Extract<Status, { ok: true; impersonating: true }>;
  const expiresAtLabel = fmtTime(s.expiresAt);

  async function stop() {
    setMsg("");
    const token = pickAdminToken();
    if (!token) {
      setMsg("Missing admin token in this browser. Go to /admin → Help desk tool to stop impersonation.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/helpdesk/impersonate/stop", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
      });
      const raw = await res.text();
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }
      if (!res.ok || json?.ok !== true) {
        const e = json?.error || json?.message || `HTTP ${res.status} ${res.statusText}`;
        setMsg(`Stop failed: ${e}`);
        return;
      }
      // Reload to ensure all user-derived server components are rendered with the restored session.
      window.location.href = "/admin";
    } catch (e: any) {
      setMsg(`Stop failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="font-semibold">
            You are impersonating a user dashboard session
            {s.targetEmail ? (
              <>
                {" "}
                <span className="font-mono text-[13px]">({s.targetEmail})</span>
              </>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-rose-900/80">
            Admin: <span className="font-mono text-[13px]">{s.adminEmail ?? "(unknown)"}</span>
            {expiresAtLabel ? (
              <>
                {" "}
                · Expires: <span className="font-mono text-[13px]">{expiresAtLabel}</span>
              </>
            ) : null}
          </div>
          {msg ? <div className="mt-2 text-sm font-semibold text-rose-800">{msg}</div> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={stop}
            disabled={busy}
            className={[
              "rounded-full border px-4 py-2 text-sm font-semibold uppercase tracking-wide transition",
              busy
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
                : "border-rose-400 bg-rose-600 text-white hover:bg-rose-700",
            ].join(" ")}
          >
            {busy ? "Stopping…" : "Stop impersonating"}
          </button>
          <a
            href="/admin/helpdesk/impersonate"
            className="rounded-full border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100"
          >
            Help desk tool
          </a>
        </div>
      </div>
    </div>
  );
}

