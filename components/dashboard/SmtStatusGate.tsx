"use client";

import * as React from "react";

type StatusState =
  | "unknown"
  | "none"
  | "PENDING"
  | "ACTIVE"
  | "DECLINED"
  | "EXPIRED"
  | "ERROR";

interface AuthorizationStatus {
  id: string;
  smtAgreementId: string | null;
  smtSubscriptionId: string | null;
  smtStatus: string | null;
  smtStatusMessage: string | null;
  createdAt: string;
}

interface SmtStatusGateProps {
  /**
   * Home (houseAddress) id to check SMT authorization for.
   * Required because SMT authorizations are scoped per home.
   */
  homeId: string;
}

export function SmtStatusGate({ homeId }: SmtStatusGateProps) {
  const [status, setStatus] = React.useState<StatusState>("unknown");
  const [auth, setAuth] = React.useState<AuthorizationStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmationLoading, setConfirmationLoading] = React.useState<
    "idle" | "approved" | "declined"
  >("idle");
  const [confirmationError, setConfirmationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const body = document.body;
    const shouldLock = status === "PENDING" || status === "DECLINED";

    const lock = () => {
      if (!body.dataset.smtGateLocked) {
        body.dataset.smtGateLocked = "true";
        body.dataset.smtGateOriginalOverflow = body.style.overflow ?? "";
      }
      body.style.overflow = "hidden";
    };

    const unlock = () => {
      if (body.dataset.smtGateLocked) {
        const original = body.dataset.smtGateOriginalOverflow ?? "";
        body.style.overflow = original;
        delete body.dataset.smtGateLocked;
        delete body.dataset.smtGateOriginalOverflow;
      }
    };

    if (shouldLock) {
      lock();
    } else {
      unlock();
    }

    return () => {
      unlock();
    };
  }, [status]);

  const mapStatus = React.useCallback((row: AuthorizationStatus | null): StatusState => {
    if (!row) return "none";
    const raw = row.smtStatus ?? "";
    if (!raw) return "PENDING";

    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();

    if (upper === "PENDING") return "PENDING";
    if (upper === "ACTIVE" || upper === "ACT") return "ACTIVE";
    if (upper === "DECLINED" || upper === "NACOM" || lower.includes("not accepted")) {
      return "DECLINED";
    }
    if (upper === "EXPIRED" || lower.includes("completed") || lower.includes("expire")) {
      return "EXPIRED";
    }
    return "ERROR";
  }, []);

  const hasAutoRefreshedRef = React.useRef(false);

  const fetchStatus = React.useCallback(
    async (options: { refresh?: boolean } = {}) => {
      if (!homeId) return;

      setLoading(true);
      setError(null);

      try {
        const url = options.refresh
          ? "/api/smt/authorization/status"
          : `/api/smt/authorization/status?homeId=${encodeURIComponent(homeId)}`;

        const res = await fetch(url, {
          method: options.refresh ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
          },
          body: options.refresh ? JSON.stringify({ homeId }) : undefined,
        });

        const json = await res.json();
        if (!res.ok || !json?.ok) {
          throw new Error(json?.message || json?.error || "Failed to load SMT status");
        }

        const authorization: AuthorizationStatus | null = json.authorization
          ? {
              id: json.authorization.id,
              smtAgreementId: json.authorization.smtAgreementId ?? null,
              smtSubscriptionId: json.authorization.smtSubscriptionId ?? null,
              smtStatus: json.authorization.smtStatus ?? null,
              smtStatusMessage: json.authorization.smtStatusMessage ?? null,
              createdAt: json.authorization.createdAt,
            }
          : null;

        setAuth(authorization);
        const nextStatus = mapStatus(authorization);
        setStatus(nextStatus);

        if (
          !options.refresh &&
          !hasAutoRefreshedRef.current &&
          (nextStatus === "PENDING" || nextStatus === "none" || nextStatus === "unknown")
        ) {
          hasAutoRefreshedRef.current = true;
          void fetchStatus({ refresh: true });
        }
      } catch (err: unknown) {
        console.error("SmtStatusGate fetchStatus error:", err);
        const message = err instanceof Error ? err.message : "Failed to load SMT status";
        setError(message);
        setStatus("ERROR");
      } finally {
        setLoading(false);
      }
    },
    [homeId, mapStatus],
  );

  React.useEffect(() => {
    if (!homeId) return;
    hasAutoRefreshedRef.current = false;
    fetchStatus({ refresh: false });
  }, [homeId, fetchStatus]);

  const handleEmailConfirmation = React.useCallback(
    async (choice: "approved" | "declined") => {
      if (!homeId || confirmationLoading !== "idle") {
        return;
      }

      setConfirmationLoading(choice);
      setConfirmationError(null);
      try {
        const response = await fetch("/api/user/smt/email-confirmation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: choice }),
        });

        let payload: any = null;
        try {
          payload = await response.json();
        } catch {
          // ignore JSON parse issues; payload stays null
        }

        if (!response.ok || (payload && payload.ok === false)) {
          const message =
            payload?.error ||
            payload?.message ||
            "Unable to record your confirmation. Please try again.";
          throw new Error(message);
        }

        if (typeof window !== "undefined") {
          Object.keys(window.localStorage)
            .filter((key) => key.startsWith("smt-email-reminder:"))
            .forEach((key) => window.localStorage.removeItem(key));

          window.dispatchEvent(
            new CustomEvent("smt-email-confirmed", {
              detail: { status: choice },
            }),
          );
        }

        await fetchStatus({ refresh: true });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to record your confirmation. Please try again.";
        setConfirmationError(message);
      } finally {
        setConfirmationLoading("idle");
      }
    },
    [confirmationLoading, fetchStatus, homeId],
  );

  if (status === "unknown" || status === "none") {
    return null;
  }

  const showPending = status === "PENDING";
  const showDeclined = status === "DECLINED";

  if (!showPending && !showDeclined) {
    return null;
  }

  const message = showPending
    ? "We emailed you a Smart Meter Texas authorization link. Approve it to unlock personalized plan recommendations and jackpot entries."
    : "You declined Smart Meter Texas access. Personalized energy analysis and jackpot entries are paused until you authorize sharing again.";

  return (
    <div className="fixed inset-0 z-40 flex min-h-screen items-center justify-center bg-black/60 px-4 py-6">
      <div className="w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl sm:max-h-[90vh] sm:p-8">
        <h2 className="text-lg font-semibold text-gray-900">Smart Meter Texas Authorization Required</h2>
        <p className="mt-3 text-sm text-gray-700">{message}</p>

        {auth?.smtStatusMessage ? (
          <p className="mt-2 text-xs text-gray-500">SMT Status: {auth.smtStatusMessage}</p>
        ) : null}

        {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        {confirmationError ? (
          <p className="mt-2 text-xs text-red-600">{confirmationError}</p>
        ) : null}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {showPending ? (
            <button
              type="button"
              onClick={() => fetchStatus({ refresh: true })}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-md border border-blue-500 px-3 py-1.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Checking status…" : "Refresh Status"}
            </button>
          ) : (
            <span className="text-xs text-gray-600">
              Re-authorize access from your profile to restore full dashboard features.
            </span>
          )}

          {showPending ? (
            <p className="text-xs text-gray-500">
              Didn’t receive the email? Check spam or update your email address in your profile.
            </p>
          ) : null}
        </div>

        {showPending ? (
          <div className="mt-6 space-y-4">
            <p className="text-xs text-gray-600">
              Already clicked the Smart Meter Texas email? Let us know below so we can refresh the status
              immediately.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => handleEmailConfirmation("approved")}
                disabled={confirmationLoading !== "idle"}
                className="inline-flex items-center justify-center rounded-md border border-emerald-500 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirmationLoading === "approved" ? "Submitting…" : "I approved the SMT email"}
              </button>
              <button
                type="button"
                onClick={() => handleEmailConfirmation("declined")}
                disabled={confirmationLoading !== "idle"}
                className="inline-flex items-center justify-center rounded-md border border-rose-500 px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirmationLoading === "declined" ? "Submitting…" : "I declined SMT access"}
              </button>
              <a
                href="/dashboard/api"
                className="inline-flex items-center justify-center rounded-md border border-blue-400 px-3 py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-50"
              >
                Update SMT form
              </a>
            </div>
            <p className="text-xs text-gray-500">
              If you need to start over, open the SMT authorization form to re-send the email or correct your
              details.
            </p>
          </div>
        ) : null}

        {showDeclined ? (
          <p className="mt-3 text-xs font-semibold text-red-600">
            This warning stays visible until Smart Meter Texas access is active again.
          </p>
        ) : null}
      </div>
    </div>
  );
}


