import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { syncHouseIdentifiersFromAuthorization } from "@/lib/house/syncIdentifiers";

export type SmtAgreementRequest = {
  esiid: string;
  serviceAddress: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  tdspCode?: string | null;
  monthsBack?: number | null;
  includeInterval?: boolean | null;
  includeBilling?: boolean | null;
  meterNumber?: string | null;
  repPuctNumber?: string | null;
};

export type SmtAgreementResult = {
  ok: boolean;
  agreementId?: string;
  subscriptionId?: string;
  status?: string;
  message?: string;
  backfillRequestedAt?: string;
  backfillCompletedAt?: string;
  subscriptionAlreadyActive?: boolean;
};

export interface SmtBackfillRequest {
  authorizationId: string;
  esiid: string;
  meterNumber?: string | null;
  startDate: Date;
  endDate: Date;
}

export function getRollingBackfillRange(monthsBack: number = 12): {
  startDate: Date;
  endDate: Date;
} {
  // SMT guidance: request 365 days of interval data ending "yesterday".
  // IMPORTANT: SMT semantics are America/Chicago calendar days.
  // We ignore monthsBack here and always take a 365-day window for now
  // to avoid surprises around month length / DST.

  const DAY_MS = 24 * 60 * 60 * 1000;
  const SMT_TZ = "America/Chicago";
  const chicagoDateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SMT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const chicagoDateKey = (d: Date): string => {
    try {
      return chicagoDateFmt.format(d); // YYYY-MM-DD in America/Chicago
    } catch {
      // Fallback: stable UTC day key (better than throwing)
      return d.toISOString().slice(0, 10);
    }
  };

  const dayIndexFromKey = (key: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key).trim());
    if (!m) return Number.NaN;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const ms = Date.UTC(y, mo - 1, d);
    return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : Number.NaN;
  };

  const keyFromDayIndex = (idx: number): string => {
    const ms = idx * DAY_MS;
    return new Date(ms).toISOString().slice(0, 10);
  };

  const nowKey = chicagoDateKey(new Date());
  const nowIdx = dayIndexFromKey(nowKey);
  const endIdx = Number.isFinite(nowIdx) ? nowIdx - 1 : dayIndexFromKey(new Date().toISOString().slice(0, 10)) - 1;

  // Inclusive 365-day window: [start, end] contains 365 distinct calendar days.
  const endKey = keyFromDayIndex(endIdx);
  const startKey = keyFromDayIndex(endIdx - 364);

  // Represent day keys as UTC instants purely for transport/formatting (MM/DD/YYYY).
  // Do NOT interpret these instants as "Chicago midnight" — they are calendar-day markers.
  const startDate = new Date(`${startKey}T00:00:00.000Z`);
  const endDate = new Date(`${endKey}T23:59:59.999Z`);

  return { startDate, endDate };
}

// Feature flag to hard-disable SMT agreements from env.
const SMT_AGREEMENTS_ENABLED =
  process.env.SMT_AGREEMENTS_ENABLED === "true" ||
  process.env.SMT_AGREEMENTS_ENABLED === "1";

// Backfill (interval) support is not implemented on the SMT proxy yet. Guard it with a flag.
const SMT_INTERVAL_BACKFILL_ENABLED =
  process.env.SMT_INTERVAL_BACKFILL_ENABLED === "true" ||
  process.env.SMT_INTERVAL_BACKFILL_ENABLED === "1";

// Hard cooldown to prevent hammering SMT proxy "myagreements" from the app.
// Note: must be a string "true"/"1" for enablement flags; cooldown is milliseconds.
const SMT_STATUS_REFRESH_COOLDOWN_MS = (() => {
  const raw =
    process.env.SMT_STATUS_REFRESH_COOLDOWN_MS ??
    process.env.SMT_AUTH_STATUS_COOLDOWN_MS ??
    "";
  const n = Number.parseInt(String(raw || "").trim(), 10);
  // Default: 60s cooldown. Set to 0 to disable throttling.
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
})();

// Droplet proxy wiring (already configured in Vercel).
const SMT_PROXY_AGREEMENTS_URL =
  process.env.SMT_PROXY_AGREEMENTS_URL ||
  process.env.SMT_PROXY_URL ||
  "";

const SMT_PROXY_TOKEN = process.env.SMT_PROXY_TOKEN || "";

function resolveProxyBaseUrl(): string {
  if (!SMT_PROXY_AGREEMENTS_URL) {
    throw new Error("SMT_PROXY_AGREEMENTS_URL/SMT_PROXY_URL not configured");
  }

  try {
    const url = new URL(SMT_PROXY_AGREEMENTS_URL);
    if (url.pathname.endsWith("/agreements")) {
      url.pathname = url.pathname.replace(/\/agreements$/, "");
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    // If SMT_PROXY_AGREEMENTS_URL is not a full URL, fall back to string operations.
    return SMT_PROXY_AGREEMENTS_URL.replace(/\/agreements\/?$/, "");
  }
}

function buildProxyUrl(path: string): string {
  const base = resolveProxyBaseUrl().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function formatDateMDY(date: Date): string {
  // SMT XML schema examples use MM/DD/YYYY as a string. Keep leading zeros.
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const y = String(date.getUTCFullYear());
  return `${m}/${d}/${y}`;
}

export async function requestSmtBackfillForAuthorization(
  req: SmtBackfillRequest,
): Promise<{ ok: boolean; message?: string }> {
  if (!SMT_INTERVAL_BACKFILL_ENABLED) {
    console.info("[SMT_BACKFILL] interval backfill disabled (proxy does not support it yet)", {
      authorizationId: req.authorizationId,
      esiid: req.esiid,
    });
    return { ok: false, message: "interval backfill disabled" };
  }

  if (!SMT_PROXY_AGREEMENTS_URL && !SMT_PROXY_TOKEN) {
    console.warn("[SMT_BACKFILL] Proxy not configured; skipping backfill request.", {
      authorizationId: req.authorizationId,
    });
    return { ok: false, message: "SMT proxy not configured" };
  }

  const payload = {
    action: "request_interval_backfill",
    authorizationId: req.authorizationId,
    esiid: normalizeEsiid(req.esiid),
    meterNumber: req.meterNumber ?? null,
    // SMT Interface schema: startDate/endDate are xsd:string with maxLength 10.
    // Use MM/DD/YYYY as in the official examples.
    startDate: formatDateMDY(req.startDate),
    endDate: formatDateMDY(req.endDate),
  };

  try {
    const url = SMT_PROXY_AGREEMENTS_URL || buildProxyUrl("/smt/backfill");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SMT_PROXY_TOKEN
          ? { Authorization: `Bearer ${SMT_PROXY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn("[SMT_BACKFILL] HTTP error", {
        action: payload.action,
        status: res.status,
        body: text.slice(0, 300),
      });
      return {
        ok: false,
        message: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const json: any = await res.json().catch(() => ({}));
    const ok = Boolean(json?.ok ?? true);
    return {
      ok,
      message: json?.message,
    };
  } catch (error: any) {
    console.error("[SMT_BACKFILL] network error", error);
    return {
      ok: false,
      message: error?.message ?? String(error),
    };
  }
}

const LEGACY_ACTION_MAP: Record<string, string> = {
  "/smt/agreements/myagreements": "myagreements",
  "/smt/agreements/esiids": "agreement_esiids",
  "/smt/agreements/terminate": "terminate_agreement",
  "/smt/report-status": "report_status",
  "/smt/subscriptions/list": "list_subscriptions",
};

async function callLegacyProxy(
  action: string,
  body: Record<string, unknown>,
): Promise<any> {
  if (!SMT_PROXY_AGREEMENTS_URL) {
    throw new Error("SMT_PROXY_AGREEMENTS_URL/SMT_PROXY_URL not configured");
  }

  const payload = { ...body, action };
  const bodyPreview = (() => {
    try {
      return JSON.stringify(payload).slice(0, 500);
    } catch {
      return "[unserializable-body]";
    }
  })();

  console.log(
    `[SMT_PROXY] legacy request action=${action} url=${SMT_PROXY_AGREEMENTS_URL} body=${bodyPreview}`,
  );

  let response: Response;
  try {
    response = await fetch(SMT_PROXY_AGREEMENTS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SMT_PROXY_TOKEN
          ? { Authorization: `Bearer ${SMT_PROXY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error(
      "[SMT_PROXY] legacy network error action=%s error=%o",
      action,
      error,
    );
    throw error;
  }

  const status = response.status;
  let rawText = "";
  try {
    rawText = await response.text();
  } catch (error) {
    console.error(
      "[SMT_PROXY] legacy failed to read response action=%s status=%s error=%o",
      action,
      status,
      error,
    );
  }

  console.log(
    `[SMT_PROXY] legacy response action=${action} status=${status} bodySnip=${rawText.slice(
      0,
      500,
    )}`,
  );

  if (!response.ok) {
    throw new Error(
      `SMT proxy legacy action ${action} HTTP ${status}: ${rawText.slice(0, 500)}`,
    );
  }

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return { rawText };
  }
}

async function postToSmtProxy(
  path: string,
  body: Record<string, unknown> = {},
): Promise<any> {
  const url = buildProxyUrl(path);
  const bodyPreview = (() => {
    try {
      return JSON.stringify(body).slice(0, 500);
    } catch {
      return "[unserializable-body]";
    }
  })();

  console.log(
    `[SMT_PROXY] request path=${path} url=${url} body=${bodyPreview}`,
  );

  const fallbackAction = LEGACY_ACTION_MAP[path];

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SMT_PROXY_TOKEN
          ? { Authorization: `Bearer ${SMT_PROXY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("[SMT_PROXY] network error path=%s", path, error);
    if (fallbackAction) {
      console.warn(
        "[SMT_PROXY] falling back to legacy action=%s after network error",
        fallbackAction,
      );
      return callLegacyProxy(fallbackAction, body);
    }
    throw error;
  }

  const status = response.status;
  let rawText = "";
  try {
    rawText = await response.text();
  } catch (error) {
    console.error(
      "[SMT_PROXY] failed to read response body path=%s status=%s error=%o",
      path,
      status,
      error,
    );
  }

  if (!response.ok) {
    console.warn(
      "[SMT_PROXY] primary response path=%s status=%s bodySnip=%s",
      path,
      status,
      rawText.slice(0, 500),
    );
    if (fallbackAction) {
      console.warn(
        "[SMT_PROXY] falling back to legacy action=%s after status=%s",
        fallbackAction,
        status,
      );
      return callLegacyProxy(fallbackAction, body);
    }
    throw new Error(
      `SMT proxy ${path} HTTP ${status}: ${rawText.slice(0, 500)}`,
    );
  }

  console.log(
    `[SMT_PROXY] response path=${path} status=${status} bodySnip=${rawText.slice(
      0,
      500,
    )}`,
  );

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return { rawText };
  }
}

export async function getSmtAgreementStatus(
  esiid: string,
  opts: { agreementNumber?: number | string | null; retailCustomerEmail?: string | null; statusReason?: string | null } = {},
) {
  const sanitizedEsiid = normalizeEsiid(esiid);

  const payload: Record<string, unknown> = {
    esiid: sanitizedEsiid,
  };

  if (opts?.agreementNumber !== undefined && opts?.agreementNumber !== null) {
    const num = Number.parseInt(String(opts.agreementNumber).trim(), 10);
    if (Number.isFinite(num)) {
      payload.agreementNumber = num;
    }
  }

  if (opts?.retailCustomerEmail && typeof opts.retailCustomerEmail === "string") {
    const email = opts.retailCustomerEmail.trim();
    if (email) payload.retailCustomerEmail = email;
  }

  if (opts?.statusReason && typeof opts.statusReason === "string") {
    const reason = opts.statusReason.trim();
    if (reason) payload.statusReason = reason;
  }

  return postToSmtProxy("/smt/agreements/myagreements", payload);
}

/**
 * List SMT subscriptions for our CSP via the droplet proxy.
 */
export async function listSmtSubscriptions(serviceType?: string) {
  const payload: Record<string, unknown> = {};
  if (serviceType && typeof serviceType === "string") {
    payload.serviceType = serviceType;
  }
  return postToSmtProxy("/smt/subscriptions/list", payload);
}

export async function getSmtReportStatus(
  correlationId: string,
  serviceType?: string,
) {
  if (!correlationId || typeof correlationId !== "string") {
    throw new Error("getSmtReportStatus: correlationId is required");
  }

  const payload: Record<string, unknown> = { correlationId };
  if (serviceType && typeof serviceType === "string") {
    payload.serviceType = serviceType;
  }

  return postToSmtProxy("/smt/report-status", payload);
}

/**
 * Get list of ESIIDs tied to a specific Energy Data Sharing Agreement.
 * Wraps droplet /smt/agreements/esiids.
 */
export async function getSmtAgreementEsiids(
  agreementNumber: number | string,
) {
  if (
    agreementNumber === null ||
    agreementNumber === undefined ||
    (typeof agreementNumber !== "number" && typeof agreementNumber !== "string")
  ) {
    throw new Error("getSmtAgreementEsiids: agreementNumber is required");
  }

  const numeric =
    typeof agreementNumber === "number"
      ? agreementNumber
      : Number.parseInt(agreementNumber, 10);

  if (!numeric || Number.isNaN(numeric)) {
    throw new Error("getSmtAgreementEsiids: agreementNumber invalid");
  }

  return postToSmtProxy("/smt/agreements/esiids", {
    agreementNumber: numeric,
  });
}

export async function terminateSmtAgreement(
  agreementNumber: number | string,
  retailCustomerEmail: string,
) {
  if (
    agreementNumber === null ||
    agreementNumber === undefined ||
    (typeof agreementNumber !== "number" && typeof agreementNumber !== "string")
  ) {
    throw new Error("terminateSmtAgreement: agreementNumber is required");
  }

  if (!retailCustomerEmail || typeof retailCustomerEmail !== "string") {
    throw new Error("terminateSmtAgreement: retailCustomerEmail is required");
  }

  const numeric =
    typeof agreementNumber === "number"
      ? agreementNumber
      : Number.parseInt(String(agreementNumber), 10);

  if (!numeric || Number.isNaN(numeric)) {
    throw new Error("terminateSmtAgreement: agreementNumber invalid");
  }

  return postToSmtProxy("/smt/agreements/terminate", {
    agreementNumber: numeric,
    retailCustomerEmail: retailCustomerEmail.trim(),
  });
}

// Local SMT agreement status classification used by the app.
export type LocalSmtStatus =
  | "PENDING"
  | "ACTIVE"
  | "DECLINED"
  | "EXPIRED"
  | "ERROR";

export function mapSmtAgreementStatus(
  rawStatus: string | null | undefined,
): LocalSmtStatus {
  if (!rawStatus) return "ERROR";
  const s = rawStatus.toLowerCase();

  if (s.includes("pending")) return "PENDING";
  if (s === "act" || s.includes("active")) return "ACTIVE";
  if (
    s.includes("not accepted") ||
    s.includes("declined") ||
    s.includes("nacom")
  ) {
    return "DECLINED";
  }
  if (
    s.includes("completed") ||
    s.includes("expire in last 45 days") ||
    s.includes("terminated in last 45 days") ||
    s.includes("terminated")
  ) {
    return "EXPIRED";
  }

  return "ERROR";
}

function resolveAgreementStatus(
  status: string | null | undefined,
  statusReason: string | null | undefined,
): { localStatus: LocalSmtStatus; displayStatus: string | null } {
  const fromStatus = mapSmtAgreementStatus(status);
  const fromReason = mapSmtAgreementStatus(statusReason);

  // SMT can return mixed payloads (e.g., status=ACT with stale pending reason).
  // If either field indicates ACTIVE, treat the agreement as ACTIVE.
  if (fromStatus === "ACTIVE" || fromReason === "ACTIVE") {
    const display =
      fromStatus === "ACTIVE"
        ? (status ?? statusReason ?? null)
        : (statusReason ?? status ?? null);
    return { localStatus: "ACTIVE", displayStatus: display };
  }

  if (fromStatus !== "ERROR") {
    return { localStatus: fromStatus, displayStatus: status ?? statusReason ?? null };
  }
  return { localStatus: fromReason, displayStatus: statusReason ?? status ?? null };
}

export interface SmtAgreementSummary {
  agreementNumber?: number | null;
  status?: string | null;
  statusReason?: string | null;
  esiid?: string | null;
  raw?: any;
}

export interface AgreementLookupResult {
  raw: any;
  agreements: SmtAgreementSummary[];
  match: SmtAgreementSummary | null;
}

export interface SmtBackfillRange {
  start: Date;
  end: Date;
}

type RefreshSmtAuthorizationStatusOpts = {
  /**
   * Bypass the `smtLastSyncAt` cooldown and hit SMT proxy immediately.
   * Use sparingly (admin queue cleanup, manual refresh buttons).
   */
  force?: boolean;
  /**
   * If SMT reports ACTIVE but we have no interval usage yet, kick off the
   * interval pull workflow immediately (best-effort).
   *
   * Defaults to true.
   */
  triggerUsagePullIfActive?: boolean;
};

function resolveInternalBaseUrl(): URL {
  const explicit =
    process.env.ADMIN_INTERNAL_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.PROD_BASE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    "";

  if (explicit) {
    try {
      return new URL(explicit.startsWith("http") ? explicit : `https://${explicit}`);
    } catch {
      // fall through
    }
  }
  return new URL("https://intelliwatt.com");
}

function isActiveishStatus(value: unknown): boolean {
  const s = String(value ?? "").trim().toUpperCase();
  if (!s) return false;
  // Be liberal in what we accept: older rows may have stored SMT codes like "ACT".
  if (s === "ACTIVE" || s === "ALREADY_ACTIVE" || s === "ACT") return true;
  if (s.includes("ACTIVE")) return true;
  return false;
}

async function maybeTriggerUsagePullIfMissing(args: {
  authorizationId: string;
  userId: string;
  esiid: string;
  meterNumber: string | null | undefined;
  lastAttemptAt: Date | null | undefined;
  trigger: boolean;
}): Promise<void> {
  if (!args.trigger) return;

  const esiid = normalizeEsiid(args.esiid);
  if (!esiid) return;

  // If we already have interval usage, do nothing.
  try {
    const anyInterval = await prisma.smtInterval.findFirst({
      where: { esiid },
      select: { id: true },
    });
    if (anyInterval) return;
  } catch {
    // If the usage table doesn't exist yet or query fails, don't block.
  }

  // Throttle retries (we don't want every page load to spam the proxy/pull).
  const last = args.lastAttemptAt ?? null;
  const retryAfterMs = 30 * 60 * 1000; // 30 minutes
  if (last && Date.now() - last.getTime() < retryAfterMs) {
    return;
  }

  // 1) Best-effort request an SMT interval backfill (only if the proxy supports it).
  try {
    const enableBackfill =
      process.env.SMT_INTERVAL_BACKFILL_ENABLED === "true" ||
      process.env.SMT_INTERVAL_BACKFILL_ENABLED === "1";
    if (enableBackfill) {
      const range = getRollingBackfillRange(12);
      await requestSmtBackfillForAuthorization({
        authorizationId: args.authorizationId,
        esiid,
        meterNumber: args.meterNumber ?? null,
        startDate: range.startDate,
        endDate: range.endDate,
      }).catch(() => null);
    }
  } catch {
    // ignore
  }

  // 2) Trigger the droplet pull (so anything delivered gets ingested quickly).
  try {
    const adminToken = (process.env.ADMIN_TOKEN ?? "").trim();
    if (adminToken) {
      const baseUrl = resolveInternalBaseUrl();
      const pullUrl = new URL("/api/admin/smt/pull", baseUrl);
      await fetch(pullUrl, {
        method: "POST",
        headers: {
          "x-admin-token": adminToken,
          "content-type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          esiid,
          reason: "auto_after_active_agreement",
        }),
      }).catch(() => null);
    }
  } catch {
    // ignore
  }

  // Record an attempt timestamp so we can throttle subsequent triggers.
  prisma.smtAuthorization
    .update({
      where: { id: args.authorizationId },
      data: { smtBackfillRequestedAt: new Date() },
    })
    .catch(() => null);
}

async function cleanupDuplicateAuthorizationsForActive(args: {
  keepAuthorizationId: string;
  userId: string;
  houseAddressId: string | null | undefined;
  fallbackRetailEmail: string | null | undefined;
}): Promise<void> {
  const houseId = String(args.houseAddressId ?? "").trim();
  if (!houseId) return;

  const duplicates = await prisma.smtAuthorization.findMany({
    where: {
      userId: args.userId,
      archivedAt: null,
      id: { not: args.keepAuthorizationId },
      OR: [{ houseAddressId: houseId }, { houseId }],
    },
    select: {
      id: true,
      smtAgreementId: true,
      contactEmail: true,
    },
    take: 100,
  });

  for (const duplicate of duplicates) {
    const agreementRaw = String(duplicate.smtAgreementId ?? "").trim();
    const agreementNumber = Number.parseInt(agreementRaw, 10);
    const retailEmail =
      String(duplicate.contactEmail ?? "").trim() ||
      String(args.fallbackRetailEmail ?? "").trim();

    // If we have a known agreement ID, terminate that duplicate agreement first.
    if (Number.isFinite(agreementNumber) && agreementNumber > 0 && retailEmail) {
      try {
        await terminateSmtAgreement(agreementNumber, retailEmail);
      } catch (error) {
        console.warn(
          "[SMT] Failed to terminate duplicate agreement during active reconciliation",
          { duplicateAuthorizationId: duplicate.id, agreementNumber, message: (error as any)?.message ?? String(error) },
        );
        // Keep it unarchived so the next refresh can retry termination.
        continue;
      }
    }

    await prisma.smtAuthorization
      .update({
        where: { id: duplicate.id },
        data: {
          archivedAt: new Date(),
          smtStatus: "archived",
          smtStatusMessage: "Superseded by active SMT authorization",
          revokedReason: "replaced_by_active_authorization",
        },
      })
      .catch(() => null);
  }
}

/**
 * Refresh SMT agreement status for a given SmtAuthorization by calling
 * the SMT droplet and normalizing the result into local status fields.
 *
 * This does NOT throw on SMT errors; it records an "ERROR" status on the
 * SmtAuthorization row instead.
 */
export async function refreshSmtAuthorizationStatus(
  authId: string,
  opts: RefreshSmtAuthorizationStatusOpts = {},
) {
  const force = opts.force === true;
  const triggerUsagePullIfActive = opts.triggerUsagePullIfActive !== false;

  const auth = await prisma.smtAuthorization.findUnique({
    where: { id: authId },
    select: {
      id: true,
      userId: true,
      smtAgreementId: true,
      esiid: true,
      houseAddressId: true,
      meterNumber: true,
      contactEmail: true,
      smtStatus: true,
      smtStatusMessage: true,
      smtLastSyncAt: true,
      smtBackfillRequestedAt: true,
      emailConfirmationStatus: true,
      emailConfirmationAt: true,
    },
  });

  if (!auth) {
    return { ok: false as const, reason: "no-auth" as const };
  }

  // Cooldown: return cached status instead of calling SMT proxy.
  // This prevents repeated browser refreshes / polling from spamming `myagreements`.
  if (
    !force &&
    SMT_STATUS_REFRESH_COOLDOWN_MS > 0 &&
    auth.smtLastSyncAt &&
    Date.now() - auth.smtLastSyncAt.getTime() < SMT_STATUS_REFRESH_COOLDOWN_MS
  ) {
    // IMPORTANT:
    // Even when throttled, we should still normalize local flags based on *existing* cached status.
    // Otherwise the system can get stuck showing "pending SMT email" even though the row already
    // shows ACTIVE (because we refuse to hit SMT again during cooldown).
    const cachedLocal = String(auth.smtStatus ?? "").trim().toUpperCase();
    const cachedIsActive = isActiveishStatus(cachedLocal);
    const cachedEmail =
      String((auth as any)?.emailConfirmationStatus ?? "").trim().toUpperCase();
    const cachedNeedsApprove = cachedIsActive && cachedEmail !== "APPROVED";

    if (cachedNeedsApprove) {
      try {
        await prisma.smtAuthorization.update({
          where: { id: auth.id },
          data: {
            emailConfirmationStatus: "APPROVED",
            emailConfirmationAt: auth.emailConfirmationAt ?? new Date(),
          },
        });

        // Clear attention flags opportunistically (do not block status refresh).
        prisma.userProfile
          .updateMany({
            where: { userId: auth.userId },
            data: {
              esiidAttentionRequired: false,
              esiidAttentionCode: null,
              esiidAttentionAt: null,
            },
          })
          .catch(() => null);
      } catch {
        // swallow; cooldown path must remain fast/robust
      }
    }

    // If SMT is already known ACTIVE, but usage hasn't arrived yet, kick off pull/backfill.
    if (cachedIsActive) {
      await maybeTriggerUsagePullIfMissing({
        authorizationId: auth.id,
        userId: auth.userId,
        esiid: auth.esiid,
        meterNumber: auth.meterNumber,
        lastAttemptAt: auth.smtBackfillRequestedAt,
        trigger: triggerUsagePullIfActive,
      });
    }

    return {
      ok: true as const,
      status: String(auth.smtStatus ?? "").trim(),
      throttled: true as const,
      cooldownMs: SMT_STATUS_REFRESH_COOLDOWN_MS,
      authorization: {
        id: auth.id,
        esiid: auth.esiid,
        meterNumber: auth.meterNumber,
        houseAddressId: auth.houseAddressId,
        smtStatus: auth.smtStatus,
        smtStatusMessage: auth.smtStatusMessage,
      },
    };
  }

  let esiid: string | undefined = auth.esiid ?? undefined;
  const houseId = auth.houseAddressId;
  if (
    !esiid &&
    typeof houseId === "string" &&
    houseId.trim().length > 0
  ) {
    const resolvedHouseId = houseId;
    const house = await prisma.houseAddress.findUnique({
      where: { id: resolvedHouseId },
      select: { esiid: true },
    });
    esiid = house?.esiid ?? undefined;
  }

  if (!esiid) {
    const message = "No ESIID associated with this authorization.";
    await prisma.smtAuthorization.update({
      where: { id: auth.id },
      data: {
        smtStatus: "ERROR",
        smtStatusMessage: message,
      },
    });
    return { ok: false as const, reason: "no-esiid" as const };
  }

  const targetEsiid = esiid;

  let lookup: AgreementLookupResult;
  try {
    lookup = await findAgreementForEsiid(targetEsiid, {
      agreementNumber: auth.smtAgreementId ?? undefined,
      retailCustomerEmail: auth.contactEmail ?? undefined,
    });
  } catch (error) {
    console.error(
      "[SMT] refreshSmtAuthorizationStatus: SMT proxy request failed",
      error,
    );

    const message =
      "Unable to contact SMT proxy for agreement status refresh";

    return {
      ok: false as const,
      reason: "network-error" as const,
      message,
    };
  }

  const match = lookup.match;
  if (!match) {
    const message = "No SMT agreements returned for this ESIID.";
    await prisma.smtAuthorization.update({
      where: { id: auth.id },
      data: {
        smtStatus: "ERROR",
        smtStatusMessage: message,
      },
    });

    return {
      ok: false as const,
      reason: "no-agreement" as const,
      raw: lookup.raw,
      agreements: lookup.agreements,
    };
  }

  const { localStatus, displayStatus: rawStatus } = resolveAgreementStatus(
    match.status ?? null,
    match.statusReason ?? null,
  );

  const updateData: Record<string, unknown> = {
    smtStatus: localStatus,
    smtStatusMessage: rawStatus,
    smtLastSyncAt: new Date(),
  };

  // If SMT reports an ACTIVE agreement, we should not keep showing "pending email approval"
  // inside IntelliWatt. Auto-mark as approved once we have proof from SMT.
  const shouldAutoApproveEmail =
    localStatus === "ACTIVE" &&
    String((auth as any)?.emailConfirmationStatus ?? "").toUpperCase() !== "APPROVED";
  if (shouldAutoApproveEmail) {
    updateData.emailConfirmationStatus = "APPROVED";
    updateData.emailConfirmationAt = new Date();
  }

  if (match.agreementNumber && match.agreementNumber > 0) {
    updateData.smtAgreementId = String(match.agreementNumber);
  }

  const updated = await prisma.smtAuthorization.update({
    where: { id: auth.id },
    data: updateData,
    select: {
      id: true,
      esiid: true,
      meterNumber: true,
      houseAddressId: true,
      smtStatus: true,
      smtStatusMessage: true,
      emailConfirmationStatus: true,
      emailConfirmationAt: true,
      smtBackfillRequestedAt: true,
    },
  });

  // Clear SMT-email attention flags once ACTIVE is observed (even if the approval flag is already set).
  if (localStatus === "ACTIVE") {
    prisma.userProfile
      .updateMany({
        where: { userId: auth.userId },
        data: {
          esiidAttentionRequired: false,
          esiidAttentionCode: null,
          esiidAttentionAt: null,
        },
      })
      .catch(() => null);
  }

  await syncHouseIdentifiersFromAuthorization({
    houseAddressId: updated.houseAddressId,
    esiid: updated.esiid ?? auth.esiid,
    meterNumber: updated.meterNumber ?? auth.meterNumber ?? null,
  });

  // If SMT is ACTIVE but usage hasn't arrived yet, kick off pull/backfill.
  if (localStatus === "ACTIVE") {
    await maybeTriggerUsagePullIfMissing({
      authorizationId: updated.id,
      userId: auth.userId,
      esiid: updated.esiid ?? auth.esiid,
      meterNumber: updated.meterNumber ?? auth.meterNumber,
      lastAttemptAt: updated.smtBackfillRequestedAt ?? auth.smtBackfillRequestedAt,
      trigger: triggerUsagePullIfActive,
    });

    // Keep a single live authorization per user/home once SMT confirms ACTIVE.
    await cleanupDuplicateAuthorizationsForActive({
      keepAuthorizationId: updated.id,
      userId: auth.userId,
      houseAddressId: updated.houseAddressId,
      fallbackRetailEmail: auth.contactEmail,
    });
  }

  return {
    ok: true as const,
    status: localStatus,
    authorization: updated,
    raw: lookup.raw,
    agreements: lookup.agreements,
  };
}

export interface SmtMyAgreementsFilter {
  agreementNumber?: number | string;
  statusReason?: string | null;
}

export async function getSmtMyAgreements(
  filter: SmtMyAgreementsFilter = {},
) {
  const payload: Record<string, unknown> = {};

  if (
    filter.agreementNumber !== undefined &&
    filter.agreementNumber !== null
  ) {
    const raw = filter.agreementNumber;
    const numeric =
      typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isNaN(numeric)) {
      payload.agreementNumber = numeric;
    }
  }

  if (filter.statusReason && typeof filter.statusReason === "string") {
    payload.statusReason = filter.statusReason;
  }

  return postToSmtProxy("/smt/agreements/myagreements", payload);
}

// SMT agreement/subscription identity wiring.
// These must match what’s configured in the SMT portal.
const SMT_USERNAME = (
  process.env.SMT_USERNAME ||
  process.env.SMT_SERVICE_ID ||
  process.env.SMT_REQUESTOR_ID ||
  "INTELLIPATH"
).trim();

const SMT_SERVICE_ID = (
  process.env.SMT_SERVICE_ID ||
  SMT_USERNAME ||
  "INTELLIPATH"
).trim();

const SMT_REQUESTOR_ID = (
  process.env.SMT_REQUESTOR_ID ||
  SMT_SERVICE_ID ||
  "INTELLIPATH"
).trim();

const SMT_REQUESTOR_AUTH_ID = (
  process.env.SMT_REQUESTOR_AUTH_ID ||
  "134642921"
).trim();

// Default language preference for SMT notifications.
const SMT_LANG_DEFAULT =
  (process.env.SMT_LANG_DEFAULT || "ENGLISH").trim() || "ENGLISH";

function buildTransId(): string {
  return randomBytes(16).toString("hex");
}

function normalizeEsiid(esiid: string): string {
  const digits = (esiid || "").replace(/\D/g, "");
  if (!digits) {
    return esiid;
  }
  const trimmed = digits.slice(-17);
  return trimmed.padStart(17, "0");
}

const AGREEMENT_NUMBER_KEYS = [
  "agreementNumber",
  "AgreementNumber",
  "agreementId",
  "AgreementId",
  "agreementID",
  "AgreementID",
  "agreement_id",
];

const AGREEMENT_STATUS_KEYS = ["status", "Status"];
const AGREEMENT_STATUS_REASON_KEYS = [
  "statusReason",
  "StatusReason",
  "agreementStatus",
  "AgreementStatus",
];
const AGREEMENT_ESIID_KEYS = ["esiid", "ESIID", "esiId", "ESI_ID", "esi_id", "Esiid"];

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length === 0 ? null : str;
}

function pickFirstKey<T>(
  record: Record<string, unknown>,
  keys: readonly string[],
  transform: (value: unknown) => T,
): T | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const result = transform(record[key]);
      if (result !== undefined && result !== null) {
        return result as T;
      }
    }
  }
  return undefined;
}

function extractAgreementSummaries(raw: any): SmtAgreementSummary[] {
  const summaries: SmtAgreementSummary[] = [];
  const stack: any[] = [];
  const seen = new Set<any>();

  if (raw !== undefined) {
    stack.push(raw);
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    const agreementNumber = pickFirstKey(record, AGREEMENT_NUMBER_KEYS, toOptionalNumber);
    const status = pickFirstKey(record, AGREEMENT_STATUS_KEYS, toOptionalString) ?? undefined;
    const statusReason =
      pickFirstKey(record, AGREEMENT_STATUS_REASON_KEYS, toOptionalString) ?? undefined;
    const esiid = pickFirstKey(record, AGREEMENT_ESIID_KEYS, toOptionalString) ?? undefined;

    if (
      agreementNumber !== undefined ||
      status !== undefined ||
      statusReason !== undefined ||
      esiid !== undefined
    ) {
      summaries.push({
        agreementNumber: agreementNumber ?? null,
        status: status ?? null,
        statusReason: statusReason ?? null,
        esiid: esiid ?? null,
        raw: record,
      });
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return summaries;
}

export async function findAgreementForEsiid(
  esiid: string,
  opts: { agreementNumber?: number | string | null; retailCustomerEmail?: string | null; statusReason?: string | null } = {},
): Promise<AgreementLookupResult> {
  const sanitized = normalizeEsiid(esiid);
  if (!sanitized || sanitized.trim().length === 0) {
    throw new Error("findAgreementForEsiid: esiid is required");
  }

  const response = await getSmtAgreementStatus(sanitized, opts);
  let rawResponse = response;
  let agreements = extractAgreementSummaries(response);
  const normalizedTarget = normalizeEsiid(sanitized);
  const requestedAgreementNumber =
    opts?.agreementNumber !== undefined && opts?.agreementNumber !== null
      ? Number.parseInt(String(opts.agreementNumber).trim(), 10)
      : Number.NaN;

  const pickMatch = (list: SmtAgreementSummary[]): SmtAgreementSummary | null => {
    const sameEsiid = list.filter((agreement) => {
      if (!agreement.esiid) return false;
      try {
        return normalizeEsiid(agreement.esiid) === normalizedTarget;
      } catch {
        return false;
      }
    });

    // When multiple SMT agreements exist for the same ESIID, prefer ACTIVE so we don't
    // get stuck on a newer pending duplicate while an older approved authorization exists.
    const activeForEsiid =
      sameEsiid.find((agreement) => {
        const resolved = resolveAgreementStatus(
          agreement.status ?? null,
          agreement.statusReason ?? null,
        );
        return resolved.localStatus === "ACTIVE";
      }) ?? null;

    const requestedForEsiid =
      Number.isFinite(requestedAgreementNumber)
        ? sameEsiid.find((agreement) => Number(agreement.agreementNumber) === requestedAgreementNumber) ?? null
        : null;

    return (
      activeForEsiid ??
      requestedForEsiid ??
      sameEsiid[0] ??
      list.find((agreement) => agreement.agreementNumber !== null) ??
      null
    );
  };

  let matched = pickMatch(agreements);

  // If we queried with a pinned agreement number and got a non-active result, re-query without
  // agreementNumber so we can detect another ACTIVE agreement for this ESIID.
  if (Number.isFinite(requestedAgreementNumber)) {
    const matchedStatus = resolveAgreementStatus(
      matched?.status ?? null,
      matched?.statusReason ?? null,
    ).localStatus;
    if (matchedStatus !== "ACTIVE") {
      const broadResponse = await getSmtAgreementStatus(sanitized, {
        retailCustomerEmail: opts?.retailCustomerEmail ?? null,
        statusReason: opts?.statusReason ?? null,
      });
      const broadAgreements = extractAgreementSummaries(broadResponse);
      if (broadAgreements.length > 0) {
        rawResponse = broadResponse;
        agreements = broadAgreements;
        matched = pickMatch(agreements);
      }
    }
  }

  return {
    raw: rawResponse,
    agreements,
    match: matched ?? null,
  };
}

interface SmtIdentity {
  requestorID: string;
  requesterAuthenticationID: string;
  serviceID: string;
  username: string;
  language: string;
}

function buildSmtIdentity(
  overrides?: Partial<SmtIdentity>,
): SmtIdentity {
  return {
    requestorID: SMT_REQUESTOR_ID,
    requesterAuthenticationID: SMT_REQUESTOR_AUTH_ID,
    serviceID: SMT_SERVICE_ID,
    username: SMT_USERNAME,
    language: SMT_LANG_DEFAULT,
    ...overrides,
  };
}

function parseRepPuctNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const digits = String(value).replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function getBackfillRangeForAuth(now: Date = new Date()): SmtBackfillRange {
  const end = new Date(now);
  const start = new Date(end);
  start.setMonth(start.getMonth() - 12);
  return { start, end };
}

if (!SMT_USERNAME) {
  throw new Error("SMT_USERNAME is required for SMT agreements (SMT service ID).");
}
if (!SMT_REQUESTOR_AUTH_ID) {
  throw new Error("SMT_REQUESTOR_AUTH_ID (DUNS) is required for SMT agreements.");
}

const ALLOWED_AGREEMENT_DURATIONS: ReadonlyArray<
  1 | 3 | 6 | 9 | 12 | 24 | 36
> = [1, 3, 6, 9, 12, 24, 36] as const;

type NewAgreementPayload = {
  trans_id: string;
  requestorID: string;
  requesterAuthenticationID: string;
  retailCustomerEmail: string;
  agreementDuration: 1 | 3 | 6 | 9 | 12 | 24 | 36;
  customerLanguagePreference: string;
  customerMeterList: Array<{
    ESIID: string;
    meterNumber: string;
    PUCTRORNumber: number;
  }>;
  SMTTermsandConditions: "Y";
};

type ReportFormat = "LSE" | "CSV" | "JSON" | "XML";
type DataType = "DAILY" | "INTERVAL" | "MONTHLY";
type DeliveryMode = "FTP" | "EML" | "API";
type NewSubscriptionPayload = {
  trans_id: string;
  requestorID: string;
  requesterType: "CSP";
  requesterAuthenticationID: string;
  subscriptionType: "CSPENROLL" | "SCHEDULE" | "SCHEDULES" | "REPENROLL";
  historicalSubscriptionDuration: number;
  reportFormat: ReportFormat;
  dataType: DataType;
  deliveryMode: DeliveryMode;
  SMTTermsandConditions: "Y";
};

function resolveAgreementDuration(monthsBack: number): 1 | 3 | 6 | 9 | 12 | 24 | 36 {
  const normalized = Math.max(1, Math.round(monthsBack || 12));
  let chosen: 1 | 3 | 6 | 9 | 12 | 24 | 36 = 12;
  let smallestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of ALLOWED_AGREEMENT_DURATIONS) {
    const diff = Math.abs(candidate - normalized);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      chosen = candidate;
    }
  }
  return chosen;
}

function resolveSubscriptionDuration(monthsBack: number): 3 | 6 | 9 | 12 | 24 {
  const allowed: Array<3 | 6 | 9 | 12 | 24> = [3, 6, 9, 12, 24];
  const normalized = Math.max(3, Math.round(monthsBack || 12));
  let chosen: 3 | 6 | 9 | 12 | 24 = 12;
  let smallestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of allowed) {
    const diff = Math.abs(candidate - normalized);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      chosen = candidate;
    }
  }
  return chosen;
}

function mapTdspToPuctRorNumber(tdspCode?: string | null): number {
  switch ((tdspCode || "").toUpperCase()) {
    case "CENTERPOINT":
    case "CENTERPOINT_ENERGY":
    case "CENTERPOINT ENERGY":
      return 10007;
    case "ONCOR":
    case "ONCOR_ELECTRIC_DELIVERY":
      return 10004;
    case "AEP_CENTRAL":
    case "AEP_TEXAS_CENTRAL":
      return 10005;
    case "AEP_NORTH":
    case "AEP_TEXAS_NORTH":
      return 10002;
    case "TNMP":
      return 10006;
    default:
      return 0;
  }
}

function buildNewAgreementPayload(
  input: {
    esiid: string;
    meterNumber: string;
    puctRorNumber: number;
    customerEmail: string;
    agreementDurationMonths: number;
  },
): NewAgreementPayload {
  const esiid = normalizeEsiid(input.esiid);
  const identity = buildSmtIdentity();
  return {
    trans_id: buildTransId(),
    requestorID: identity.requestorID,
    requesterAuthenticationID: identity.requesterAuthenticationID,
    retailCustomerEmail: input.customerEmail,
    agreementDuration: resolveAgreementDuration(input.agreementDurationMonths),
    customerLanguagePreference: identity.language || "ENGLISH",
    customerMeterList: [
      {
        ESIID: esiid,
        meterNumber: input.meterNumber,
        PUCTRORNumber: input.puctRorNumber,
      },
    ],
    SMTTermsandConditions: "Y",
  };
}

export async function createAgreementAndSubscription(
  payload: SmtAgreementRequest,
): Promise<SmtAgreementResult> {
  if (!SMT_AGREEMENTS_ENABLED) {
    return {
      ok: false,
      status: "disabled",
      message: "SMT agreements disabled via SMT_AGREEMENTS_ENABLED env",
    };
  }

  if (!SMT_PROXY_AGREEMENTS_URL) {
    return {
      ok: false,
      status: "error",
      message: "SMT_PROXY_AGREEMENTS_URL/SMT_PROXY_URL not configured",
    };
  }

  try {
    const monthsBack =
      typeof payload.monthsBack === "number" && !Number.isNaN(payload.monthsBack)
        ? Math.max(1, Math.round(payload.monthsBack))
        : 12;
    const includeInterval =
      payload.includeInterval === undefined || payload.includeInterval === null
        ? true
        : Boolean(payload.includeInterval);
    const includeBilling =
      payload.includeBilling === undefined || payload.includeBilling === null
        ? true
        : Boolean(payload.includeBilling);
    const tdspCode = payload.tdspCode ?? null;

    const repSelectionNumber = parseRepPuctNumber(payload.repPuctNumber);
    const overrideRepNumber = parseRepPuctNumber(process.env.SMT_REP_PUCT_OVERRIDE);
    const tdspFallbackNumber = mapTdspToPuctRorNumber(tdspCode) || undefined;

    const repPuctNumberForProxy =
      repSelectionNumber ?? overrideRepNumber ?? tdspFallbackNumber;

    if (repPuctNumberForProxy === undefined) {
      throw new Error(
        "repPuctNumber is required for SMT agreements and no override or fallback is available.",
      );
    }

    const meterNumber = payload.meterNumber?.toString().trim();
    if (!meterNumber) {
      throw new Error("meterNumber is required for SMT agreements. Run meter info fetch first.");
    }
    const puctRorNumber = repSelectionNumber ?? repPuctNumberForProxy;
    const customerEmail = (payload.customerEmail || "").trim();

    const agreementBody = buildNewAgreementPayload({
      esiid: payload.esiid,
      meterNumber,
      puctRorNumber,
      customerEmail,
      agreementDurationMonths: monthsBack,
    });

    const steps = [
      {
        name: "NewAgreement",
        path: "/v2/NewAgreement/",
        username: SMT_USERNAME,
        serviceId: SMT_SERVICE_ID,
        body: agreementBody,
      },
    ];

    const proxyPayload = {
      action: "create_agreement_and_subscription",
      repPuctNumber: repPuctNumberForProxy,
      steps,
      agreement: {
        name: "NewAgreement",
        body: agreementBody,
      },
    };

    const res = await fetch(SMT_PROXY_AGREEMENTS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SMT_PROXY_TOKEN
          ? { Authorization: `Bearer ${SMT_PROXY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(proxyPayload),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        status: "error",
        message: `Proxy HTTP ${res.status}: ${text.slice(0, 500)}`,
      };
    }

    const json = (await res.json()) as any;

    const resultsArray = Array.isArray(json?.results) ? json.results : [];
    const agreementResult = resultsArray.find(
      (entry: any) => entry?.name === "NewAgreement",
    );
    return {
      ok: !!json?.ok,
      agreementId:
        agreementResult?.data?.agreementId ??
        agreementResult?.data?.AgreementID ??
        undefined,
      status: json?.status ?? (json?.ok ? "active" : "error"),
      message: json?.message ?? json?.error ?? undefined,
      backfillRequestedAt: json?.backfillRequestedAt ?? undefined,
      backfillCompletedAt: json?.backfillCompletedAt ?? undefined,
      subscriptionAlreadyActive: false,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: "error",
      message: `Proxy call failed: ${err?.message ?? String(err)}`.slice(
        0,
        500,
      ),
      subscriptionAlreadyActive: false,
    };
  }
}

// NOTE: Field names and enum values above are derived from the SMT
// Data Access Interface Guide v2. Adjust payloads as SMT validation errors
// are observed, without changing the function signature or proxy wiring.
