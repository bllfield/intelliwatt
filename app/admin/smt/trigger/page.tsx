"use client";

import React, { useState, useTransition } from "react";
import { runSmtAgreementTest, runSmtMeterPipelineTest } from "../actions";
import { lookupSmtHousesByEmail, type AdminHouseOption } from "@/app/admin/smt/_lib/houseLookup";

export default function AdminSmtTriggerPage() {
  const [baseUrl, setBaseUrl] = useState<string>(() =>
    typeof window !== "undefined"
      ? window.location.origin || "https://intelliwatt.com"
      : "https://intelliwatt.com",
  );
  const [adminToken, setAdminToken] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [houses, setHouses] = useState<AdminHouseOption[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string>("");
  const [houseLookupBusy, setHouseLookupBusy] = useState<boolean>(false);
  const [houseLookupError, setHouseLookupError] = useState<string>("");
  const [esiidOverride, setEsiidOverride] = useState<string>("");
  const [meter, setMeter] = useState<string>("M1");
  const [busy, setBusy] = useState<boolean>(false);
  const [out, setOut] = useState<string>("");

  const [testAddressLine1, setTestAddressLine1] = useState<string>("");
  const [testAddressLine2, setTestAddressLine2] = useState<string>("");
  const [testCity, setTestCity] = useState<string>("");
  const [testState, setTestState] = useState<string>("TX");
  const [testZip, setTestZip] = useState<string>("");
  const [testCustomerName, setTestCustomerName] = useState<string>("");
  const [testCustomerEmail, setTestCustomerEmail] = useState<string>("");
  const [testRepNumber, setTestRepNumber] = useState<string>("");
  const [testEsiidOverride, setTestEsiidOverride] = useState<string>("");
  const [testResult, setTestResult] = useState<string>("Output will appear here…");
  const [pipelineResult, setPipelineResult] = useState<string>("Output will appear here…");
  const [isTesting, startTesting] = useTransition();
  const [isPipelineTesting, startPipelineTesting] = useTransition();
  const selectedHouse = houses.find((house) => house.id === selectedHouseId) ?? null;

  function handleAgreementTest() {
    const pendingMessage = "Running SMT agreement test…";
    setTestResult(pendingMessage);
    startTesting(async () => {
      try {
        const result = await runSmtAgreementTest({
          addressLine1: testAddressLine1,
          addressLine2: testAddressLine2 || undefined,
          city: testCity,
          state: testState,
          zip: testZip,
          customerName: testCustomerName,
          customerEmail: testCustomerEmail,
          repPuctNumber: testRepNumber,
          esiidOverride: testEsiidOverride || undefined,
        });
        setTestResult(JSON.stringify(result, null, 2));
      } catch (error: any) {
        setTestResult(`ERROR: ${error?.message || String(error)}`);
      }
    });
  }

  function handleMeterPipelineTest() {
    const pendingMessage = "Running WattBuy + meter info pipeline…";
    setPipelineResult(pendingMessage);
    startPipelineTesting(async () => {
      try {
        const result = await runSmtMeterPipelineTest({
          addressLine1: testAddressLine1,
          addressLine2: testAddressLine2 || undefined,
          city: testCity,
          state: testState,
          zip: testZip,
          esiidOverride: testEsiidOverride || undefined,
        });
        setPipelineResult(JSON.stringify(result, null, 2));
      } catch (error: any) {
        setPipelineResult(`ERROR: ${error?.message || String(error)}`);
      }
    });
  }

  async function loadHouses() {
    if (!adminToken.trim()) {
      setOut("❗ Admin token required before loading houses.");
      return;
    }
    setHouseLookupBusy(true);
    setHouseLookupError("");
    try {
      const result = await lookupSmtHousesByEmail({ email, token: adminToken });
      if (!result.ok) {
        setHouses([]);
        setSelectedHouseId("");
        setHouseLookupError(result.error ?? "house_lookup_failed");
        return;
      }
      const rows = result.houses ?? [];
      setHouses(rows);
      setSelectedHouseId(rows[0]?.id ?? "");
      if (rows.length === 0) {
        setHouseLookupError("No active houses found for that email.");
      }
    } catch (error: any) {
      setHouseLookupError(error?.message || "house_lookup_failed");
    } finally {
      setHouseLookupBusy(false);
    }
  }

  async function triggerPull() {
    setOut("");
    if (!baseUrl || !adminToken || (!selectedHouseId && !esiidOverride) || !meter) {
      setOut("❗ Required: Base URL, Admin Token, selected house or ESIID override, Meter");
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
        body: JSON.stringify({
          houseId: selectedHouseId || undefined,
          esiid: esiidOverride.trim() || undefined,
          meter,
        }),
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

      <div className="rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Agreement Flow Tester</h2>
          {isTesting ? (
            <span className="text-xs text-indigo-600">Running test…</span>
          ) : null}
        </div>
        <p className="text-sm text-gray-600">
          Provides end-to-end WattBuy → SMT meter info → Agreement/Subscription flow without touching customer data.
          All steps run against the droplet proxy using the configured credentials.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Address line 1</span>
            <input
              className="border rounded px-3 py-2"
              value={testAddressLine1}
              onChange={(e) => setTestAddressLine1(e.target.value)}
              placeholder="1012 Doreen St"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Address line 2 (optional)</span>
            <input
              className="border rounded px-3 py-2"
              value={testAddressLine2}
              onChange={(e) => setTestAddressLine2(e.target.value)}
              placeholder="Unit / Apt"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">City</span>
            <input
              className="border rounded px-3 py-2"
              value={testCity}
              onChange={(e) => setTestCity(e.target.value)}
              placeholder="White Settlement"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">State</span>
            <input
              className="border rounded px-3 py-2 uppercase"
              value={testState}
              onChange={(e) => setTestState(e.target.value)}
              placeholder="TX"
              maxLength={2}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">ZIP</span>
            <input
              className="border rounded px-3 py-2"
              value={testZip}
              onChange={(e) => setTestZip(e.target.value)}
              placeholder="76108"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">REP PUCT number</span>
            <input
              className="border rounded px-3 py-2"
              value={testRepNumber}
              onChange={(e) => setTestRepNumber(e.target.value)}
              placeholder="e.g. 10052"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Customer name</span>
            <input
              className="border rounded px-3 py-2"
              value={testCustomerName}
              onChange={(e) => setTestCustomerName(e.target.value)}
              placeholder="Customer of Record"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Customer email</span>
            <input
              className="border rounded px-3 py-2"
              value={testCustomerEmail}
              onChange={(e) => setTestCustomerEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-sm text-gray-600">ESIID override (optional)</span>
            <input
              className="border rounded px-3 py-2"
              value={testEsiidOverride}
              onChange={(e) => setTestEsiidOverride(e.target.value)}
              placeholder="Provide to skip WattBuy lookup"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleAgreementTest}
            disabled={isTesting}
            className="inline-flex items-center justify-center rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {isTesting ? "Running..." : "Run Agreement Flow Test"}
          </button>
          <button
            type="button"
            onClick={handleMeterPipelineTest}
            disabled={isPipelineTesting}
            className="inline-flex items-center justify-center rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {isPipelineTesting ? "Running..." : "Run ESIID + Meter Info Only"}
          </button>
        </div>

        <pre className="whitespace-pre-wrap text-sm bg-gray-50 border rounded p-3 overflow-x-auto">
          {testResult}
        </pre>

        <div>
          <h3 className="text-sm font-semibold text-gray-800">Meter pipeline output</h3>
          <pre className="mt-2 whitespace-pre-wrap text-sm bg-gray-50 border rounded p-3 overflow-x-auto">
            {pipelineResult}
          </pre>
        </div>

        <p className="text-xs text-gray-500">
          Sequence: resolve ESIID via WattBuy (unless override), queue &amp; wait for SMT meter info, then call the droplet
          <code> /agreements</code> proxy. Responses shown above include raw agreement results.
        </p>
      </div>

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

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-sm text-gray-600">User email</span>
            <input
              className="border rounded px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadHouses}
              disabled={houseLookupBusy}
              className="px-3 py-2 rounded bg-gray-100 border"
            >
              {houseLookupBusy ? "Loading..." : "Load Houses"}
            </button>
            {selectedHouse ? (
              <span className="text-xs text-gray-600">Selected: {selectedHouse.label}</span>
            ) : null}
            {houseLookupError ? <span className="text-xs text-red-600">{houseLookupError}</span> : null}
          </div>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-sm text-gray-600">House</span>
            <select
              className="border rounded px-3 py-2"
              value={selectedHouseId}
              onChange={(e) => setSelectedHouseId(e.target.value)}
            >
              <option value="">Select a house</option>
              {houses.map((house) => (
                <option key={house.id} value={house.id}>
                  {house.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">ESIID override (optional)</span>
            <input
              className="border rounded px-3 py-2"
              value={esiidOverride}
              onChange={(e) => setEsiidOverride(e.target.value)}
              placeholder="Leave blank to use selected house"
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
        <code>{"{ houseId, esiid?, meter }"}</code> and header <code>x-admin-token</code>.
        Inline uploads and droplet webhook paths are unchanged.
      </p>
    </div>
  );
}

