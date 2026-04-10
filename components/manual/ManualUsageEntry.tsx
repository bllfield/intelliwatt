"use client";

import * as React from "react";
import { lastFullMonthChicago, rollingAutoAnchorEndDateChicago } from "@/modules/manualUsage/anchor";
import {
  addDaysToIsoDate,
  buildContiguousStatementRanges,
  buildMonthlyPayloadFromStatementRows,
  buildStatementRowsFromMonthlyPayload,
  MAX_MANUAL_MONTHLY_BILLS,
  normalizeTravelRanges,
  type ManualStatementInputRow,
} from "@/modules/manualUsage/statementRanges";
import type {
  AnnualManualUsagePayload,
  ManualMonthlyDateSourceMode,
  ManualUsagePayload,
  MonthlyManualUsagePayload,
  TravelRange,
} from "@/modules/simulatedUsage/types";

type LoadResp =
  | {
      ok: true;
      houseId: string;
      payload: ManualUsagePayload | null;
      updatedAt: string | null;
      sourcePayload?: ManualUsagePayload | null;
      sourceUpdatedAt?: string | null;
      seed?: {
        sourceMode?: string | null;
        monthly?: MonthlyManualUsagePayload | null;
        annual?: AnnualManualUsagePayload | null;
      } | null;
    }
  | { ok: false; error: string };

type ManualUsageTransport = {
  load?: (houseId: string) => Promise<LoadResp>;
  save?: (args: { houseId: string; payload: ManualUsagePayload }) => Promise<{ ok: true; updatedAt?: string | null } | { ok: false; error: string }>;
};

const DEFAULT_ANCHOR_END_DATE = `${lastFullMonthChicago()}-15`;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const MONTHLY_DATE_SOURCE_OPTIONS: Array<{ value: ManualMonthlyDateSourceMode; label: string }> = [
  { value: "CUSTOMER_DATES", label: "Customer dates" },
  { value: "AUTO_DATES", label: "Auto dates" },
  { value: "ADMIN_CUSTOM_DATES", label: "Admin custom dates" },
];

function isMonthlyDateSourceMode(value: unknown): value is ManualMonthlyDateSourceMode {
  return value === "CUSTOMER_DATES" || value === "AUTO_DATES" || value === "ADMIN_CUSTOM_DATES";
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function normalizeManualDateInput(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (ISO_DATE_RE.test(trimmed)) return trimmed;
  const slashMatch = SLASH_DATE_RE.exec(trimmed);
  if (!slashMatch) return trimmed;
  const [, monthRaw, dayRaw, yearRaw] = slashMatch;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return trimmed;
  if (!isValidCalendarDate(year, month, day)) return trimmed;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatManualDateForEditor(value: string): string {
  const normalized = normalizeManualDateInput(value);
  if (!ISO_DATE_RE.test(normalized)) return String(value ?? "");
  const [year, month, day] = normalized.split("-");
  return `${month}/${day}/${year}`;
}

function defaultMonthlyRows(): ManualStatementInputRow[] {
  const defaultRange = buildContiguousStatementRanges(DEFAULT_ANCHOR_END_DATE, 1)[0];
  return [
    {
      startDate: defaultRange?.startDate ?? DEFAULT_ANCHOR_END_DATE,
      endDate: defaultRange?.endDate ?? DEFAULT_ANCHOR_END_DATE,
      kwh: "",
    },
  ];
}

function mapSaveError(error: string): string {
  switch (error) {
    case "billEndDate_invalid":
      return "Each bill needs a valid Bill End Date.";
    case "billEndDate_order_invalid":
      return "Each older bill must end before the newer bill above it.";
    case "billStartDate_invalid":
      return "The oldest bill needs a valid Bill Start Date.";
    case "billStartDate_after_endDate":
      return "Bill Start Date must be on or before Bill End Date.";
    case "billEndMonth_duplicate":
      return "Each bill must end in a different month with the current runtime contract.";
    case "monthly_statement_required":
      return "Add at least one bill before saving.";
    default:
      return error;
  }
}

function statementStartDateForRow(rows: ManualStatementInputRow[], index: number): string {
  return index === rows.length - 1
    ? rows[index]!.startDate
    : addDaysToIsoDate(normalizeManualDateInput(rows[index + 1]!.endDate), 1);
}

function statementMonthLabel(endDate: string): string {
  const normalized = normalizeManualDateInput(endDate);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized.slice(0, 7) : "pending";
}

function addOlderBillRow(rows: ManualStatementInputRow[]): ManualStatementInputRow[] {
  if (rows.length >= MAX_MANUAL_MONTHLY_BILLS) return rows;
  const oldest = rows[rows.length - 1]!;
  const oldestEndDate = normalizeManualDateInput(oldest.endDate) || DEFAULT_ANCHOR_END_DATE;
  const defaultOlder = buildContiguousStatementRanges(oldestEndDate, 2)[1];
  const nextEndDate =
    /^\d{4}-\d{2}-\d{2}$/.test(normalizeManualDateInput(oldest.startDate))
      ? addDaysToIsoDate(normalizeManualDateInput(oldest.startDate), -1)
      : defaultOlder?.endDate ?? DEFAULT_ANCHOR_END_DATE;
  const nextStartDate = defaultOlder?.startDate ?? nextEndDate;
  return [...rows, { startDate: nextStartDate, endDate: nextEndDate, kwh: "" }];
}

function applyReferenceRowsKeepingTotals(
  currentRows: ManualStatementInputRow[],
  referenceRows: ManualStatementInputRow[]
): ManualStatementInputRow[] {
  return referenceRows.map((row, idx) => ({
    startDate: row.startDate,
    endDate: row.endDate,
    kwh: idx < currentRows.length ? currentRows[idx]?.kwh ?? "" : row.kwh,
  }));
}

function buildAutoDateRows(currentRows: ManualStatementInputRow[], anchorEndDate: string): ManualStatementInputRow[] {
  const count = Math.max(1, currentRows.length);
  const ranges = buildContiguousStatementRanges(anchorEndDate, count);
  return ranges.map((range, idx) => ({
    startDate: range.startDate ?? range.endDate,
    endDate: range.endDate,
    kwh: currentRows[idx]?.kwh ?? "",
  }));
}

export function ManualUsageEntry({
  houseId,
  onSaved,
  transport,
  showMonthlyDateSourceControls = false,
}: {
  houseId: string;
  onSaved?: () => void | Promise<void>;
  transport?: ManualUsageTransport;
  showMonthlyDateSourceControls?: boolean;
}) {
  const [activeTab, setActiveTab] = React.useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);

  const [monthlyRows, setMonthlyRows] = React.useState<ManualStatementInputRow[]>(defaultMonthlyRows);
  const [annualAnchorEndDate, setAnnualAnchorEndDate] = React.useState<string>("");
  const [annualKwh, setAnnualKwh] = React.useState<number | "">("");
  const [travelRanges, setTravelRanges] = React.useState<TravelRange[]>([]);
  const [sourcePayloadContext, setSourcePayloadContext] = React.useState<ManualUsagePayload | null>(null);
  const [monthlyDateSourceMode, setMonthlyDateSourceMode] = React.useState<ManualMonthlyDateSourceMode>("ADMIN_CUSTOM_DATES");

  const rollingAutoAnchorEndDate = React.useMemo(() => rollingAutoAnchorEndDateChicago(), []);
  const customerDateRows = React.useMemo(
    () => (sourcePayloadContext?.mode === "MONTHLY" ? buildStatementRowsFromMonthlyPayload(sourcePayloadContext) : []),
    [sourcePayloadContext]
  );
  const dateEditingLocked = showMonthlyDateSourceControls && monthlyDateSourceMode !== "ADMIN_CUSTOM_DATES";

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const json = transport?.load
          ? await transport.load(houseId)
          : ((await (async () => {
              const res = await fetch(`/api/user/manual-usage?houseId=${encodeURIComponent(houseId)}`, {
                cache: "no-store",
              });
              const body = (await res.json().catch(() => null)) as LoadResp | null;
              if (!res.ok || !body || (body as any).ok !== true) {
                throw new Error((body as any)?.error || `HTTP ${res.status}`);
              }
              return body;
            })()) as LoadResp);
        if (!json || (json as any).ok !== true) {
          throw new Error((json as any)?.error || "Failed to load manual usage");
        }
        if (cancelled) return;
        const payload = (json as any).payload as ManualUsagePayload | null;
        setSourcePayloadContext(((json as any).sourcePayload as ManualUsagePayload | null) ?? null);
        setSavedAt((json as any).updatedAt ?? null);
        const seed = (json as any).seed ?? null;
        if (seed?.monthly) {
          setMonthlyRows(buildStatementRowsFromMonthlyPayload(seed.monthly));
        }
        if (seed?.annual) {
          setAnnualAnchorEndDate(String(seed.annual.anchorEndDate ?? "").slice(0, 10));
          setAnnualKwh(seed.annual.annualKwh);
        }
        if (payload?.mode === "MONTHLY") {
          setActiveTab("MONTHLY");
          setMonthlyRows(buildStatementRowsFromMonthlyPayload(payload));
          setMonthlyDateSourceMode(
            isMonthlyDateSourceMode((payload as any).dateSourceMode)
              ? (payload as any).dateSourceMode
              : ((json as any).sourcePayload as ManualUsagePayload | null)?.mode === "MONTHLY"
                ? "CUSTOMER_DATES"
                : "ADMIN_CUSTOM_DATES"
          );
          setTravelRanges(Array.isArray(payload.travelRanges) ? payload.travelRanges : []);
          return;
        }
        if (payload?.mode === "ANNUAL") {
          setActiveTab("ANNUAL");
          setAnnualAnchorEndDate(String((payload as any).anchorEndDate ?? (payload as any).endDate ?? "").slice(0, 10));
          setAnnualKwh(payload.annualKwh);
          setTravelRanges(Array.isArray(payload.travelRanges) ? payload.travelRanges : []);
          return;
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load manual usage");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [houseId, transport]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let payload: ManualUsagePayload;
      if (activeTab === "MONTHLY") {
        const normalizedRows = monthlyRows.map((row) => ({
          ...row,
          startDate: normalizeManualDateInput(row.startDate),
          endDate: normalizeManualDateInput(row.endDate),
        }));
        const built = buildMonthlyPayloadFromStatementRows(normalizedRows);
        if (!built.ok) {
          throw new Error(mapSaveError(built.error));
        }
        payload = {
          mode: "MONTHLY",
          anchorEndDate: built.anchorEndDate,
          monthlyKwh: built.monthlyKwh,
          statementRanges: built.statementRanges,
          travelRanges: normalizeTravelRanges(travelRanges),
          dateSourceMode: showMonthlyDateSourceControls ? monthlyDateSourceMode : undefined,
        };
      } else {
        payload = {
          mode: "ANNUAL",
          anchorEndDate: normalizeManualDateInput(String(annualAnchorEndDate ?? "")),
          annualKwh: annualKwh === "" ? "" : Number(annualKwh),
          travelRanges: normalizeTravelRanges(travelRanges),
        };
      }

      const json = transport?.save
        ? await transport.save({ houseId, payload })
        : await (async () => {
            const res = await fetch("/api/user/manual-usage", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ houseId, payload }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body || body.ok !== true) {
              throw new Error(body?.error || `HTTP ${res.status}`);
            }
            return body as { ok: true; updatedAt?: string | null };
          })();
      if (!json || json.ok !== true) {
        throw new Error((json as any)?.error || "Save failed");
      }
      setSavedAt(json.updatedAt ?? new Date().toISOString());
      if (onSaved) await Promise.resolve(onSaved());
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const applyMonthlyDateSourceMode = React.useCallback(
    (nextMode: ManualMonthlyDateSourceMode) => {
      setMonthlyDateSourceMode(nextMode);
      if (nextMode === "ADMIN_CUSTOM_DATES") return;
      if (nextMode === "CUSTOMER_DATES") {
        if (customerDateRows.length > 0) {
          setMonthlyRows((prev) => applyReferenceRowsKeepingTotals(prev, customerDateRows));
        }
        return;
      }
      setMonthlyRows((prev) => buildAutoDateRows(prev, rollingAutoAnchorEndDate));
    },
    [customerDateRows, rollingAutoAnchorEndDate]
  );

  return (
    <div id="manual-entry" className="space-y-6">
      <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Manual usage</p>
            <p className="mt-2 text-sm text-brand-cyan/80">
              Enter your kWh totals to generate a simulated 15‑minute usage curve for IntelliWatt comparisons.
            </p>
            {savedAt ? (
              <p className="mt-2 text-xs text-brand-cyan/60">Last saved: {new Date(savedAt).toLocaleString()}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("MONTHLY")}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                activeTab === "MONTHLY"
                  ? "border-brand-blue bg-brand-blue/20 text-brand-navy"
                  : "border-brand-cyan/20 bg-brand-navy text-brand-cyan/80 hover:bg-brand-cyan/5"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ANNUAL")}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                activeTab === "ANNUAL"
                  ? "border-brand-blue bg-brand-blue/20 text-brand-navy"
                  : "border-brand-cyan/20 bg-brand-navy text-brand-cyan/80 hover:bg-brand-cyan/5"
              }`}
            >
              Annual
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan">
          Loading…
        </div>
      ) : (
        <>
          {activeTab === "MONTHLY" ? (
            <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
                Monthly bill entry
              </p>

              <div className="mt-4 rounded-2xl border border-brand-cyan/15 bg-brand-navy px-4 py-4 text-xs text-brand-cyan/75">
                Stage 1 uses bill ranges. The newest bill is entered first, each older bill is added below it, and only the oldest
                bill needs a manual start date when multiple bills are present. Stage 2 still normalizes the saved totals into the
                shared Past Sim display.
              </div>

              {showMonthlyDateSourceControls ? (
                <div className="mt-4 rounded-2xl border border-brand-cyan/15 bg-brand-navy px-4 py-4">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div>
                      <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                        Date source
                      </label>
                      <select
                        value={monthlyDateSourceMode}
                        onChange={(e) => applyMonthlyDateSourceMode(e.target.value as ManualMonthlyDateSourceMode)}
                        className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
                      >
                        {MONTHLY_DATE_SOURCE_OPTIONS.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={option.value === "CUSTOMER_DATES" && customerDateRows.length === 0}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="text-xs text-brand-cyan/75 lg:col-span-2">
                      <div>Active mode: {monthlyDateSourceMode}</div>
                      <div>Resolved anchorEndDate: {normalizeManualDateInput(monthlyRows[0]?.endDate ?? "") || "pending"}</div>
                      <div>Resolved bill-end day: {(normalizeManualDateInput(monthlyRows[0]?.endDate ?? "").slice(8, 10) || "pending")}</div>
                    </div>
                  </div>
                  <p className="mt-3 text-[0.7rem] text-brand-cyan/60">
                    Customer dates are read-only source context, Auto dates use the shared rolling current-date-minus-2-days rule,
                    and Admin custom dates unlock direct date edits on the isolated lab payload only.
                  </p>
                </div>
              ) : null}

              <div className="mt-6 space-y-4">
                {monthlyRows.map((row, idx) => {
                  const isNewest = idx === 0;
                  const isOldest = idx === monthlyRows.length - 1;
                  const statementStartDate = statementStartDateForRow(monthlyRows, idx);
                  return (
                    <div key={`bill-${idx}`} className="rounded-2xl border border-brand-cyan/15 bg-brand-navy px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-brand-cyan">
                            Bill {idx + 1} {isNewest ? "(Newest)" : isOldest ? "(Oldest)" : ""}
                          </div>
                          <div className="text-[0.7rem] uppercase tracking-wide text-brand-cyan/60">
                            Runtime month key {statementMonthLabel(row.endDate)}
                          </div>
                        </div>
                        <div className="text-xs text-brand-cyan/70">
                          Statement range: {statementStartDate || "pending"} to {row.endDate || "pending"}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 lg:grid-cols-3">
                        <div>
                          <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                            Bill End Date
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="MM/DD/YYYY"
                            value={formatManualDateForEditor(row.endDate)}
                            onChange={(e) => {
                              if (dateEditingLocked) return;
                              const value = e.target.value;
                              setMonthlyRows((prev) => prev.map((entry, entryIdx) => (entryIdx === idx ? { ...entry, endDate: value } : entry)));
                            }}
                            onBlur={(e) => {
                              if (dateEditingLocked) return;
                              const value = normalizeManualDateInput(e.target.value);
                              setMonthlyRows((prev) => prev.map((entry, entryIdx) => (entryIdx === idx ? { ...entry, endDate: value } : entry)));
                            }}
                            readOnly={dateEditingLocked}
                            className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan read-only:opacity-70"
                          />
                        </div>

                        <div>
                          <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                            {isOldest ? "Bill Start Date" : "Bill Start Date (Auto)"}
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="MM/DD/YYYY"
                            value={formatManualDateForEditor(statementStartDate)}
                            onChange={(e) => {
                              if (dateEditingLocked || !isOldest) return;
                              const value = e.target.value;
                              setMonthlyRows((prev) => prev.map((entry, entryIdx) => (entryIdx === idx ? { ...entry, startDate: value } : entry)));
                            }}
                            onBlur={(e) => {
                              if (dateEditingLocked || !isOldest) return;
                              const value = normalizeManualDateInput(e.target.value);
                              setMonthlyRows((prev) => prev.map((entry, entryIdx) => (entryIdx === idx ? { ...entry, startDate: value } : entry)));
                            }}
                            readOnly={dateEditingLocked || !isOldest}
                            className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan read-only:opacity-70"
                          />
                          <p className="mt-2 text-[0.7rem] text-brand-cyan/60">
                            {isOldest
                              ? monthlyRows.length === 1
                                ? "Single-bill entry needs both a start and end date."
                                : "Only the oldest entered bill needs a manual start date."
                              : "This start date is inferred from the next older bill’s end date."}
                          </p>
                        </div>

                        <div>
                          <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                            Statement kWh
                          </label>
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            value={row.kwh}
                            onChange={(e) => {
                              const value = e.target.value === "" ? "" : Number(e.target.value);
                              setMonthlyRows((prev) =>
                                prev.map((entry, entryIdx) =>
                                  entryIdx === idx ? { ...entry, kwh: value === "" ? "" : Number.isFinite(value) ? value : "" } : entry
                                )
                              );
                            }}
                            className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
                            placeholder="kWh"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setMonthlyRows((prev) => addOlderBillRow(prev))}
                  disabled={dateEditingLocked || monthlyRows.length >= MAX_MANUAL_MONTHLY_BILLS}
                  className="rounded-full border border-brand-blue/60 bg-brand-blue/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:bg-brand-blue/25 disabled:opacity-60"
                >
                  Add Bill
                </button>
                <button
                  type="button"
                  onClick={() => setMonthlyRows((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
                  disabled={dateEditingLocked || monthlyRows.length <= 1}
                  className="rounded-full border border-brand-cyan/20 bg-brand-navy px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan/80 transition hover:bg-brand-cyan/5 disabled:opacity-60"
                >
                  Remove Oldest Bill
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
                Annual entry
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                    Anchor end date
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="MM/DD/YYYY"
                    value={formatManualDateForEditor(annualAnchorEndDate)}
                    onChange={(e) => setAnnualAnchorEndDate(e.target.value)}
                    onBlur={(e) => setAnnualAnchorEndDate(normalizeManualDateInput(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
                  />
                </div>
                <div>
                  <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                    Annual kWh
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={annualKwh}
                    onChange={(e) => setAnnualKwh(e.target.value === "" ? "" : Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
                    placeholder="kWh"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-brand-cyan/60">
                We’ll distribute the annual total across 12 billing periods ending at this date using a deterministic seasonal profile.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-brand-navy/70">
              {error ? <span className="text-rose-700">Error: {error}</span> : null}
            </div>
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="inline-flex items-center justify-center rounded-full border border-brand-blue/60 bg-brand-blue/15 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:bg-brand-blue/25 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save manual usage"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

