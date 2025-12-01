"use client";

import * as React from "react";

interface SmtStatusBannerProps {
  homeId: string;
}

type BannerStatus = "ACTIVE" | "PENDING" | "DECLINED" | "EXPIRED" | "ERROR" | "none";

function classifyStatus(status: string | null | undefined): BannerStatus {
  if (!status) return "PENDING";
  const upper = status.toUpperCase();
  const lower = status.toLowerCase();

  if (upper === "ACTIVE" || upper === "ACT") return "ACTIVE";
  if (upper === "DECLINED" || upper === "NACOM" || lower.includes("not accepted")) return "DECLINED";
  if (upper === "EXPIRED" || lower.includes("expired")) return "EXPIRED";
  if (upper === "PENDING") return "PENDING";
  return "ERROR";
}

export function SmtStatusBanner({ homeId }: SmtStatusBannerProps) {
  const [status, setStatus] = React.useState<BannerStatus>("none");
  const [message, setMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchStatus = React.useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const targetUrl = refresh
          ? "/api/smt/authorization/status"
          : `/api/smt/authorization/status?homeId=${encodeURIComponent(homeId)}`;

        const response = await fetch(targetUrl, {
          method: refresh ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
          },
          body: refresh ? JSON.stringify({ homeId }) : undefined,
        });

        const json = await response.json();
        if (!response.ok || !json?.ok) {
          throw new Error(json?.message || json?.error || "Failed to load SMT status");
        }

        const authorization = json.authorization;
        if (!authorization) {
          setStatus("none");
          setMessage(null);
        } else {
          setStatus(classifyStatus(authorization.smtStatus));
          setMessage(authorization.smtStatusMessage ?? null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load SMT status";
        setError(message);
        setStatus("ERROR");
      } finally {
        setLoading(false);
      }
    },
    [homeId],
  );

  React.useEffect(() => {
    if (!homeId) {
      setStatus("none");
      setMessage(null);
      setError(null);
      return;
    }

    void fetchStatus(false);
  }, [homeId, fetchStatus]);

  if (!homeId || status === "none") {
    return null;
  }

  let containerClasses = "rounded-lg border p-4 text-sm";
  let statusLabelClasses = "font-semibold";

  switch (status) {
    case "ACTIVE":
      containerClasses += " border-emerald-200 bg-emerald-50 text-emerald-800";
      statusLabelClasses += " text-emerald-900";
      break;
    case "PENDING":
      containerClasses += " border-amber-200 bg-amber-50 text-amber-800";
      statusLabelClasses += " text-amber-900";
      break;
    case "DECLINED":
      containerClasses += " border-rose-200 bg-rose-50 text-rose-800";
      statusLabelClasses += " text-rose-900";
      break;
    case "EXPIRED":
      containerClasses += " border-slate-200 bg-slate-100 text-slate-700";
      statusLabelClasses += " text-slate-900";
      break;
    case "ERROR":
      containerClasses += " border-red-200 bg-red-100 text-red-800";
      statusLabelClasses += " text-red-900";
      break;
    default:
      containerClasses += " border-slate-200 bg-slate-100 text-slate-700";
      statusLabelClasses += " text-slate-900";
      break;
  }

  return (
    <div className={containerClasses}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className={statusLabelClasses}>
            Smart Meter Texas status: <span className="uppercase">{status}</span>
          </p>
          {message ? <p className="text-xs opacity-80">{message}</p> : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fetchStatus(true)}
            disabled={loading}
            className="inline-flex items-center rounded-md border border-slate-400 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Checking…" : "Refresh status"}
          </button>

          {status === "DECLINED" ? (
            <a
              href="/dashboard/api"
              className="inline-flex items-center rounded-md border border-rose-500 px-3 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-100"
            >
              Re-authorize access
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}


