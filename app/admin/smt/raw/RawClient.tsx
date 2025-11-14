"use client";

import React, { useEffect, useMemo, useState, FormEvent } from "react";

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

export default function AdminSmtRawClient() {
  const [baseUrl, setBaseUrl] = useState<string>(() =>
    typeof window !== "undefined" ? window.location.origin : "https://intelliwatt.com",
  );
  const [adminToken, setAdminToken] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);
  const [since, setSince] = useState<string>("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [out, setOut] = useState<string>("");
  const [dropletBusy, setDropletBusy] = useState<boolean>(false);
  const [dropletStatus, setDropletStatus] = useState<string>("");

  const dropletUploadUrl = process.env.NEXT_PUBLIC_SMT_UPLOAD_URL || "";

  const DROPLET_ACCOUNT_KEY = "intelliwatt-admin";

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
      const url = `${baseUrl}/api/admin/debug/smt/raw-files?limit=${encodeURIComponent(String(limit))}`;
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

  async function handleDropletUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dropletUploadUrl) {
      setDropletStatus("❗ Set NEXT_PUBLIC_SMT_UPLOAD_URL to enable droplet uploads.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) {
      setDropletStatus("❗ Choose a CSV file before uploading.");
      return;
    }

    formData.set("role", "admin");
    if (!formData.get("accountKey")) {
      formData.set("accountKey", DROPLET_ACCOUNT_KEY);
    }

    setDropletBusy(true);
    setDropletStatus("Uploading to droplet…");
    try {
      const response = await fetch(dropletUploadUrl, {
        method: "POST",
        body: formData,
        mode: "cors",
        credentials: "omit",
      });
      const rawText = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(rawText);
      } catch {
        // keep raw text for fallback message
      }

      if (!response.ok) {
        if (response.status === 429 && json) {
          const resetAt = json.resetAt ? `window resets at ${json.resetAt}` : "rate limit window resets soon";
          setDropletStatus(
            `❌ Rate limit hit (${json.limit} uploads per window). Remaining: 0. ${resetAt}.`,
          );
        } else if (json?.message) {
          setDropletStatus(`❌ Upload failed: ${json.message}`);
        } else {
          setDropletStatus(`❌ Upload failed (HTTP ${response.status}): ${rawText || "see droplet logs"}`);
        }
        return;
      }

      if (json?.ok) {
        const remaining =
          typeof json.remaining === "number" ? ` (remaining uploads this window: ${json.remaining})` : "";
        setDropletStatus(
          `✅ Uploaded ${file.name} (${file.size.toLocaleString()} bytes). Ingest queued.${remaining}`,
        );
        form.reset();
      } else {
        setDropletStatus("Upload succeeded but response format was unexpected.");
      }
    } catch (err: any) {
      setDropletStatus(`❌ Upload failed: ${err?.message || String(err)}`);
    } finally {
      setDropletBusy(false);
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
      <h2 className="text-xl font-semibold">Raw SMT File Browser</h2>

      <section className="border border-amber-200 rounded-lg p-4 bg-amber-50 space-y-3">
        <h3 className="text-lg font-medium">Big-file Upload (Droplet Pipeline)</h3>
        <p className="text-sm text-gray-700">
          For full-size SMT interval CSVs (12 months of 15-minute reads), upload directly to the droplet inbox.
          This uses the same pipeline as automated ingest (`smt-ingest.service`). Configure
          <code className="mx-1">NEXT_PUBLIC_SMT_UPLOAD_URL</code> to point at the droplet upload server, e.g.
          <code className="mx-1">http://64.225.25.54:8080/upload</code>.
        </p>
        <form onSubmit={handleDropletUpload} encType="multipart/form-data" className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">SMT CSV file</label>
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <input type="hidden" name="role" value="admin" />
          <input type="hidden" name="accountKey" value={DROPLET_ACCOUNT_KEY} />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="px-4 py-2 rounded bg-black text-white text-sm font-medium disabled:opacity-50"
              disabled={dropletBusy}
            >
              {dropletBusy ? "Uploading…" : "Upload to Droplet"}
            </button>
            <p className="text-xs text-gray-600">
              After success, wait a few moments, then click “Load Raw Files” below to confirm ingestion.
            </p>
          </div>
        </form>
        {dropletStatus ? (
          <div className="rounded border border-amber-300 bg-white px-3 py-2 text-sm text-gray-800">
            {dropletStatus}
          </div>
        ) : null}
      </section>

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
        <button type="button" className="px-3 py-2 rounded bg-gray-100 border" onClick={saveSession}>
          Save Session
        </button>
        <button type="button" className="px-3 py-2 rounded bg-gray-100 border" onClick={loadSession}>
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
        This section uses admin routes <code>/api/admin/debug/smt/raw-files</code> and{" "}
        <code>/api/admin/smt/normalize</code>. Headers and JSON keys are unchanged from the locked plan.
      </p>
    </div>
  );
}

