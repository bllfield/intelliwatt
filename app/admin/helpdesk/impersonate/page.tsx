"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

type ApiResult =
  | { ok: true; [k: string]: any }
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

function pickAdminToken(): { token: string; source: TokenSourceKey | null; diag: Record<TokenSourceKey, string> } {
  const diag: Record<TokenSourceKey, string> = {
    "localStorage.intelliwattAdminToken": safeGetToken("localStorage.intelliwattAdminToken").trim(),
    "localStorage.intelliwatt_admin_token": safeGetToken("localStorage.intelliwatt_admin_token").trim(),
    "localStorage.iw_admin_token": safeGetToken("localStorage.iw_admin_token").trim(),
    "sessionStorage.ADMIN_TOKEN": safeGetToken("sessionStorage.ADMIN_TOKEN").trim(),
  };

  // Priority:
  // 1) localStorage['intelliwattAdminToken'] (admin homepage)
  // 2) localStorage['intelliwatt_admin_token'] (newer tooling)
  // 3) sessionStorage['ADMIN_TOKEN'] (legacy)
  // 4) localStorage['iw_admin_token'] (older pages)
  if (diag["localStorage.intelliwattAdminToken"]) {
    return { token: diag["localStorage.intelliwattAdminToken"], source: "localStorage.intelliwattAdminToken", diag };
  }
  if (diag["localStorage.intelliwatt_admin_token"]) {
    return { token: diag["localStorage.intelliwatt_admin_token"], source: "localStorage.intelliwatt_admin_token", diag };
  }
  if (diag["sessionStorage.ADMIN_TOKEN"]) {
    return { token: diag["sessionStorage.ADMIN_TOKEN"], source: "sessionStorage.ADMIN_TOKEN", diag };
  }
  if (diag["localStorage.iw_admin_token"]) {
    return { token: diag["localStorage.iw_admin_token"], source: "localStorage.iw_admin_token", diag };
  }

  return { token: "", source: null, diag };
}

function maskToken(token: string): string {
  const t = String(token ?? "").trim();
  if (!t) return "(missing)";
  if (t.length <= 8) return "********";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export default function HelpdeskImpersonatePage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [durationMinutes, setDurationMinutes] = React.useState<number>(30);
  const [busy, setBusy] = React.useState(false);
  const [out, setOut] = React.useState<string>("");
  const [tokenInput, setTokenInput] = React.useState<string>("");
  const [refreshKey, setRefreshKey] = React.useState(0);

  const picked = React.useMemo(() => pickAdminToken(), [refreshKey]);

  React.useEffect(() => {
    // Pre-fill the token input from whatever is currently available.
    if (!tokenInput.trim() && picked.token) {
      setTokenInput(picked.token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.token]);

  React.useEffect(() => {
    // Allow other admin tools to deep-link into this page with an email prefilled.
    const qEmail = searchParams?.get("email") ?? "";
    if (qEmail.trim() && !email.trim()) {
      setEmail(qEmail.trim());
    }
  }, [searchParams, email]);

  function persistToken(value: string) {
    const trimmed = value.trim();
    setTokenInput(value);
    try {
      if (trimmed) {
        // Prefer the admin homepage key so other tools see it.
        window.localStorage.setItem("intelliwattAdminToken", trimmed);
        // Keep compatibility for newer tooling that reads this key.
        window.localStorage.setItem("intelliwatt_admin_token", trimmed);
      } else {
        window.localStorage.removeItem("intelliwattAdminToken");
        window.localStorage.removeItem("intelliwatt_admin_token");
      }
    } catch {
      // ignore
    } finally {
      setRefreshKey((n) => n + 1);
    }
  }

  async function startImpersonation() {
    const token = tokenInput.trim() || picked.token;
    if (!token) {
      setOut("Missing admin token. Set it above first (x-admin-token).");
      return;
    }
    if (!email.trim()) {
      setOut("Enter a user email to impersonate.");
      return;
    }
    if (!reason.trim()) {
      setOut("Enter a reason. (This is stored in the audit log.)");
      return;
    }

    setBusy(true);
    setOut("Starting impersonation…");
    try {
      const res = await fetch("/api/admin/helpdesk/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ email: email.trim(), reason: reason.trim(), durationMinutes }),
      });

      const raw = await res.text();
      let json: ApiResult | null = null;
      try {
        json = raw ? (JSON.parse(raw) as ApiResult) : null;
      } catch {
        json = null;
      }

      if (!res.ok || json?.ok !== true) {
        const msg = json?.error || json?.message || `HTTP ${res.status} ${res.statusText}`;
        setOut(`Failed: ${msg}\n\nRaw:\n${raw}`);
        return;
      }

      setOut("Impersonation started. Redirecting to /dashboard …");
      window.location.href = "/dashboard";
    } catch (e: any) {
      setOut(`Request error: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stopImpersonation() {
    const token = tokenInput.trim() || picked.token;
    if (!token) {
      setOut("Missing admin token. Set it above first (x-admin-token).");
      return;
    }

    setBusy(true);
    setOut("Stopping impersonation…");
    try {
      const res = await fetch("/api/admin/helpdesk/impersonate/stop", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
      });

      const raw = await res.text();
      let json: ApiResult | null = null;
      try {
        json = raw ? (JSON.parse(raw) as ApiResult) : null;
      } catch {
        json = null;
      }

      if (!res.ok || json?.ok !== true) {
        const msg = json?.error || json?.message || `HTTP ${res.status} ${res.statusText}`;
        setOut(`Failed: ${msg}\n\nRaw:\n${raw}`);
        return;
      }

      setOut("Impersonation stopped. Redirecting to /admin …");
      window.location.href = "/admin";
    } catch (e: any) {
      setOut(`Request error: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-brand-navy">Help desk: access user dashboard</h1>
        <p className="mt-2 text-sm text-brand-navy/70">
          Temporarily impersonate a user session by email. This grants full user access and is time-bounded and audited.
        </p>
      </div>

      <div className="rounded-2xl border border-brand-blue/15 bg-brand-white p-5 shadow-sm space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-brand-navy mb-1">x-admin-token</label>
            <input
              value={tokenInput}
              onChange={(e) => persistToken(e.target.value)}
              placeholder="Paste ADMIN_TOKEN here"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
            />
            <div className="mt-2 text-xs text-brand-navy/60">
              Detected token source:{" "}
              <span className="font-mono">{picked.source ?? "(none)"}</span> ·{" "}
              <span className="font-mono">{maskToken(picked.token)}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-brand-navy mb-1">Duration</label>
            <select
              value={String(durationMinutes)}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes (default)</option>
              <option value="60">60 minutes</option>
              <option value="120">120 minutes (max)</option>
            </select>
            <div className="mt-2 text-xs text-brand-navy/60">
              Server enforces max TTL; this only controls cookie expiry and audit metadata.
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-brand-navy mb-1">User email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              inputMode="email"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-brand-navy mb-1">Reason (required)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., onboarding assistance, troubleshooting, user requested help"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startImpersonation}
            disabled={busy}
            className={[
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 font-semibold uppercase tracking-wide transition",
              busy
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
                : "border-rose-400 bg-rose-50 text-rose-700 hover:bg-rose-100",
            ].join(" ")}
          >
            {busy ? "Working…" : "Start impersonation"}
          </button>

          <button
            type="button"
            onClick={stopImpersonation}
            disabled={busy}
            className={[
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 font-semibold uppercase tracking-wide transition",
              busy
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
                : "border-brand-blue/40 bg-brand-blue/10 text-brand-blue hover:bg-brand-blue/20",
            ].join(" ")}
          >
            {busy ? "Working…" : "Stop impersonation"}
          </button>

          <a
            href="/admin"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Back to Admin
          </a>
        </div>

        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <div className="font-semibold">Safety</div>
          <ul className="mt-1 list-disc pl-5 space-y-1 text-rose-900/90">
            <li>This sets the user session cookie to the target email.</li>
            <li>All help-desk access is logged to the database with your admin identity + reason.</li>
            <li>A dashboard banner will appear while impersonating, with a one-click stop action.</li>
          </ul>
        </div>
      </div>

      {out ? (
        <pre className="mt-5 max-h-80 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100 whitespace-pre-wrap">
          {out}
        </pre>
      ) : null}
    </div>
  );
}

