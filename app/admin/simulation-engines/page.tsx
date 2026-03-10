'use client';

import { useEffect, useMemo, useState } from "react";

type InspectResponse = {
  ok: boolean;
  error?: string;
  detail?: string;
  availableHouses?: Array<{
    id: string;
    label: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    esiid: string | null;
    isPrimary: boolean | null;
  }>;
  availableScenarios?: Array<{ id: string; name: string; updatedAt: string }>;
  [k: string]: unknown;
};

type VerificationLine = {
  ok: boolean;
  title: string;
  detail: string;
};

function safeUtcDateMs(dateStr: unknown): number | null {
  const s = String(dateStr ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

function sumTravelInclusiveDays(travelRanges: Array<{ startDate?: string; endDate?: string }>): {
  totalDays: number;
  invalidRanges: number;
} {
  let totalDays = 0;
  let invalidRanges = 0;
  for (const range of travelRanges) {
    const startMs = safeUtcDateMs(range?.startDate);
    const endMs = safeUtcDateMs(range?.endDate);
    if (startMs === null || endMs === null || endMs < startMs) {
      invalidRanges += 1;
      continue;
    }
    totalDays += Math.floor((endMs - startMs) / 86400000) + 1;
  }
  return { totalDays, invalidRanges };
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return "NaN";
  return String(value);
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "NaN";
  return value.toFixed(6);
}

export default function SimulationEnginesPage() {
  const [adminToken, setAdminToken] = useState("");
  const [email, setEmail] = useState("");
  const [houseId, setHouseId] = useState("");
  const [scenario, setScenario] = useState<"past" | "future" | "baseline">("past");
  const [recalc, setRecalc] = useState(false);
  const [mode, setMode] = useState<"SMT_BASELINE" | "NEW_BUILD_ESTIMATE" | "MANUAL_TOTALS">("SMT_BASELINE");
  const [weatherPreference, setWeatherPreference] = useState<"NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE">(
    "LAST_YEAR_WEATHER"
  );
  const [includeSeries, setIncludeSeries] = useState(false);
  const [includeBuildInputsRaw, setIncludeBuildInputsRaw] = useState(false);
  const [includeDayDiagnostics, setIncludeDayDiagnostics] = useState(true);
  const [dayDiagnosticsLimit, setDayDiagnosticsLimit] = useState(400);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<InspectResponse | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [verificationReport, setVerificationReport] = useState<string>("");

  const [diagStartDate, setDiagStartDate] = useState("");
  const [diagEndDate, setDiagEndDate] = useState("");
  const [includeParity, setIncludeParity] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagnosticResult, setDiagnosticResult] = useState<{
    ok: true;
    diagnostic: {
      ok: true;
      context: any;
      pastPath: any;
      weatherProvenance: any;
      stubAudit: any;
      parity?: any;
      gapfillLabNote: any;
    };
  } | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairResult, setRepairResult] = useState<{ ok: boolean; deleted?: number; fetched?: number; stubbed?: number; error?: string } | null>(null);
  const [diagNotice, setDiagNotice] = useState<string | null>(null);

  const [diagLoadHomesLoading, setDiagLoadHomesLoading] = useState(false);
  const [diagTravelRanges, setDiagTravelRanges] = useState<Array<{ startDate: string; endDate: string }>>([]);
  const [diagLoadTravelLoading, setDiagLoadTravelLoading] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem("iw_admin_token");
    if (token) setAdminToken(token);
  }, []);

  useEffect(() => {
    if (adminToken.trim()) window.localStorage.setItem("iw_admin_token", adminToken.trim());
  }, [adminToken]);

  const headers = useMemo(() => {
    const h = new Headers();
    h.set("Content-Type", "application/json");
    if (adminToken.trim()) h.set("x-admin-token", adminToken.trim());
    return h;
  }, [adminToken]);

  async function inspect() {
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        email: email.trim(),
        scenario,
        recalc: recalc ? "1" : "0",
        includeSeries: includeSeries ? "1" : "0",
        includeBuildInputsRaw: includeBuildInputsRaw ? "1" : "0",
        includeDayDiagnostics: includeDayDiagnostics ? "1" : "0",
        dayDiagnosticsLimit: String(Math.max(10, Math.min(2000, Math.trunc(dayDiagnosticsLimit || 400)))),
      });
      if (recalc) {
        qs.set("mode", mode);
        qs.set("weatherPreference", weatherPreference);
      }
      if (houseId.trim()) qs.set("houseId", houseId.trim());
      const res = await fetch(`/api/admin/simulation-engines?${qs.toString()}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as InspectResponse | null;
      if (!res.ok || !json?.ok) {
        setPayload(json);
        setError(json?.error ?? json?.detail ?? `Request failed (${res.status})`);
        return;
      }
      setPayload(json);
      const houses = Array.isArray(json.availableHouses) ? json.availableHouses : [];
      if (!houseId.trim() && houses.length > 0) setHouseId(houses[0].id);
    } finally {
      setLoading(false);
    }
  }

  const prettyJson = useMemo(() => (payload ? JSON.stringify(payload, null, 2) : ""), [payload]);
  const compactJson = useMemo(() => (payload ? JSON.stringify(payload) : ""), [payload]);
  const houses = Array.isArray(payload?.availableHouses) ? payload.availableHouses : [];
  const scenarios = Array.isArray(payload?.availableScenarios) ? payload.availableScenarios : [];

  function buildExportFileName(): string {
    const safeEmail = (email.trim() || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9@._-]+/g, "_")
      .replace(/@/g, "_at_");
    const ts = new Date().toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
    return `simulation-engines_${scenario}_${safeEmail}_${ts}.txt`;
  }

  async function copyOutput() {
    if (!prettyJson) return;
    try {
      await navigator.clipboard.writeText(prettyJson);
      setExportNotice("Copied output to clipboard.");
    } catch {
      setExportNotice("Copy failed. Your browser blocked clipboard access.");
    }
  }

  function saveOutputAsTxt() {
    if (!prettyJson) return;
    const blob = new Blob([prettyJson], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildExportFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportNotice(`Saved ${a.download}`);
  }

  function saveCompactJson() {
    if (!compactJson) return;
    const filename = buildExportFileName().replace(/\.txt$/i, ".json");
    const blob = new Blob([compactJson], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportNotice(`Saved ${a.download}`);
  }

  function runVerification() {
    if (!payload) {
      setVerificationReport("");
      setVerifyNotice("Run inspect first.");
      return;
    }

    const data = payload as any;
    const lines: VerificationLine[] = [];

    const travelRanges = Array.isArray(data?.build?.selected?.travelRanges) ? data.build.selected.travelRanges : [];
    const excludedDateKeysCount = Number(data?.engineContext?.pastPatchPayload?.excludedDateKeysCount);
    const travelResult = sumTravelInclusiveDays(travelRanges);
    const travelOk =
      Number.isFinite(excludedDateKeysCount) &&
      travelResult.invalidRanges === 0 &&
      travelResult.totalDays === excludedDateKeysCount;
    lines.push({
      ok: travelOk,
      title: "travelRanges inclusive days equals excludedDateKeysCount",
      detail: `travelRanges=${travelRanges.length}, inclusiveDays=${travelResult.totalDays}, excludedDateKeysCount=${formatNum(excludedDateKeysCount)}, invalidRanges=${travelResult.invalidRanges}`,
    });

    const intervals15 = Array.isArray(data?.result?.dataset?.series?.intervals15) ? data.result.dataset.series.intervals15 : [];
    const intervalsCount = Number(data?.result?.dataset?.summary?.intervalsCount);
    const countOk = Number.isFinite(intervalsCount) && intervalsCount === intervals15.length;
    lines.push({
      ok: countOk,
      title: "intervalsCount equals intervals15.length",
      detail: `intervalsCount=${formatNum(intervalsCount)}, intervals15.length=${intervals15.length}`,
    });

    const canonicalDaysRaw =
      data?.engineContext?.pastPatchPayload?.canonicalDays ??
      data?.engineContext?.weather?.canonicalDateKeys ??
      null;
    const canonicalDays = Number(canonicalDaysRaw);
    const divisibleBy96 = Number.isFinite(intervalsCount) && intervalsCount % 96 === 0;
    const daysFromIntervals = divisibleBy96 ? intervalsCount / 96 : NaN;
    const daysMatchCanonical = Number.isFinite(canonicalDays) ? daysFromIntervals === canonicalDays : true;
    lines.push({
      ok: divisibleBy96 && daysMatchCanonical,
      title: "intervalsCount divisible by 96 and day count matches canonical",
      detail: `intervalsCount=${formatNum(intervalsCount)}, divisibleBy96=${String(divisibleBy96)}, daysFromIntervals=${formatNum(daysFromIntervals)}, canonicalDays=${Number.isFinite(canonicalDays) ? canonicalDays : "n/a"}`,
    });

    const totalKwh = Number(data?.result?.dataset?.summary?.totalKwh);
    const sumIntervalsKwh = intervals15.reduce((acc: number, row: any) => acc + (Number(row?.kwh) || 0), 0);
    const sumIntervalsKwh2dp = Number(sumIntervalsKwh.toFixed(2));
    const totalKwh2dp = Number(totalKwh.toFixed(2));
    const rawDiff = Math.abs(sumIntervalsKwh - totalKwh);
    const roundedDiff = Math.abs(sumIntervalsKwh2dp - totalKwh2dp);
    const kwhOk = roundedDiff <= 1e-6;
    lines.push({
      ok: kwhOk,
      title: "sum(intervals15.kwh) aligns with summary.totalKwh (2dp export)",
      detail: `sumKwhRaw=${formatMoney(sumIntervalsKwh)}, sumKwh2dp=${sumIntervalsKwh2dp.toFixed(2)}, summary.totalKwhRaw=${formatMoney(totalKwh)}, summary.totalKwh2dp=${totalKwh2dp.toFixed(2)}, rawDiff=${formatMoney(rawDiff)}, diffAt2dp=${formatMoney(roundedDiff)}`,
    });

    const dayDiagnosticsSample = Array.isArray(data?.engineContext?.pastPatchPayload?.dayDiagnosticsSample)
      ? data.engineContext.pastPatchPayload.dayDiagnosticsSample
      : [];
    const actualRows = dayDiagnosticsSample.filter(
      (row: any) => String(row?.dayType ?? "").trim().toUpperCase() === "ACTUAL",
    );
    const badActualRows = actualRows.filter((row: any) => {
      const candidates = Number(row?.referenceCandidateCount ?? 0);
      const picked = Number(row?.referencePickedCount ?? 0);
      return candidates !== 0 || picked !== 0;
    });
    lines.push({
      ok: badActualRows.length === 0,
      title: "ACTUAL dayDiagnostics rows have zero reference counts",
      detail: `actualRows=${actualRows.length}, violations=${badActualRows.length}`,
    });

    const simulatedRows = dayDiagnosticsSample.filter(
      (row: any) => String(row?.dayType ?? "").trim().toUpperCase() === "SIMULATED",
    );
    const badSimulatedRows = simulatedRows.filter((row: any) => Number(row?.referencePickedCount ?? 0) <= 0);
    lines.push({
      ok: badSimulatedRows.length === 0,
      title: "SIMULATED dayDiagnostics rows have referencePickedCount > 0",
      detail: `simulatedRows=${simulatedRows.length}, violations=${badSimulatedRows.length}`,
    });

    const allOk = lines.every((line) => line.ok);
    const passCount = lines.filter((line) => line.ok).length;
    const failCount = lines.length - passCount;
    const header = [
      "Simulation Verifier Report",
      `GeneratedAtUTC: ${new Date().toISOString()}`,
      `Email: ${String((data?.selection?.email ?? email.trim()) || "n/a")}`,
      `Scenario: ${String(data?.selection?.scenarioName ?? data?.selection?.scenario ?? "n/a")}`,
      `HouseId: ${String((data?.selection?.houseId ?? houseId) || "n/a")}`,
      `Overall: ${allOk ? "PASS" : "FAIL"} (${passCount} pass, ${failCount} fail)`,
      "",
    ];
    const body = lines.map((line, idx) => `${line.ok ? "PASS" : "FAIL"} ${idx + 1}. ${line.title}\n  ${line.detail}`);
    setVerificationReport([...header, ...body].join("\n"));
    setVerifyNotice(allOk ? "Verification complete: PASS." : "Verification complete: FAIL. Review report.");
  }

  async function copyVerificationReport() {
    if (!verificationReport) return;
    try {
      await navigator.clipboard.writeText(verificationReport);
      setVerifyNotice("Copied verification report to clipboard.");
    } catch {
      setVerifyNotice("Copy failed. Your browser blocked clipboard access.");
    }
  }

  function getDiagnosticScenarioId(): string | null {
    if (scenario === "past") return scenarios.find((s) => s.name === "Past (Corrected)")?.id ?? null;
    if (scenario === "future") return scenarios.find((s) => s.name === "Future (What-if)")?.id ?? null;
    return null;
  }

  async function runDiagnostic(recalcFirst = false) {
    if (!email.trim()) {
      setDiagError("Email is required.");
      return;
    }
    const effectiveHouseId = houseId.trim() || (houses[0] as { id: string } | undefined)?.id;
    if (!effectiveHouseId) {
      setDiagError("Select a house (or run Inspect first to load houses).");
      return;
    }
    setDiagLoading(true);
    setDiagError(null);
    setDiagnosticResult(null);
    setDiagNotice(null);
    try {
      const travelRangesPayload = diagTravelRanges
        .map((r) => ({ startDate: (r.startDate ?? "").trim().slice(0, 10), endDate: (r.endDate ?? "").trim().slice(0, 10) }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate));
      const res = await fetch("/api/admin/simulation-engines/diagnostic", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: email.trim(),
          houseId: effectiveHouseId,
          scenarioId: getDiagnosticScenarioId(),
          startDate: diagStartDate.trim().slice(0, 10) || undefined,
          endDate: diagEndDate.trim().slice(0, 10) || undefined,
          recalcFirst,
          includeParity,
          ...(travelRangesPayload.length > 0 ? { travelRanges: travelRangesPayload } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setDiagError(json?.error ?? `Request failed (${res.status})`);
        return;
      }
      setDiagnosticResult(json);
      setDiagNotice("Diagnostic complete.");
    } finally {
      setDiagLoading(false);
    }
  }

  async function runWeatherRepair() {
    const effectiveHouseId = houseId.trim() || (houses[0] as { id: string } | undefined)?.id;
    if (!effectiveHouseId) {
      setRepairResult({ ok: false, error: "Select a house first." });
      return;
    }
    setRepairLoading(true);
    setRepairResult(null);
    try {
      const res = await fetch("/api/admin/weather/repair-stale-stubs", {
        method: "POST",
        headers,
        body: JSON.stringify({
          houseId: effectiveHouseId,
          startDate: diagStartDate.trim().slice(0, 10) || undefined,
          endDate: diagEndDate.trim().slice(0, 10) || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      setRepairResult(json?.ok ? { ok: true, deleted: json.deleted, fetched: json.fetched, stubbed: json.stubbed } : { ok: false, error: json?.error ?? "Request failed" });
    } finally {
      setRepairLoading(false);
    }
  }

  async function copyDiagnosticJson() {
    if (!diagnosticResult) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnosticResult, null, 2));
      setDiagNotice("Copied diagnostic JSON to clipboard.");
    } catch {
      setDiagNotice("Copy failed.");
    }
  }

  async function loadHomesForDiag() {
    if (!email.trim()) {
      setDiagError("Enter email above, then click Load homes.");
      return;
    }
    setDiagLoadHomesLoading(true);
    setDiagError(null);
    try {
      const res = await fetch(
        `/api/admin/simulation-engines/diagnostic?${new URLSearchParams({ email: email.trim() })}`,
        { method: "GET", headers, cache: "no-store" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setDiagError(json?.error ?? `Request failed (${res.status})`);
        return;
      }
      const houseList = Array.isArray(json.houses) ? json.houses : [];
      setPayload((prev) => ({ ...prev, ok: true, availableHouses: houseList } as InspectResponse));
      if (houseList.length > 0 && !houseId.trim()) setHouseId(houseList[0].id);
      setDiagNotice(houseList.length ? `Loaded ${houseList.length} home(s). Select a house and load vacant/travel dates if needed.` : "No homes found for this email.");
    } finally {
      setDiagLoadHomesLoading(false);
    }
  }

  async function loadTravelRangesForDiag() {
    const effectiveHouseId = houseId.trim() || (houses[0] as { id: string } | undefined)?.id;
    if (!email.trim()) {
      setDiagError("Email is required.");
      return;
    }
    if (!effectiveHouseId) {
      setDiagError("Select a house first (use Load homes if needed).");
      return;
    }
    setDiagLoadTravelLoading(true);
    setDiagError(null);
    try {
      const res = await fetch(
        `/api/admin/simulation-engines/diagnostic?${new URLSearchParams({ email: email.trim(), houseId: effectiveHouseId })}`,
        { method: "GET", headers, cache: "no-store" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setDiagError(json?.error ?? `Request failed (${res.status})`);
        return;
      }
      const ranges = Array.isArray(json.travelRanges) ? json.travelRanges : [];
      setDiagTravelRanges(ranges.length > 0 ? ranges.map((r: { startDate: string; endDate: string }) => ({ startDate: r.startDate ?? "", endDate: r.endDate ?? "" })) : [{ startDate: "", endDate: "" }]);
      setDiagNotice(ranges.length ? `Loaded ${ranges.length} vacant/travel range(s) from system.` : "No vacant/travel dates in system for this house.");
    } finally {
      setDiagLoadTravelLoading(false);
    }
  }

  function addDiagTravelRange() {
    setDiagTravelRanges((prev) => [...prev, { startDate: "", endDate: "" }]);
  }

  function removeDiagTravelRange(index: number) {
    setDiagTravelRanges((prev) => prev.filter((_, i) => i !== index));
  }

  function setDiagTravelRangeAt(index: number, field: "startDate" | "endDate", value: string) {
    setDiagTravelRanges((prev) => {
      const next = [...prev];
      if (next[index]) next[index] = { ...next[index]!, [field]: value.slice(0, 10) };
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-brand-navy">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 rounded-lg bg-brand-white p-6 shadow-lg">
          <h1 className="text-2xl font-bold text-brand-navy">Simulation Engines</h1>
          <p className="mt-1 text-sm text-brand-navy/70">
            Inspect Past/Future/New Build simulation inputs and outputs by user email, including build payload snapshots and engine context.
          </p>
        </div>

        <div className="rounded-lg bg-brand-white p-6 shadow-lg">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Admin token</div>
              <input
                type="password"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder="x-admin-token"
              />
            </label>
            <label className="text-sm lg:col-span-2">
              <div className="mb-1 font-semibold text-brand-navy">User email</div>
              <input
                type="email"
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Engine target</div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={scenario}
                onChange={(e) => setScenario(e.target.value as "past" | "future" | "baseline")}
              >
                <option value="past">Past (Corrected)</option>
                <option value="future">Future (What-if)</option>
                <option value="baseline">Baseline / New Build base</option>
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">House (optional override)</div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={houseId}
                onChange={(e) => setHouseId(e.target.value)}
              >
                <option value="">Auto-select primary/latest</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label || h.addressLine1 || h.id} {h.esiid ? `(${h.esiid})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="font-semibold">Scenarios on selected house</div>
              <div className="mt-1 max-h-24 overflow-auto">
                {scenarios.length > 0
                  ? scenarios.map((s) => (
                      <div key={s.id}>
                        {s.name} - {s.id}
                      </div>
                    ))
                  : "No active scenarios loaded yet."}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Recalc mode</div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={mode}
                onChange={(e) => setMode(e.target.value as "SMT_BASELINE" | "NEW_BUILD_ESTIMATE" | "MANUAL_TOTALS")}
              >
                <option value="SMT_BASELINE">SMT_BASELINE (Past/vacant/travel patch path)</option>
                <option value="NEW_BUILD_ESTIMATE">NEW_BUILD_ESTIMATE (new build engine)</option>
                <option value="MANUAL_TOTALS">MANUAL_TOTALS</option>
              </select>
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Weather preference</div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2"
                value={weatherPreference}
                onChange={(e) =>
                  setWeatherPreference(e.target.value as "NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE")
                }
              >
                <option value="LAST_YEAR_WEATHER">LAST_YEAR_WEATHER</option>
                <option value="LONG_TERM_AVERAGE">LONG_TERM_AVERAGE</option>
                <option value="NONE">NONE</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-brand-navy">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={recalc} onChange={(e) => setRecalc(e.target.checked)} />
              Recalculate before inspect
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={includeSeries} onChange={(e) => setIncludeSeries(e.target.checked)} />
              Include full interval series
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeBuildInputsRaw}
                onChange={(e) => setIncludeBuildInputsRaw(e.target.checked)}
              />
              Include raw buildInputs payload
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeDayDiagnostics}
                onChange={(e) => setIncludeDayDiagnostics(e.target.checked)}
              />
              Include per-day diagnostics
            </label>
            <label className="inline-flex items-center gap-2">
              <span>Day diag limit</span>
              <input
                type="number"
                min={10}
                max={2000}
                value={dayDiagnosticsLimit}
                onChange={(e) => setDayDiagnosticsLimit(Number(e.target.value) || 400)}
                className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </label>
            <button
              type="button"
              onClick={() => inspect()}
              disabled={loading}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {loading ? "Inspecting..." : "Inspect Simulation Engine"}
            </button>
          </div>

          {error ? <div className="mt-4 rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

          {payload ? (
            <div className="mt-6">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-brand-navy">Engine payload + response</div>
                <button
                  type="button"
                  onClick={() => runVerification()}
                  disabled={!payload}
                  className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                >
                  Run verification
                </button>
                <button
                  type="button"
                  onClick={() => copyVerificationReport()}
                  disabled={!verificationReport}
                  className="rounded border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60"
                >
                  Copy verify report
                </button>
                <button
                  type="button"
                  onClick={() => copyOutput()}
                  disabled={!prettyJson}
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-60"
                >
                  Copy output
                </button>
                <button
                  type="button"
                  onClick={() => saveOutputAsTxt()}
                  disabled={!prettyJson}
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-60"
                >
                  Save to .txt
                </button>
                <button
                  type="button"
                  onClick={() => saveCompactJson()}
                  disabled={!compactJson}
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-60"
                >
                  Save compact JSON
                </button>
                {exportNotice ? <span className="text-xs text-slate-600">{exportNotice}</span> : null}
                {verifyNotice ? <span className="text-xs text-emerald-700">{verifyNotice}</span> : null}
              </div>
              {verificationReport ? (
                <textarea
                  readOnly
                  value={verificationReport}
                  className="mb-3 h-64 w-full rounded border border-emerald-300 bg-emerald-950 p-3 font-mono text-xs text-emerald-100"
                />
              ) : null}
              <textarea
                readOnly
                value={prettyJson}
                className="h-[560px] w-full rounded border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-slate-100"
              />
            </div>
          ) : null}
        </div>

        <div className="mt-8 rounded-lg bg-brand-white p-6 shadow-lg">
          <h2 className="text-lg font-bold text-brand-navy">Past pipeline diagnostics</h2>
          <p className="mt-1 text-sm text-brand-navy/70">
            Validate production simulator/weather pipeline for the selected house: cold build, weather provenance, stub audit, parity (cold vs cache vs recalc), and weather repair.
          </p>
          <p className="mt-1 text-xs text-brand-navy/60">
            Use the <strong>User email</strong> and <strong>House</strong> fields above (or Load homes here to pull up homes by email without running full Inspect). Load vacant/travel dates to prefill from the system; supports multiple date ranges.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadHomesForDiag()}
              disabled={diagLoadHomesLoading}
              className="rounded border border-slate-400 bg-slate-100 px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-slate-200 disabled:opacity-60"
            >
              {diagLoadHomesLoading ? "Loading..." : "Load homes (by email)"}
            </button>
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-brand-navy">Vacant / travel dates (multiple ranges)</span>
              <button
                type="button"
                onClick={() => loadTravelRangesForDiag()}
                disabled={diagLoadTravelLoading}
                className="rounded border border-slate-400 bg-slate-50 px-2 py-1 text-xs font-semibold text-brand-navy hover:bg-slate-100 disabled:opacity-60"
              >
                {diagLoadTravelLoading ? "Loading..." : "Load from system"}
              </button>
            </div>
            <div className="space-y-2 rounded border border-slate-200 bg-slate-50/50 p-3">
              {diagTravelRanges.map((range, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    className="w-28 rounded border border-slate-300 px-2 py-1.5 font-mono text-sm"
                    value={range.startDate}
                    onChange={(e) => setDiagTravelRangeAt(idx, "startDate", e.target.value)}
                    placeholder="Start YYYY-MM-DD"
                  />
                  <span className="text-slate-500">–</span>
                  <input
                    type="text"
                    className="w-28 rounded border border-slate-300 px-2 py-1.5 font-mono text-sm"
                    value={range.endDate}
                    onChange={(e) => setDiagTravelRangeAt(idx, "endDate", e.target.value)}
                    placeholder="End YYYY-MM-DD"
                  />
                  <button
                    type="button"
                    onClick={() => removeDiagTravelRange(idx)}
                    className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addDiagTravelRange}
                className="mt-1 rounded border border-dashed border-slate-400 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                + Add range
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">Start date (optional)</div>
              <input
                type="text"
                className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
                value={diagStartDate}
                onChange={(e) => setDiagStartDate(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold text-brand-navy">End date (optional)</div>
              <input
                type="text"
                className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
                value={diagEndDate}
                onChange={(e) => setDiagEndDate(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-brand-navy">
              <input type="checkbox" checked={includeParity} onChange={(e) => setIncludeParity(e.target.checked)} />
              Include parity (cold vs production vs recalc)
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => runDiagnostic(false)}
              disabled={diagLoading}
              className="rounded border border-brand-blue/50 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20 disabled:opacity-60"
            >
              {diagLoading ? "Running..." : "Run full diagnostic"}
            </button>
            <button
              type="button"
              onClick={() => runDiagnostic(true)}
              disabled={diagLoading}
              className="rounded border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-slate-200 disabled:opacity-60"
            >
              {diagLoading ? "Running..." : "Refresh/rebuild Past then diagnostic"}
            </button>
            <button
              type="button"
              onClick={() => runWeatherRepair()}
              disabled={repairLoading}
              className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
            >
              {repairLoading ? "Repairing..." : "Run weather repair"}
            </button>
            {diagnosticResult ? (
              <button
                type="button"
                onClick={() => copyDiagnosticJson()}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-slate-50"
              >
                Copy diagnostic JSON
              </button>
            ) : null}
            {diagNotice ? <span className="text-xs text-slate-600">{diagNotice}</span> : null}
          </div>
          {diagError ? <div className="mt-3 rounded bg-rose-50 p-3 text-sm text-rose-700">{diagError}</div> : null}
          {repairResult ? (
            <div className={`mt-3 rounded p-3 text-sm ${repairResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
              {repairResult.ok
                ? `Repair done: deleted=${repairResult.deleted ?? 0}, fetched=${repairResult.fetched ?? 0}, stubbed=${repairResult.stubbed ?? 0}`
                : repairResult.error}
              {repairResult.ok ? (
                <button
                  type="button"
                  onClick={() => runDiagnostic(false)}
                  className="ml-2 text-brand-navy underline"
                >
                  Run diagnostic again
                </button>
              ) : null}
            </div>
          ) : null}
          {diagnosticResult?.diagnostic ? (
            <div className="mt-6 space-y-4">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">House / scenario context</div>
                <pre className="mt-1 overflow-auto text-xs text-slate-800">
                  {JSON.stringify(diagnosticResult.diagnostic.context, null, 2)}
                </pre>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">Past production path</div>
                <pre className="mt-1 overflow-auto text-xs text-slate-800">
                  {JSON.stringify(diagnosticResult.diagnostic.pastPath, null, 2)}
                </pre>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">Weather provenance</div>
                <pre className="mt-1 overflow-auto text-xs text-slate-800">
                  {JSON.stringify(diagnosticResult.diagnostic.weatherProvenance, null, 2)}
                </pre>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">Stub row audit</div>
                <pre className="mt-1 overflow-auto text-xs text-slate-800">
                  {JSON.stringify(diagnosticResult.diagnostic.stubAudit, null, 2)}
                </pre>
              </div>
              {diagnosticResult.diagnostic.parity ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase text-slate-500">Parity checks</div>
                  <pre className="mt-1 overflow-auto text-xs text-slate-800">
                    {JSON.stringify(diagnosticResult.diagnostic.parity, null, 2)}
                  </pre>
                </div>
              ) : null}
              <div className="rounded border border-amber-200 bg-amber-50 p-3">
                <div className="text-xs font-semibold uppercase text-amber-800">GapFill Lab (separate from Past)</div>
                <pre className="mt-1 overflow-auto text-xs text-amber-900">
                  {JSON.stringify(diagnosticResult.diagnostic.gapfillLabNote, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

