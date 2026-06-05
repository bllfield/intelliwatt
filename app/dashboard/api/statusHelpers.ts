import { UsageEntryContext } from "./context";
import { resolveGreenButtonConnectionExpiresAt } from "@/lib/usage/awardGreenButtonUsageEntry";
import {
  greenButtonUploadDateRangeFromChicagoDateKeys,
  resolveGreenButtonDisplayWindow,
} from "@/lib/usage/greenButtonCoverage";
import { CANONICAL_COVERAGE_TOTAL_DAYS } from "@/lib/usage/canonicalCoverageConfig";
import { parseGreenButtonUploadParseSummary } from "@/lib/usage/greenButtonIngestContract";
import {
  GREEN_BUTTON_UPLOAD_COMPLETE_MESSAGE,
  GREEN_BUTTON_UPLOAD_PROCESSING_MESSAGE,
} from "@/lib/usage/greenButtonUserMessages";
import {
  isGreenButtonUploadParseError,
  isGreenButtonUsageIngestionProcessing,
  isGreenButtonUsageIngestionReady,
} from "@/lib/usage/greenButtonUploadStatus";

export {
  GREEN_BUTTON_UPLOAD_COMPLETE_MESSAGE,
  GREEN_BUTTON_UPLOAD_PROCESSING_MESSAGE,
} from "@/lib/usage/greenButtonUserMessages";

export type StatusTone = "success" | "warning" | "error" | "info";

export type EntryStatus = {
  label: string;
  tone: StatusTone;
  message?: string | null;
  detail?: string | null;
  lastUpdated?: Date | null;
  expiresAt?: Date | null;
};

export const statusBadgeStyles: Record<StatusTone, string> = {
  success:
    "inline-flex items-center rounded-full bg-lime-300/20 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-lime-100 shadow-[0_0_12px_rgba(190,242,100,0.55)]",
  warning:
    "inline-flex items-center rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-200",
  error:
    "inline-flex items-center rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-rose-200",
  info:
    "inline-flex items-center rounded-full bg-brand-cyan/15 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-brand-cyan",
};

export function deriveSmtStatus(
  auth: UsageEntryContext["existingAuthorization"],
  smtLatestIntervalAt?: Date | null,
): EntryStatus {
  if (!auth) {
    return {
      label: "Not connected",
      tone: "info",
      message: "Link Smart Meter Texas for automatic daily usage updates.",
    };
  }

  const rawStatus = (auth.smtStatus ?? "").toLowerCase();
  const alreadyActive =
    rawStatus === "already_active" ||
    (auth.smtStatusMessage ?? "").toLowerCase().includes("already active");

  const lastUpdated =
    smtLatestIntervalAt ??
    auth.smtLastSyncAt ??
    auth.updatedAt ??
    auth.createdAt;

  if (alreadyActive || rawStatus === "active") {
    return {
      label: alreadyActive ? "Already active" : "Connected",
      tone: "success",
      message:
        auth.smtStatusMessage && auth.smtStatusMessage.trim().length > 0
          ? auth.smtStatusMessage
          : "SMT usage will refresh automatically.",
      lastUpdated,
      expiresAt: auth.authorizationEndDate ?? null,
    };
  }

  if (rawStatus === "pending") {
    const hasRecentUsage =
      smtLatestIntervalAt &&
      Date.now() - smtLatestIntervalAt.getTime() < 7 * 24 * 60 * 60 * 1000;
    if (hasRecentUsage) {
      return {
        label: "Connected",
        tone: "success",
        message:
          auth.smtStatusMessage && auth.smtStatusMessage.trim().length > 0
            ? auth.smtStatusMessage
            : "SMT usage will refresh automatically.",
        lastUpdated: smtLatestIntervalAt ?? lastUpdated,
        expiresAt: auth.authorizationEndDate ?? null,
      };
    }
    return {
      label: "Awaiting confirmation",
      tone: "warning",
      message:
        auth.smtStatusMessage && auth.smtStatusMessage.trim().length > 0
          ? auth.smtStatusMessage
          : "We're finalizing your SMT agreement. This usually resolves within a minute.",
      lastUpdated,
    };
  }

  if (rawStatus === "error") {
    return {
      label: "Needs attention",
      tone: "error",
      message:
        auth.smtStatusMessage && auth.smtStatusMessage.trim().length > 0
          ? auth.smtStatusMessage
          : "We couldn't complete your SMT authorization. Try again or contact support.",
      lastUpdated,
    };
  }

  return {
    label: auth.smtStatus ? auth.smtStatus : "Status unknown",
    tone: "info",
    message: auth.smtStatusMessage,
    lastUpdated,
  };
}

function formatGreenButtonCoverageDetail(
  upload: NonNullable<UsageEntryContext["greenButtonUpload"]>,
  expiresAt: Date,
): string | null {
  if (!upload.dateRangeStart || !upload.dateRangeEnd) return null;

  const summary = parseGreenButtonUploadParseSummary(upload.parseMessage);
  const displayStartKey = summary?.displayWindowStartDateKey ?? null;
  const displayEndKey = summary?.displayWindowEndDateKey ?? null;
  const displayRange =
    displayStartKey && displayEndKey
      ? greenButtonUploadDateRangeFromChicagoDateKeys({
          startDateKey: displayStartKey,
          endDateKey: displayEndKey,
        })
      : null;
  const coverageStart = displayRange?.dateRangeStart ?? upload.dateRangeStart;
  const coverageEnd = displayRange?.dateRangeEnd ?? upload.dateRangeEnd;

  const dataStartKey = summary?.dataAvailableStartDateKey ?? summary?.coverageStartDateKey ?? null;
  const dataEndKey = summary?.dataAvailableEndDateKey ?? summary?.coverageEndDateKey ?? null;
  const dataRange =
    dataStartKey && dataEndKey
      ? greenButtonUploadDateRangeFromChicagoDateKeys({
          startDateKey: dataStartKey,
          endDateKey: dataEndKey,
        })
      : null;
  const meterDiffers =
    dataRange &&
    (dataStartKey !== displayStartKey ||
      dataEndKey !== displayEndKey ||
      dataRange.dateRangeStart.getTime() !== coverageStart.getTime() ||
      dataRange.dateRangeEnd.getTime() !== coverageEnd.getTime());

  const coverageLine = `Coverage: ${coverageStart.toLocaleDateString()} – ${coverageEnd.toLocaleDateString()}`;
  const meterLine = meterDiffers
    ? ` · Meter data: ${dataRange.dateRangeStart.toLocaleDateString()} – ${dataRange.dateRangeEnd.toLocaleDateString()}`
    : "";
  return `${coverageLine}${meterLine} · Expires ${expiresAt.toLocaleDateString()}`;
}

export function deriveGreenButtonStatus(
  upload: UsageEntryContext["greenButtonUpload"],
): EntryStatus {
  if (!upload) {
    return {
      label: "No uploads yet",
      tone: "info",
      message: "Upload a Green Button XML/CSV file if your utility supports it.",
    };
  }

  const expiresAt = resolveGreenButtonConnectionExpiresAt(upload.createdAt);
  const expired = expiresAt.getTime() < Date.now();

  if (isGreenButtonUploadParseError(upload.parseStatus)) {
    return {
      label: "ERROR",
      tone: "error",
      message:
        upload.parseMessage && upload.parseMessage.trim().length > 0
          ? upload.parseMessage
          : "We couldn't parse this upload. Please re-export the file and try again.",
      lastUpdated: upload.updatedAt ?? upload.createdAt,
      expiresAt,
    };
  }

  if (expired) {
    return {
      label: "Expired",
      tone: "warning",
      message: "Your Green Button connection expired. Upload a fresh file to restore usage.",
      lastUpdated: upload.updatedAt ?? upload.createdAt,
      expiresAt,
    };
  }

  const persistedIntervalCount = Math.max(0, Number(upload.persistedIntervalCount ?? 0) || 0);

  if (isGreenButtonUsageIngestionProcessing(upload, persistedIntervalCount)) {
    return {
      label: "Processing",
      tone: "warning",
      message: GREEN_BUTTON_UPLOAD_PROCESSING_MESSAGE,
      lastUpdated: upload.updatedAt ?? upload.createdAt,
      expiresAt,
    };
  }

  const ready = isGreenButtonUsageIngestionReady(upload, persistedIntervalCount);
  const coverageDetail = formatGreenButtonCoverageDetail(upload, expiresAt);

  return {
    label: ready ? "ACTIVE" : "Upload received",
    tone: ready ? "success" : "warning",
    message: ready
      ? GREEN_BUTTON_UPLOAD_COMPLETE_MESSAGE
      : GREEN_BUTTON_UPLOAD_PROCESSING_MESSAGE,
    lastUpdated: upload.updatedAt ?? upload.createdAt,
    expiresAt,
    detail: coverageDetail ?? `Connection active until ${expiresAt.toLocaleDateString()}`,
  };
}

export function deriveManualStatus(
  manual: UsageEntryContext["manualUsageUpload"],
): EntryStatus {
  if (!manual) {
    return {
      label: "Not Active",
      tone: "info",
      message:
        "Log a manual reading for a jackpot entry if SMT or Green Button access isn't available. It's less accurate and a bit more work, so prefer SMT or Green Button when possible.",
    };
  }

  return {
    label: "Not Active",
    tone: "info",
    lastUpdated: manual.uploadedAt,
    detail: `Expires ${manual.expiresAt.toLocaleDateString()}`,
  };
}
