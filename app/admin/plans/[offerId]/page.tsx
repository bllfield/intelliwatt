"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type ApiOk = {
  ok: true;
  offerId: string;
  link: any | null;
  ratePlan: any | null;
  masterPlan: any | null;
  eflRawText: string | null;
  tdspSnapshotForValidation?: {
    tdspCode: string;
    effectiveAt: string | null;
    createdAt: string | null;
    monthlyFeeCents: number;
    deliveryCentsPerKwh: number;
  } | null;
  introspection: any | null;
};
type ApiErr = { ok: false; error: string; detail?: any };

function pretty(x: any) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function useLocalToken(key = "iw_admin_token") {
  const [token, setToken] = useState("");
  useEffect(() => {
    try {
      setToken(localStorage.getItem(key) || "");
    } catch {
      setToken("");
    }
  }, [key]);
  useEffect(() => {
    try {
      if (token) localStorage.setItem(key, token);
    } catch {
      // ignore
    }
  }, [key, token]);
  return { token, setToken };
}

function toNum(v: any): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function extractFixedEnergyCentsPerKwh(rateStructure: any): number | null {
  if (!rateStructure || typeof rateStructure !== "object") return null;
  const candidates: any[] = [
    rateStructure.energyRateCents,
    rateStructure.defaultRateCentsPerKwh,
    rateStructure.repEnergyCentsPerKwh,
    rateStructure.energyCentsPerKwh,
    rateStructure.energyChargeCentsPerKwh,
  ];
  const nums = candidates.map(toNum).filter((x): x is number => x != null);
  if (nums.length === 0) return null;
  // If multiple conflicting values exist, fail-closed and don’t show a single “fixed” number.
  const uniq = Array.from(new Set(nums.map((n) => Math.round(n * 1000) / 1000)));
  return uniq.length === 1 ? uniq[0] : null;
}

function extractRepFixedMonthlyChargeDollars(rateStructure: any): number | null {
  if (!rateStructure || typeof rateStructure !== "object") return null;
  const candidates: unknown[] = [];
  candidates.push((rateStructure as any)?.repMonthlyChargeDollars);
  candidates.push((rateStructure as any)?.monthlyBaseChargeDollars);
  candidates.push((rateStructure as any)?.baseChargeDollars);
  candidates.push((rateStructure as any)?.charges?.rep?.fixedMonthlyDollars);
  candidates.push((rateStructure as any)?.charges?.fixed?.monthlyDollars);

  const cents = toNum((rateStructure as any)?.baseMonthlyFeeCents);
  if (cents != null && cents >= 0 && cents < 50_000) candidates.push(cents / 100);

  const nums = candidates
    .map((v) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN))
    .filter((n) => Number.isFinite(n))
    .filter((n) => n >= 0 && n < 200);

  const uniq = Array.from(new Set(nums.map((n) => Math.round(n * 100) / 100)));
  return uniq.length === 1 ? uniq[0] : null;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type HomePreset = { id: string; label: string; homeId: string };
const HOME_PRESETS: HomePreset[] = [
  {
    id: "sample_d8ee",
    label: "Sample home: d8ee2a47-02f8-4e01-9c48-988ef4449214",
    homeId: "d8ee2a47-02f8-4e01-9c48-988ef4449214",
  },
];

function fmtHhmm(hhmm: string): string {
  const s = String(hhmm ?? "").trim();
  const m = s.match(/^(\d{2})(\d{2})$/);
  if (!m) return s;
  return `${m[1]}:${m[2]}`;
}

function describeBucketKey(key: string): string {
  const s = String(key ?? "").trim();
  const m = s.match(/^kwh\.m\.(all|weekday|weekend)\.(total|(\d{4})-(\d{4}))$/);
  if (!m) return "Monthly kWh (unknown key format)";
  const day = m[1];
  const dayLabel = day === "all" ? "All days" : day === "weekday" ? "Weekdays" : "Weekends";
  if (m[2] === "total") return `${dayLabel}, 00:00–24:00`;
  const start = m[3] ?? "";
  const end = m[4] ?? "";
  return `${dayLabel}, ${fmtHhmm(start)}–${fmtHhmm(end)}`;
}

export default function AdminPlanDetailsPage({ params }: { params: { offerId: string } }) {
  const offerId = String(params?.offerId ?? "").trim();
  const { token, setToken } = useLocalToken();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiOk | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/admin/plans/details?offerId=${encodeURIComponent(offerId)}`, {
        headers: { "x-admin-token": token },
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as ApiOk | ApiErr | null;
      if (!res.ok || !json || (json as any).ok !== true) {
        setError((json as any)?.error ? String((json as any).error) : `http_${res.status}`);
        return;
      }
      setData(json as ApiOk);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [offerId, token]);

  useEffect(() => {
    // Auto-load when token present.
    if (token && offerId) void load();
  }, [token, offerId, load]);

  // --- estimation runner (homeId-scoped)
  const [homeId, setHomeId] = useState("");
  const [monthsCount, setMonthsCount] = useState(12);
  const [backfill, setBackfill] = useState(false);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateErr, setEstimateErr] = useState<string | null>(null);
  const [estimateJson, setEstimateJson] = useState<any>(null);

  const monthsClamped = useMemo(() => Math.max(1, Math.min(12, Math.floor(Number(monthsCount) || 12))), [monthsCount]);

  const runEstimate = useCallback(async () => {
    setEstimateLoading(true);
    setEstimateErr(null);
    setEstimateJson(null);
    try {
      const res = await fetch("/api/admin/plan-engine/offer-estimate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          offerId,
          homeId: homeId.trim(),
          monthsCount: monthsClamped,
          backfill,
        }),
      });
      const json = await res.json().catch(() => null);
      setEstimateJson(json);
      if (!res.ok) {
        setEstimateErr(json?.error ? String(json.error) : `http_${res.status}`);
      }
    } catch (e: any) {
      setEstimateErr(e?.message ?? String(e));
    } finally {
      setEstimateLoading(false);
    }
  }, [token, offerId, homeId, monthsClamped, backfill]);

  // --- bucket coverage matrix (homeId + requiredBucketKeys)
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageErr, setCoverageErr] = useState<string | null>(null);
  const [coverageJson, setCoverageJson] = useState<any>(null);

  const requiredBucketKeys = useMemo(() => {
    const keys = data?.introspection?.requiredBucketKeys;
    return Array.isArray(keys) ? (keys as string[]).map((k) => String(k)).filter(Boolean) : [];
  }, [data]);

  // Auto-fetch raw EFL text when missing (admin QA convenience).
  const [rawTextFetchState, setRawTextFetchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [rawTextFetchErr, setRawTextFetchErr] = useState<string | null>(null);
  const [rawTextFetchDetail, setRawTextFetchDetail] = useState<any>(null);
  const [overridePdfUrl, setOverridePdfUrl] = useState<string>("");

  // Reset auto-fetch state when navigating to a different offerId.
  useEffect(() => {
    setRawTextFetchState("idle");
    setRawTextFetchErr(null);
    setRawTextFetchDetail(null);
  }, [offerId]);

  const fetchRawTextNow = useCallback(
    async (args?: { overridePdfUrl?: string }) => {
      if (!token || !offerId) return;
      try {
        setRawTextFetchState("loading");
        setRawTextFetchErr(null);
        setRawTextFetchDetail(null);
        const res = await fetch("/api/admin/efl/raw-text/fetch", {
          method: "POST",
          headers: { "content-type": "application/json", "x-admin-token": token },
          body: JSON.stringify({
            offerId,
            ...(args?.overridePdfUrl ? { overridePdfUrl: args.overridePdfUrl } : {}),
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          setRawTextFetchState("error");
          setRawTextFetchErr(json?.error ? String(json.error) : `http_${res.status}`);
          setRawTextFetchDetail(json?.detail ?? json ?? null);
          return;
        }
        setRawTextFetchState("done");
        setRawTextFetchDetail(json);
        await load();
      } catch (e: any) {
        setRawTextFetchState("error");
        setRawTextFetchErr(e?.message ?? String(e));
        setRawTextFetchDetail(null);
      }
    },
    [token, offerId, load],
  );

  useEffect(() => {
    const canFetch =
      Boolean(token) &&
      Boolean(offerId) &&
      Boolean(data?.ratePlan?.eflPdfSha256) &&
      (data?.eflRawText == null || String(data.eflRawText).trim().length === 0);
    if (!canFetch) return;
    if (rawTextFetchState !== "idle") return;

    void fetchRawTextNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, offerId, data?.eflRawText, data?.ratePlan?.eflPdfSha256, rawTextFetchState, fetchRawTextNow]);

  const planVars = useMemo(() => {
    const rp = data?.ratePlan ?? null;
    const rs = rp?.rateStructure ?? null;
    const type = String(rs?.type ?? "").toUpperCase() || "UNKNOWN";
    const baseMonthlyFeeCents = toNum(rs?.baseMonthlyFeeCents);
    const tdspIncluded = rs?.tdspDeliveryIncludedInEnergyCharge === true;
    const fixedEnergy = extractFixedEnergyCentsPerKwh(rs);
    const repFixedMonthlyDollars = extractRepFixedMonthlyChargeDollars(rs);
    const touTiers: any[] = Array.isArray(rs?.tiers) ? rs.tiers : [];
    const hasTouTiers = touTiers.length > 0;

    const billCredits = rs?.billCredits ?? null;
    const billCreditRules: any[] = Array.isArray((billCredits as any)?.rules) ? (billCredits as any).rules : [];
    const hasCredits = Boolean((billCredits as any)?.hasBillCredit) || billCreditRules.length > 0;

    const usageTiers: any[] = Array.isArray(rs?.usageTiers) ? rs.usageTiers : [];
    const hasTiers = usageTiers.length > 0;

    // Validator TDSP inputs (used to make modeled proof match EFL avg-price table).
    const validationAny = (rp as any)?.modeledEflAvgPriceValidation ?? null;
    const assumptions: any = validationAny?.assumptionsUsed ?? null;
    const tdspFromEfl = assumptions?.tdspFromEfl ?? null;

    const rows: Array<{ key: string; value: string; notes?: string }> = [
      { key: "rateStructure.type", value: type },
      {
        key: "baseMonthlyFeeCents",
        value: baseMonthlyFeeCents == null ? "—" : String(baseMonthlyFeeCents),
      },
      {
        key: "repFixedMonthlyChargeDollars",
        value: repFixedMonthlyDollars == null ? "—" : String(repFixedMonthlyDollars),
        notes: repFixedMonthlyDollars == null ? "No single confident REP fixed monthly charge found (assumed $0 by calculator)." : "REP fixed monthly charge used by calculator.",
      },
      {
        key: "fixedEnergyCentsPerKwh",
        value: fixedEnergy == null ? "—" : String(fixedEnergy),
        notes: fixedEnergy == null ? "Not a single unambiguous fixed rate (or not FIXED)." : undefined,
      },
      {
        key: "rateStructure.energyRateCents",
        value: toNum(rs?.energyRateCents) == null ? "—" : String(toNum(rs?.energyRateCents)),
        notes: type === "FIXED" ? "Headline fixed REP energy rate (¢/kWh) from template." : "Not a FIXED rateStructure.",
      },
      {
        key: "rateStructure.currentBillEnergyRateCents",
        value: toNum(rs?.currentBillEnergyRateCents) == null ? "—" : String(toNum(rs?.currentBillEnergyRateCents)),
        notes: type === "VARIABLE" ? "Current-bill rate (¢/kWh) from template (variable plans)." : "Not a VARIABLE rateStructure.",
      },
      { key: "tdspDeliveryIncludedInEnergyCharge", value: tdspIncluded ? "true" : "false" },
      { key: "hasUsageTiers", value: hasTiers ? "true" : "false" },
      { key: "hasBillCredits", value: hasCredits ? "true" : "false" },
      { key: "hasTouTiers", value: hasTouTiers ? "true" : "false" },
    ];

    // Surface TDSP/TDU numbers used for validation as "variables", so QA can see them
    // alongside the template rates without digging through the proof JSON.
    if (assumptions) {
      rows.push({
        key: "validator.tdspAppliedMode",
        value: String(assumptions?.tdspAppliedMode ?? "—"),
      });
      rows.push({
        key: "validator.usedEngineTdspFallback",
        value: String(Boolean(assumptions?.usedEngineTdspFallback)),
      });
      rows.push({
        key: "validator.tdspFromEfl.perKwhCents",
        value: typeof tdspFromEfl?.perKwhCents === "number" ? String(tdspFromEfl.perKwhCents) : "—",
        notes: "¢/kWh delivery from EFL snippet (used when tdspAppliedMode=ADDED_FROM_EFL).",
      });
      rows.push({
        key: "validator.tdspFromEfl.monthlyCents",
        value: typeof tdspFromEfl?.monthlyCents === "number" ? String(tdspFromEfl.monthlyCents) : "—",
        notes: "Monthly delivery cents from EFL snippet (used when tdspAppliedMode=ADDED_FROM_EFL).",
      });
    }

    if (data?.tdspSnapshotForValidation) {
      rows.push({
        key: "validator.tdspSnapshot.deliveryCentsPerKwh",
        value: String(data.tdspSnapshotForValidation.deliveryCentsPerKwh),
        notes: "TDSP table snapshot value used for validator when available.",
      });
      rows.push({
        key: "validator.tdspSnapshot.monthlyFeeCents",
        value: String(data.tdspSnapshotForValidation.monthlyFeeCents),
        notes: "TDSP table snapshot monthly fee cents used for validator when available.",
      });
    }

    // Usage tiers (tiered REP energy) — show the actual bands we will use (if supported).
    if (hasTiers) {
      rows.push({
        key: "usageTiers.length",
        value: String(usageTiers.length),
        notes: "Tier bands as stored in template (min/max kWh + ¢/kWh).",
      });
      usageTiers.forEach((t, idx) => {
        const min = toNum((t as any)?.minKWh);
        const max = toNum((t as any)?.maxKWh);
        const cents = toNum((t as any)?.centsPerKWh);
        rows.push({
          key: `usageTiers[${idx}]`,
          value:
            min == null || cents == null
              ? "—"
              : `${min}–${max == null ? "∞" : String(max)} kWh @ ${cents} ¢/kWh`,
          notes: min == null || cents == null ? "Missing required tier fields in template." : undefined,
        });
      });
    }

    // Bill credits — show rules so you can QA thresholds and amounts.
    if (hasCredits) {
      rows.push({
        key: "billCredits.rules.length",
        value: String(billCreditRules.length),
        notes: (billCredits as any)?.hasBillCredit === true && billCreditRules.length === 0 ? "hasBillCredit=true but no rules stored." : undefined,
      });
      billCreditRules.forEach((r, idx) => {
        const label = String((r as any)?.label ?? "").trim();
        const amt = toNum((r as any)?.creditAmountCents);
        const min = toNum((r as any)?.minUsageKWh);
        const max = toNum((r as any)?.maxUsageKWh);
        const months = Array.isArray((r as any)?.monthsOfYear) ? (r as any).monthsOfYear : null;
        rows.push({
          key: `billCredits.rules[${idx}]`,
          value:
            amt == null || min == null
              ? "—"
              : `${amt}¢ credit if usage ${min}–${max == null ? "∞" : String(max)} kWh`,
          notes: [
            label ? `label: ${label}` : null,
            months ? `months: ${months.join(",")}` : null,
            amt == null || min == null ? "Missing required credit fields in template." : null,
          ]
            .filter(Boolean)
            .join(" • "),
        });
      });
    }

    // TOU tiers (deterministic) — show the actual schedule tiers in the template.
    if (hasTouTiers) {
      rows.push({
        key: "tiers.length",
        value: String(touTiers.length),
        notes: "TOU tiers as stored in template (label + window + ¢/kWh).",
      });
      touTiers.forEach((t, idx) => {
        const label = String((t as any)?.label ?? "").trim();
        const price = toNum((t as any)?.priceCents);
        const start = String((t as any)?.startTime ?? "").trim();
        const end = String((t as any)?.endTime ?? "").trim();
        const days = (t as any)?.daysOfWeek;
        const daysLabel = Array.isArray(days) ? days.join(",") : typeof days === "string" ? days : "";
        const months = Array.isArray((t as any)?.monthsOfYear) ? (t as any).monthsOfYear : null;
        rows.push({
          key: `tiers[${idx}]`,
          value:
            price == null
              ? "—"
              : `${price}¢ ${start && end ? `(${start}–${end})` : ""}`.trim(),
          notes: [
            label ? `label: ${label}` : null,
            daysLabel ? `days: ${daysLabel}` : null,
            months ? `months: ${months.join(",")}` : null,
          ]
            .filter(Boolean)
            .join(" • "),
        });
      });
    }

    if ((rp as any)?.cancelFee) {
      rows.push({ key: "ratePlan.cancelFee", value: String((rp as any).cancelFee), notes: "Cancellation fee (as stored)." });
    }

    // ---- Calculation variables + outputs (this run) ----
    if (estimateJson?.ok) {
      const est = (estimateJson as any)?.estimate ?? null;
      const tdsp = (estimateJson as any)?.tdspApplied ?? null;

      rows.push({ key: "calc.homeId", value: String((estimateJson as any)?.homeId ?? "—") });
      rows.push({ key: "calc.esiid", value: String((estimateJson as any)?.esiid ?? "—") });
      rows.push({ key: "calc.tdspSlug", value: String((estimateJson as any)?.tdspSlug ?? "—") });
      rows.push({ key: "calc.annualKwh", value: String((estimateJson as any)?.annualKwh ?? "—"), notes: "Annual usage total used for cost math." });
      rows.push({ key: "calc.monthsCount", value: String((estimateJson as any)?.monthsCount ?? "—") });
      rows.push({
        key: "calc.monthsIncluded",
        value: Array.isArray((estimateJson as any)?.monthsIncluded) ? (estimateJson as any).monthsIncluded.join(", ") : "—",
      });
      rows.push({
        key: "calc.requiredBucketKeys",
        value: requiredBucketKeys.length ? requiredBucketKeys.join(", ") : "—",
        notes: "Buckets required by the template (coverage shown below).",
      });

      rows.push({
        key: "calc.tdspApplied.perKwhDeliveryChargeCents",
        value: tdsp?.perKwhDeliveryChargeCents != null ? String(tdsp.perKwhDeliveryChargeCents) : "—",
        notes: "TDSP/TDU volumetric delivery rate applied by calculator.",
      });
      rows.push({
        key: "calc.tdspApplied.monthlyCustomerChargeDollars",
        value: tdsp?.monthlyCustomerChargeDollars != null ? String(tdsp.monthlyCustomerChargeDollars) : "—",
        notes: "TDSP/TDU monthly customer charge applied by calculator.",
      });

      rows.push({ key: "calc.estimate.status", value: String(est?.status ?? "—") });
      rows.push({ key: "calc.estimate.reason", value: String(est?.reason ?? "—") });
      rows.push({ key: "calc.estimate.annualCostDollars", value: est?.annualCostDollars != null ? String(est.annualCostDollars) : "—" });
      rows.push({ key: "calc.estimate.monthlyCostDollars", value: est?.monthlyCostDollars != null ? String(est.monthlyCostDollars) : "—" });

      const c2 = est?.componentsV2 ?? null;
      if (c2) {
        rows.push({ key: "calc.components.rep.energyDollars", value: c2?.rep?.energyDollars != null ? String(c2.rep.energyDollars) : "—" });
        rows.push({ key: "calc.components.rep.fixedDollars", value: c2?.rep?.fixedDollars != null ? String(c2.rep.fixedDollars) : "—" });
        rows.push({ key: "calc.components.tdsp.deliveryDollars", value: c2?.tdsp?.deliveryDollars != null ? String(c2.tdsp.deliveryDollars) : "—" });
        rows.push({ key: "calc.components.tdsp.fixedDollars", value: c2?.tdsp?.fixedDollars != null ? String(c2.tdsp.fixedDollars) : "—" });
        rows.push({ key: "calc.components.totalDollars", value: c2?.totalDollars != null ? String(c2.totalDollars) : "—" });
      }

      // Show the explicit math for fixed-rate path (when applicable) as a human check.
      const annualKwh = toNum((estimateJson as any)?.annualKwh);
      const repCents = toNum(fixedEnergy);
      const tdspPerKwh = toNum(tdsp?.perKwhDeliveryChargeCents);
      const tdspMonthly = toNum(tdsp?.monthlyCustomerChargeDollars);
      const mCount = toNum((estimateJson as any)?.monthsCount);
      if (annualKwh != null && repCents != null && tdspPerKwh != null && tdspMonthly != null && mCount != null) {
        rows.push({
          key: "calc.formula",
          value: "see notes",
          notes: `repEnergy=$(${annualKwh}×${repCents}/100), tdspDelivery=$(${annualKwh}×${tdspPerKwh}/100), repFixed=$(${mCount}×${repFixedMonthlyDollars ?? 0}), tdspFixed=$(${mCount}×${tdspMonthly})`,
        });
      }
    }
    return rows;
  }, [data, estimateJson, requiredBucketKeys]);

  const validation = useMemo(() => {
    const v = data?.ratePlan?.modeledEflAvgPriceValidation ?? null;
    const points = Array.isArray(v?.points) ? v.points : [];
    const assumptions = v?.assumptionsUsed ?? null;
    return { v, points, assumptions };
  }, [data]);

  const estimateVars = useMemo(() => {
    if (!estimateJson?.ok) return null;
    const tdsp = estimateJson?.tdspApplied ?? null;
    const rows: Array<{ key: string; value: string }> = [
      { key: "homeId", value: String(estimateJson.homeId ?? "—") },
      { key: "esiid", value: String(estimateJson.esiid ?? "—") },
      { key: "tdspSlug", value: String(estimateJson.tdspSlug ?? "—") },
      { key: "annualKwh", value: String(estimateJson.annualKwh ?? "—") },
      {
        key: "tdspApplied.perKwhDeliveryChargeCents",
        value: tdsp?.perKwhDeliveryChargeCents != null ? String(tdsp.perKwhDeliveryChargeCents) : "—",
      },
      {
        key: "tdspApplied.monthlyCustomerChargeDollars",
        value: tdsp?.monthlyCustomerChargeDollars != null ? String(tdsp.monthlyCustomerChargeDollars) : "—",
      },
      { key: "monthsCount", value: String(estimateJson.monthsCount ?? "—") },
      { key: "monthsIncluded", value: Array.isArray(estimateJson.monthsIncluded) ? estimateJson.monthsIncluded.join(", ") : "—" },
      { key: "backfill.ok", value: String(Boolean(estimateJson?.backfill?.ok)) },
      { key: "estimate.status", value: String(estimateJson?.estimate?.status ?? "—") },
      { key: "estimate.reason", value: String(estimateJson?.estimate?.reason ?? "—") },
    ];
    return rows;
  }, [estimateJson]);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    setCoverageErr(null);
    setCoverageJson(null);
    try {
      if (!token) {
        setCoverageErr("admin_token_required");
        return;
      }
      const hid = homeId.trim();
      if (!hid) {
        setCoverageErr("homeId_required");
        return;
      }
      if (!requiredBucketKeys.length) {
        setCoverageErr("no_requiredBucketKeys");
        return;
      }

      const sp = new URLSearchParams();
      sp.set("homeId", hid);
      sp.set("monthsCount", String(monthsClamped));
      for (const k of requiredBucketKeys) sp.append("bucketKeys", k);

      const res = await fetch(`/api/admin/usage/bucket-coverage?${sp.toString()}`, {
        headers: { "x-admin-token": token },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      setCoverageJson(json);
      if (!res.ok) {
        setCoverageErr(json?.error ? String(json.error) : `http_${res.status}`);
      }
    } catch (e: any) {
      setCoverageErr(e?.message ?? String(e));
    } finally {
      setCoverageLoading(false);
    }
  }, [token, homeId, monthsClamped, requiredBucketKeys]);

  // Auto-load bucket coverage after a successful estimate run so the "Plan variables" section
  // can show the exact buckets/values without extra clicks.
  useEffect(() => {
    if (!estimateJson?.ok) return;
    if (coverageLoading) return;
    if (coverageJson?.ok) return;
    if (!token) return;
    if (!homeId.trim()) return;
    if (!requiredBucketKeys.length) return;
    void loadCoverage();
  }, [estimateJson, coverageLoading, coverageJson, token, homeId, requiredBucketKeys, loadCoverage]);

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Plan Details</h1>
          <div className="text-sm text-gray-600">
            offerId: <span className="font-mono">{offerId || "—"}</span>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold">Admin token</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="flex-1 min-w-[260px] rounded-lg border px-3 py-2 font-mono text-xs"
              placeholder="x-admin-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-60"
              disabled={!token || !offerId || loading}
              onClick={() => void load()}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {error ? <div className="text-sm text-red-700">{error}</div> : null}
        </div>

        {data ? (
          <div className="space-y-4">
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">EFL raw text</div>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60"
                    disabled={!data.eflRawText}
                    onClick={async () => {
                      if (!data.eflRawText) return;
                      const ok = await copyToClipboard(data.eflRawText);
                      if (!ok) alert("Copy failed.");
                    }}
                  >
                    Copy
                  </button>
                  <button
                    className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60"
                    disabled={!token || !offerId || rawTextFetchState === "loading"}
                    onClick={() => void fetchRawTextNow()}
                    title="Fetches the EFL PDF and stores extracted raw text for this offer."
                  >
                    {rawTextFetchState === "loading" ? "Fetching…" : "Retry fetch"}
                  </button>
                </div>
              </div>
              {rawTextFetchState === "loading" ? (
                <div className="text-xs text-gray-600">Fetching/storing raw text…</div>
              ) : rawTextFetchState === "error" ? (
                <div className="space-y-2">
                  <div className="text-xs text-red-700">
                    Raw text fetch failed: {rawTextFetchErr ?? "unknown_error"}
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="text-xs">
                      <div className="text-gray-600 mb-1">Override PDF URL (optional)</div>
                      <input
                        className="w-full rounded-lg border px-3 py-2 font-mono text-xs"
                        value={overridePdfUrl}
                        onChange={(e) => setOverridePdfUrl(e.target.value)}
                        placeholder="Paste a direct EFL PDF URL to bypass blocked pages"
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        className="rounded-lg bg-black text-white px-3 py-2 text-xs disabled:opacity-60"
                        disabled={!token || !offerId || !overridePdfUrl.trim()}
                        onClick={() => void fetchRawTextNow({ overridePdfUrl: overridePdfUrl.trim() })}
                      >
                        Fetch using override
                      </button>
                    </div>
                  </div>
                  <details className="text-xs text-gray-700">
                    <summary className="cursor-pointer select-none">Fetch debug</summary>
                    <pre className="mt-2 bg-gray-50 rounded-lg p-3 overflow-auto max-h-[280px]">
                      {rawTextFetchDetail ? pretty(rawTextFetchDetail) : "—"}
                    </pre>
                  </details>
                </div>
              ) : null}
              <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">
                <code className="whitespace-pre-wrap break-words">
                  {data.eflRawText ? data.eflRawText : "— (no stored raw text found yet; auto-fetch will attempt when available)"}
                </code>
              </pre>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border bg-white p-4 space-y-2">
                <div className="text-sm font-semibold">Offer summary</div>
                <div className="text-xs text-gray-700 space-y-1">
                  <div>
                    <span className="text-gray-500">MasterPlan:</span>{" "}
                    <span className="font-mono">{data.masterPlan?.id ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Supplier:</span> {data.masterPlan?.supplierName ?? data.ratePlan?.supplier ?? "—"}
                  </div>
                  <div>
                    <span className="text-gray-500">Plan:</span> {data.masterPlan?.planName ?? data.ratePlan?.planName ?? "—"}
                  </div>
                  <div>
                    <span className="text-gray-500">Term:</span>{" "}
                    <span className="font-mono">{data.masterPlan?.termMonths ?? data.ratePlan?.termMonths ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">TDSP:</span>{" "}
                    <span className="font-mono">{data.masterPlan?.tdsp ?? data.ratePlan?.utilityId ?? "—"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {data.ratePlan?.eflSourceUrl ? (
                    <a className="underline" href={String(data.ratePlan.eflSourceUrl)} target="_blank" rel="noreferrer">
                      EFL source
                    </a>
                  ) : null}
                  {data.ratePlan?.eflUrl ? (
                    <a className="underline" href={String(data.ratePlan.eflUrl)} target="_blank" rel="noreferrer">
                      EFL
                    </a>
                  ) : null}
                  {data.ratePlan?.tosUrl ? (
                    <a className="underline" href={String(data.ratePlan.tosUrl)} target="_blank" rel="noreferrer">
                      TOS
                    </a>
                  ) : null}
                  {data.ratePlan?.yracUrl ? (
                    <a className="underline" href={String(data.ratePlan.yracUrl)} target="_blank" rel="noreferrer">
                      YRAC
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border bg-white p-4 space-y-2">
                <div className="text-sm font-semibold">Plan variables (numbers used)</div>
                <div className="text-xs text-gray-600">
                  One end-to-end run sheet: template inputs, validator assumptions, calculator inputs/buckets, and calculator outputs.
                </div>
                <div className="overflow-auto rounded border">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-2 text-left">variable</th>
                        <th className="px-2 py-2 text-left">value</th>
                        <th className="px-2 py-2 text-left">notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planVars.map((r) => (
                        <tr key={r.key} className="border-t">
                          <td className="px-2 py-2 font-mono">{r.key}</td>
                          <td className="px-2 py-2 font-mono">{r.value}</td>
                          <td className="px-2 py-2 text-gray-600">{r.notes ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {estimateJson?.ok ? (
                  <div className="rounded border p-3 bg-gray-50 text-xs">
                    <div className="font-semibold text-gray-700 mb-2">Buckets used for this run</div>
                    {coverageJson?.ok ? (
                      <div className="space-y-2">
                        <div className="text-gray-700">
                          required keys: <span className="font-mono">{requiredBucketKeys.length}</span> • fullyCoveredMonths:{" "}
                          <span className="font-mono">
                            {String(coverageJson?.summary?.fullyCoveredMonths ?? "—")} / {String(coverageJson?.monthsCount ?? monthsClamped)}
                          </span>
                        </div>
                        <div className="overflow-auto rounded border bg-white">
                          <table className="min-w-full text-xs">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-2 py-2 text-left">month</th>
                                {requiredBucketKeys.map((k) => (
                                  <th key={k} className="px-2 py-2 text-left font-mono">
                                    {k.split(".").slice(-1)[0]}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(coverageJson?.months ?? []).map((ym: string) => (
                                <tr key={ym} className="border-t">
                                  <td className="px-2 py-2 font-mono">{ym}</td>
                                  {requiredBucketKeys.map((k) => {
                                    const cell = coverageJson?.cells?.[ym]?.[k];
                                    const present = Boolean(cell?.present);
                                    const kwh = cell?.kwhTotal;
                                    return (
                                      <td key={k} className="px-2 py-2 font-mono">
                                        {present ? `✅ ${kwh ?? ""}` : "❌"}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {coverageErr ? <div className="text-red-700">coverage error: {coverageErr}</div> : null}
                      </div>
                    ) : (
                      <div className="text-gray-700">
                        {coverageLoading ? "Loading bucket coverage…" : "Bucket coverage not loaded (run estimate again or click “Load bucket coverage” below)."}
                        {coverageErr ? <div className="text-red-700">coverage error: {coverageErr}</div> : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="text-sm font-semibold">Validator proof (EFL avg-price validation)</div>
              <div className="text-xs text-gray-600">
                Shows the actual numbers used to make this template PASS (expected vs modeled, TDSP assumptions, and component breakdown).
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded border p-3">
                  <div className="text-xs text-gray-600 mb-2">TDSP used for validation (snapshot)</div>
                  {data.tdspSnapshotForValidation ? (
                    <div className="text-xs font-mono space-y-1">
                      <div>tdspCode={data.tdspSnapshotForValidation.tdspCode}</div>
                      <div>deliveryCentsPerKwh={data.tdspSnapshotForValidation.deliveryCentsPerKwh}</div>
                      <div>monthlyFeeCents={data.tdspSnapshotForValidation.monthlyFeeCents}</div>
                      <div>effectiveAt={data.tdspSnapshotForValidation.effectiveAt ?? "—"}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">—</div>
                  )}
                </div>

                <div className="rounded border p-3">
                  <div className="text-xs text-gray-600 mb-2">Assumptions used</div>
                  {validation.assumptions ? (
                    <div className="mb-2 rounded bg-gray-50 p-2 text-xs">
                      <div className="font-semibold text-gray-700 mb-1">TDSP numbers actually applied (from assumptions)</div>
                      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                        <div>
                          <span className="text-gray-500">tdspAppliedMode:</span>{" "}
                          <span className="font-mono">{String((validation.assumptions as any)?.tdspAppliedMode ?? "—")}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">usedEngineTdspFallback:</span>{" "}
                          <span className="font-mono">{String(Boolean((validation.assumptions as any)?.usedEngineTdspFallback))}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">tdspFromEfl.perKwhCents:</span>{" "}
                          <span className="font-mono">
                            {typeof (validation.assumptions as any)?.tdspFromEfl?.perKwhCents === "number"
                              ? String((validation.assumptions as any).tdspFromEfl.perKwhCents)
                              : "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">tdspFromEfl.monthlyCents:</span>{" "}
                          <span className="font-mono">
                            {typeof (validation.assumptions as any)?.tdspFromEfl?.monthlyCents === "number"
                              ? String((validation.assumptions as any).tdspFromEfl.monthlyCents)
                              : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto max-h-[220px]">
                    {validation.assumptions ? pretty(validation.assumptions) : "—"}
                  </pre>
                </div>
              </div>

              <div className="overflow-auto rounded border">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 text-right">kWh</th>
                      <th className="px-2 py-2 text-right">expected ¢/kWh</th>
                      <th className="px-2 py-2 text-right">modeled ¢/kWh</th>
                      <th className="px-2 py-2 text-right">diff</th>
                      <th className="px-2 py-2 text-left">ok</th>
                      <th className="px-2 py-2 text-right">repEnergy $</th>
                      <th className="px-2 py-2 text-right">repBase $</th>
                      <th className="px-2 py-2 text-right">tdsp $</th>
                      <th className="px-2 py-2 text-right">credits $</th>
                      <th className="px-2 py-2 text-right">total $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(validation.points as any[]).map((p: any, idx: number) => (
                      <tr key={idx} className="border-t">
                        <td className="px-2 py-2 text-right font-mono">{String(p?.usageKwh ?? "—")}</td>
                        <td className="px-2 py-2 text-right font-mono">{p?.expectedAvgCentsPerKwh ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-mono">{p?.modeledAvgCentsPerKwh ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-mono">{p?.diffCentsPerKwh ?? "—"}</td>
                        <td className="px-2 py-2">{p?.ok ? "✅" : "❌"}</td>
                        <td className="px-2 py-2 text-right font-mono">{p?.modeled?.repEnergyDollars ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-mono">{p?.modeled?.repBaseDollars ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-mono">{p?.modeled?.tdspDollars ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-mono">{p?.modeled?.creditsDollars ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-mono">{p?.modeled?.totalDollars ?? "—"}</td>
                      </tr>
                    ))}
                    {validation.points.length === 0 ? (
                      <tr>
                        <td className="px-2 py-3 text-gray-500" colSpan={10}>
                          — (no modeled proof stored yet)
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <details className="text-xs text-gray-700">
                <summary className="cursor-pointer select-none">Validation raw JSON</summary>
                <pre className="mt-2 bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">
                  {validation.v ? pretty(validation.v) : "—"}
                </pre>
              </details>
            </div>

            <div className="rounded-xl border bg-white p-4 space-y-2">
              <div className="text-sm font-semibold">Plan calc requirements</div>
              <div className="text-xs font-mono">
                status={data.introspection?.planCalc?.planCalcStatus ?? "—"} reason={data.introspection?.planCalc?.planCalcReasonCode ?? "—"}
              </div>
              <div className="text-xs text-gray-700">
                <span className="text-gray-500">requiredBucketKeys:</span>{" "}
                <span className="font-mono break-all">{requiredBucketKeys.length ? requiredBucketKeys.join(", ") : "—"}</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold">Estimate for a home (runs the calculator)</div>
          <div className="text-xs text-gray-600">
            Enter a <span className="font-mono">homeId</span>. If usage buckets exist (or you enable backfill), this will run the estimate for this specific home.
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs">
              <div className="text-gray-600 mb-1">home preset</div>
              <select
                className="w-[420px] max-w-[90vw] rounded-lg border px-3 py-2 text-xs"
                value=""
                onChange={(e) => {
                  const v = String(e.target.value);
                  const p = HOME_PRESETS.find((x) => x.homeId === v) ?? null;
                  if (p) setHomeId(p.homeId);
                }}
              >
                <option value="">(pick a saved homeId)</option>
                {HOME_PRESETS.map((p) => (
                  <option key={p.id} value={p.homeId}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <div className="text-gray-600 mb-1">homeId</div>
              <input
                className="w-[420px] max-w-[90vw] rounded-lg border px-3 py-2 font-mono text-xs"
                value={homeId}
                onChange={(e) => setHomeId(e.target.value)}
                placeholder="cuid/uuid from HouseAddress.id"
              />
            </label>
            <label className="text-xs">
              <div className="text-gray-600 mb-1">monthsCount</div>
              <input
                className="w-28 rounded-lg border px-3 py-2 font-mono text-xs"
                type="number"
                min={1}
                max={12}
                value={monthsCount}
                onChange={(e) => setMonthsCount(Number(e.target.value))}
              />
            </label>
            <label className="inline-flex items-center gap-2 text-xs mt-5">
              <input type="checkbox" checked={backfill} onChange={(e) => setBackfill(e.target.checked)} />
              backfill
            </label>
            <button
              className="rounded-lg bg-black text-white px-4 py-2 text-sm disabled:opacity-60 mt-5"
              disabled={!token || !homeId.trim() || estimateLoading}
              onClick={() => void runEstimate()}
            >
              {estimateLoading ? "Running…" : "Run estimate"}
            </button>
          </div>

          {estimateErr ? <div className="text-sm text-red-700">{estimateErr}</div> : null}

          {estimateVars ? (
            <div className="space-y-2">
              <div className="text-xs text-gray-600">Calculator inputs (this run)</div>
              <div className="overflow-auto rounded border">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 text-left">variable</th>
                      <th className="px-2 py-2 text-left">value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimateVars.map((r) => (
                      <tr key={r.key} className="border-t">
                        <td className="px-2 py-2 font-mono">{r.key}</td>
                        <td className="px-2 py-2 font-mono break-all">{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <details className="text-xs text-gray-700">
            <summary className="cursor-pointer select-none">Estimate raw JSON</summary>
            <pre className="mt-2 bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">{estimateJson ? pretty(estimateJson) : "—"}</pre>
          </details>
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold">Bucket Coverage (read-only)</div>
          <div className="text-xs text-gray-600">
            Matrix of <span className="font-mono">requiredBucketKeys</span> × months for the selected <span className="font-mono">homeId</span>.
          </div>
          {requiredBucketKeys.length ? (
            <div className="overflow-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left">bucketKey</th>
                    <th className="px-2 py-2 text-left">covers</th>
                  </tr>
                </thead>
                <tbody>
                  {requiredBucketKeys.map((k) => (
                    <tr key={k} className="border-t">
                      <td className="px-2 py-2 font-mono">{k}</td>
                      <td className="px-2 py-2 text-gray-700">{describeBucketKey(k)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60"
              disabled={!token || !homeId.trim() || coverageLoading || requiredBucketKeys.length === 0}
              onClick={() => void loadCoverage()}
              title="Reads existing monthly buckets only (no backfill)."
            >
              {coverageLoading ? "Loading…" : "Load bucket coverage"}
            </button>
            <div className="text-xs text-gray-500">
              required keys: <span className="font-mono">{requiredBucketKeys.length}</span>
            </div>
          </div>
          {coverageErr ? <div className="text-sm text-red-700">{coverageErr}</div> : null}

          {coverageJson?.ok && Array.isArray(coverageJson.months) && Array.isArray(coverageJson.bucketKeys) ? (
            <div className="space-y-3">
              <div className="text-xs text-gray-700">
                fullyCoveredMonths:{" "}
                <span className="font-mono">{String(coverageJson?.summary?.fullyCoveredMonths ?? "—")}</span> /{" "}
                <span className="font-mono">{String((coverageJson.months as any[]).length)}</span>
              </div>

              {Array.isArray(coverageJson?.summary?.missingKeysTop) && coverageJson.summary.missingKeysTop.length > 0 ? (
                <div className="flex flex-wrap gap-2 text-xs">
                  {coverageJson.summary.missingKeysTop.map((k: any) => (
                    <span key={String(k)} className="px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-mono">
                      {String(k)}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="overflow-auto rounded border">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 text-left">month</th>
                      {(coverageJson.bucketKeys as any[]).map((k: any) => (
                        <th key={String(k)} className="px-2 py-2 text-left font-mono">
                          {String(k).replace(/^kwh\.m\./, "")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(coverageJson.months as any[]).map((m: any) => {
                      const ym = String(m);
                      const row = (coverageJson.cells && coverageJson.cells[ym]) ? coverageJson.cells[ym] : {};
                      return (
                        <tr key={ym} className="border-t">
                          <td className="px-2 py-2 font-mono">{ym}</td>
                          {(coverageJson.bucketKeys as any[]).map((k: any) => {
                            const kk = String(k);
                            const cell = row?.[kk] ?? null;
                            const present = Boolean(cell?.present);
                            const kwh = typeof cell?.kwhTotal === "number" ? cell.kwhTotal : null;
                            const sourceKey = cell?.sourceKey ? String(cell.sourceKey) : null;
                            const title = sourceKey ? `from ${sourceKey}` : "";
                            return (
                              <td key={`${ym}:${kk}`} className="px-2 py-2" title={title}>
                                {present ? (
                                  <span className="font-mono text-green-700">
                                    ✅ {kwh != null ? kwh.toFixed(3) : ""}
                                    {sourceKey ? <span className="text-gray-500"> (alias)</span> : null}
                                  </span>
                                ) : (
                                  <span className="font-mono text-red-700">❌</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500">No coverage loaded yet.</div>
          )}

          <details className="text-xs text-gray-700">
            <summary className="cursor-pointer select-none">Coverage raw JSON</summary>
            <pre className="mt-2 bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">{coverageJson ? pretty(coverageJson) : "—"}</pre>
          </details>
        </div>

        <details className="rounded-xl border bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold">Raw JSON</summary>
          <pre className="mt-3 text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[720px]">
            {data ? pretty(data) : "—"}
          </pre>
        </details>
      </div>
    </main>
  );
}

