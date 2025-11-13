"use client";

import React, { useState } from "react";

export default function AdminSmtTriggerPage() {
  const [baseUrl, setBaseUrl] = useState<string>(() =>
    typeof window !== "undefined"
      ? window.location.origin || "https://intelliwatt.com"
      : "https://intelliwatt.com",
  );
  const [adminToken, setAdminToken] = useState<string>("");
  const [esiid, setEsiid] = useState<string>("10443720000000001");
  const [meter, setMeter] = useState<string>("M1");
  const [busy, setBusy] = useState<boolean>(false);
  const [out, setOut] = useState<string>("");

  async function triggerPull() {
    setOut("");
    if (!baseUrl || !adminToken || !esiid || !meter) {
      setOut("❗ Required: Base URL, Admin Token, ESIID, Meter");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${baseUrl}/api/admin/smt/pull`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify({ esiid, meter }),
      });
      const json = await res.json().catch(() => ({}));
      setOut([`HTTP ${res.status}`, JSON.stringify(json, null, 2)].join("\n"));
    } catch (e: any) {
      setOut(`ERROR: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function saveSession() {
    try {
      sessionStorage.setItem("ADMIN_TOKEN", adminToken);
      sessionStorage.setItem("INTELLIWATT_BASE_URL", baseUrl);
      setOut("✅ Saved to sessionStorage (ADMIN_TOKEN, INTELLIWATT_BASE_URL).");
    } catch {
      setOut("⚠️ Could not save to sessionStorage (blocked?).");
    }
  }

  function loadSession() {
    try {
      const at = sessionStorage.getItem("ADMIN_TOKEN") || "";
      const bu = sessionStorage.getItem("INTELLIWATT_BASE_URL") || baseUrl;
      setAdminToken(at);
      setBaseUrl(bu);
      setOut("📦 Loaded from sessionStorage.");
    } catch {
      setOut("⚠️ Could not load from sessionStorage.");
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Admin · SMT Trigger</h1>

      <div className="grid grid-cols-1 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">Base URL</span>
          <input
            className="border rounded px-3 py-2"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://intelliwatt.com"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">
            Admin Token (x-admin-token)
          </span>
          <input
            className="border rounded px-3 py-2"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="paste 64-char token"
          />
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={saveSession}
            className="px-3 py-2 rounded bg-gray-100 border"
          >
            Save to Session
          </button>
          <button
            type="button"
            onClick={loadSession}
            className="px-3 py-2 rounded bg-gray-100 border"
          >
            Load from Session
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">ESIID</span>
            <input
              className="border rounded px-3 py-2"
              value={esiid}
              onChange={(e) => setEsiid(e.target.value)}
              placeholder="1044…"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Meter</span>
            <input
              className="border rounded px-3 py-2"
              value={meter}
              onChange={(e) => setMeter(e.target.value)}
              placeholder="M1"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={triggerPull}
          disabled={busy}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {busy ? "Triggering..." : "Trigger SMT Pull"}
        </button>
      </div>

      <pre className="whitespace-pre-wrap text-sm bg-gray-50 border rounded p-3">
        {out || "Output will appear here…"}
      </pre>

      <p className="text-xs text-gray-500">
        This helper POSTs <code>/api/admin/smt/pull</code> with body{" "}
        <code>{"{ esiid, meter }"}</code> and header <code>x-admin-token</code>.
        Inline uploads and droplet webhook paths are unchanged.
      </p>
    </div>
  );
}

