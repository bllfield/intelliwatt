"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type BillingReadRow = {
  id: string;
  esiid: string | null;
  meter: string | null;
  tdspCode: string | null;
  tdspName: string | null;
  readStart: string | null;
  readEnd: string | null;
  billDate: string | null;
  kwhTotal: number | null;
  kwhBilled: number | null;
  source: string | null;
  rawSmtFileId: string | null;
};

interface BillingReadsTableProps {
  initialEsiid: string;
  initialLimit: number;
  rows: BillingReadRow[];
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

const LIMIT_OPTIONS = [50, 100, 250, 500];

export default function BillingReadsTable({
  initialEsiid,
  initialLimit,
  rows,
}: BillingReadsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [esiid, setEsiid] = useState(initialEsiid);
  const [limit, setLimit] = useState(
    LIMIT_OPTIONS.includes(initialLimit) ? initialLimit : 100,
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams(searchParams?.toString() ?? "");

    if (esiid.trim()) {
      params.set("esiid", esiid.trim());
    } else {
      params.delete("esiid");
    }

    params.set("limit", String(limit));
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="billing-esiid" className="text-sm font-medium text-foreground">
            ESIID
          </label>
          <input
            id="billing-esiid"
            name="esiid"
            value={esiid}
            onChange={(event) => setEsiid(event.target.value)}
            placeholder="Optional ESIID filter"
            className="w-64 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="billing-limit" className="text-sm font-medium text-foreground">
            Rows
          </label>
          <select
            id="billing-limit"
            name="limit"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            className="w-28 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          Apply Filters
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No billing reads found for the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] table-auto border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left font-semibold text-foreground">
                <th className="px-3 py-2">ESIID</th>
                <th className="px-3 py-2">Meter</th>
                <th className="px-3 py-2">Bill Date</th>
                <th className="px-3 py-2">Read Start</th>
                <th className="px-3 py-2">Read End</th>
                <th className="px-3 py-2">kWh Total</th>
                <th className="px-3 py-2">kWh Billed</th>
                <th className="px-3 py-2">TDSP</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Raw File ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="px-3 py-2 font-mono text-xs text-foreground/90">
                    {row.esiid || "—"}
                  </td>
                  <td className="px-3 py-2 text-foreground/80">{row.meter || "—"}</td>
                  <td className="px-3 py-2 text-foreground/80">{formatDate(row.billDate)}</td>
                  <td className="px-3 py-2 text-foreground/80">{formatDate(row.readStart)}</td>
                  <td className="px-3 py-2 text-foreground/80">{formatDate(row.readEnd)}</td>
                  <td className="px-3 py-2 text-foreground/80">{formatNumber(row.kwhTotal)}</td>
                  <td className="px-3 py-2 text-foreground/80">{formatNumber(row.kwhBilled)}</td>
                  <td className="px-3 py-2 text-foreground/80">
                    <div className="flex flex-col">
                      <span>{row.tdspCode || "—"}</span>
                      <span className="text-xs text-muted-foreground">{row.tdspName || ""}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-foreground/80">{row.source || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-foreground/90">
                    {row.rawSmtFileId || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
