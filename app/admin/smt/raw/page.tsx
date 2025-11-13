"use client";

import React, { useEffect, useMemo, useState } from "react";

type RawRow = {
  id: string | number;
  filename: string;
  sha256?: string;
  sizeBytes?: number;
  received_at?: string;
  captured_at?: string | null;
  esiid?: string | null;
  meter?: string | null;
};

export default function AdminSmtRawPage() {
  const [baseUrl, setBaseUrl] = useState<string>(() =>
    typeof window !== "undefined" ? window.location.origin : "https://intelliwatt.com",
  );
  const [adminToken, setAdminToken] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);
  const [since, setSince] = useState<string>("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [out, setOut] = useState<string>("");

  const headers = useMemo(
    () => ({
      "content-type": "application/json",
      "x-admin-token": adminToken || "",
    }),
    [adminToken],
  );

  function saveSession() {
    try {
      sessionStorage.setItem("ADMIN_TOKEN", adminToken);
      sessionStorage.setItem("INTELLIWATT_BASE_URL", baseUrl);
      setOut("✅ Saved ADMIN_TOKEN and BASE_URL to sessionStorage.");
    } catch {
      setOut("⚠️ Could not save to sessionStorage.");
    }
  }
  function loadSession() {
    try {
      const at = sessionStorage.getItem("ADMIN_TOKEN") || "";
      const bu = sessionStorage.getItem("INTELLIWATT_BASE_URL") || baseUrl;
      setAdminToken(at);
      setBaseUrl(bu);
      setOut("📦 Loaded ADMIN_TOKEN and BASE_URL from sessionStorage.");
    } catch {
      setOut("⚠️ Could not load from sessionStorage.");
    }
  }

  async function fetchRaw() {
    if (!adminToken) {
      setOut("❗ Enter your admin token first.");
      return;
    }
    setBusy(true);
    setOut("");
    try {
      const url = `${baseUrl}/api/admin/debug/smt/raw-files?limit=${encodeURIComponent(
        String(limit),
      )}`;
      const res = await fetch(url, { headers });
      const json = await res.json();
      const list: RawRow[] = Array.isArray(json?.files) ? json.files : json;
      setRows(list || []);
      setOut(`HTTP ${res.status}; loaded ${list?.length ?? 0} file(s).`);
    } catch (e: any) {
      setOut(`ERROR loading raw files: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function normalizeLatest() {
    if (!adminToken) {
      setOut("❗ Enter your admin token first.");
      return;
    }
    setBusy(true);
    setOut("");
    try {
      const res = await fetch(`${baseUrl}/api/admin/smt/normalize`, {
        method: "POST",
        headers,
        body: JSON.stringify({ latest: true }),
      });
      const json = await res.json().catch(() => ({}));
      setOut(`HTTP ${res.status}\n${JSON.stringify(json, null, 2)}`);
    } catch (e: any) {
      setOut(`ERROR normalize latest: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function normalizeSince() {
    if (!adminToken) {
      setOut("❗ Enter your admin token first.");
      return;
    }
    if (!since) {
      setOut("❗ Enter an ISO timestamp in the Since field.");
      return;
    }
    setBusy(true);
    setOut("");
    try {
      const res = await fetch(`${baseUrl}/api/admin/smt/normalize`, {
        method: "POST",
        headers,
        body: JSON.stringify({ since }),
      });
      const json = await res.json().catch(() => ({}));
      setOut(`HTTP ${res.status}\n${JSON.stringify(json, null, 2)}`);
    } catch (e: any) {
      setOut(`ERROR normalize since: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function normalizeOne(rawId: string | number) {
    if (!adminToken) {
      setOut("❗ Enter your admin token first.");
      return;
    }
    setBusy(true);
    setOut("");
    try {
      const res = await fetch(`${baseUrl}/api/admin/smt/normalize`, {
        method: "POST",
        headers,
        body: JSON.stringify({ rawId }),
      });
      const json = await res.json().catch(() => ({}));
      setOut(`HTTP ${res.status}\n${JSON.stringify(json, null, 2)}`);
    } catch (e: any) {
      setOut(`ERROR normalize rawId=${rawId}: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    try {
      const at = sessionStorage.getItem("ADMIN_TOKEN");
      const bu = sessionStorage.getItem("INTELLIWATT_BASE_URL");
      if (at) setAdminToken(at);
      if (bu) setBaseUrl(bu);
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Admin · Raw SMT Files</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <span className="text-sm text-gray-600">Admin Token (x-admin-token)</span>
          <input
            className="border rounded px-3 py-2"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="paste 64-char token"
          />
        </label>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 grow">
            <span className="text-sm text-gray-600">Limit</span>
            <input
              type="number"
              className="border rounded px-3 py-2"
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value || "0", 10))}
              min={1}
              max={200}
            />
          </label>
          <button
            type="button"
            className="px-3 py-2 rounded bg-gray-100 border"
            onClick={fetchRaw}
            disabled={busy}
          >
            {busy ? "Loading…" : "Load Raw Files"}
          </button>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 grow">
            <span className="text-sm text-gray-600">Since (ISO, optional bulk normalize)</span>
            <input
              className="border rounded px-3 py-2"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              placeholder="2025-11-01T00:00:00Z"
            />
          </label>
          <button
            type="button"
            className="px-3 py-2 rounded bg-gray-100 border"
            onClick={normalizeSince}
            disabled={busy}
          >
            {busy ? "Normalizing…" : "Normalize Since"}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          onClick={normalizeLatest}
          disabled={busy}
        >
          {busy ? "Normalizing…" : "Normalize Latest"}
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded bg-gray-100 border"
          onClick={saveSession}
        >
          Save Session
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded bg-gray-100 border"
          onClick={loadSession}
        >
          Load Session
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border">
          <thead className="bg-gray-50">
            <tr>
              <th className="border px-2 py-1 text-left">ID</th>
              <th className="border px-2 py-1 text-left">Filename</th>
              <th className="border px-2 py-1 text-left">ESIID</th>
              <th className="border px-2 py-1 text-left">Meter</th>
              <th className="border px-2 py-1 text-left">Received</th>
              <th className="border px-2 py-1 text-left">Captured</th>
              <th className="border px-2 py-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length ? (
              rows.map((r) => (
                <tr key={String(r.id)}>
                  <td className="border px-2 py-1">{r.id}</td>
                  <td className="border px-2 py-1">{r.filename}</td>
                  <td className="border px-2 py-1">{r.esiid ?? ""}</td>
                  <td className="border px-2 py-1">{r.meter ?? ""}</td>
                  <td className="border px-2 py-1">
                    {r.received_at ? new Date(r.received_at).toLocaleString() : ""}
                  </td>
                  <td className="border px-2 py-1">
                    {r.captured_at ? new Date(r.captured_at).toLocaleString() : ""}
                  </td>
                  <td className="border px-2 py-1 text-center">
                    <button
                      type="button"
                      className="px-3 py-1 rounded bg-black text-white disabled:opacity-50"
                      onClick={() => normalizeOne(r.id)}
                      disabled={busy}
                      title="Normalize this file now"
                    >
                      Normalize now
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="border px-2 py-3 text-center" colSpan={7}>
                  {busy ? "Loading…" : "No rows loaded yet. Click “Load Raw Files.”"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <pre className="whitespace-pre-wrap text-sm bg-gray-50 border rounded p-3">
        {out || "Output will appear here…"}
      </pre>

      <p className="text-xs text-gray-500">
        This page uses existing admin routes: <code>/api/admin/debug/smt/raw-files</code> and{" "}
        <code>/api/admin/smt/normalize</code>. Headers and JSON keys are unchanged from the locked
        plan.
      </p>
    </div>
  );
}

