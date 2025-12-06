import { UsageEntryContext } from "./context";

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
    "inline-flex items-center rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-200",
  warning:
    "inline-flex items-center rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-200",
  error:
    "inline-flex items-center rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-rose-200",
  info:
    "inline-flex items-center rounded-full bg-brand-cyan/15 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-brand-cyan",
};

export function deriveSmtStatus(
  auth: UsageEntryContext["existingAuthorization"],
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

  if (alreadyActive || rawStatus === "active") {
    return {
      label: alreadyActive ? "Already active" : "Connected",
      tone: "success",
      message:
        auth.smtStatusMessage && auth.smtStatusMessage.trim().length > 0
          ? auth.smtStatusMessage
          : "SMT usage will refresh automatically.",
      lastUpdated: auth.createdAt,
      expiresAt: auth.authorizationEndDate ?? null,
    };
  }

  if (rawStatus === "pending") {
    return {
      label: "Awaiting confirmation",
      tone: "warning",
      message:
        auth.smtStatusMessage && auth.smtStatusMessage.trim().length > 0
          ? auth.smtStatusMessage
          : "We’re finalizing your SMT agreement. This usually resolves within a minute.",
      lastUpdated: auth.createdAt,
    };
  }

  if (rawStatus === "error") {
    return {
      label: "Needs attention",
      tone: "error",
      message:
        auth.smtStatusMessage && auth.smtStatusMessage.trim().length > 0
          ? auth.smtStatusMessage
          : "We couldn’t complete your SMT authorization. Try again or contact support.",
      lastUpdated: auth.createdAt,
    };
  }

  return {
    label: auth.smtStatus ? auth.smtStatus : "Status unknown",
    tone: "info",
    message: auth.smtStatusMessage,
    lastUpdated: auth.createdAt,
  };
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

  const rawStatus = upload.parseStatus?.toLowerCase() ?? "";
  const isError = rawStatus.includes("error") || rawStatus === "failed";
  if (isError) {
    return {
      label: "ERROR",
      tone: "error",
      message:
        upload.parseMessage && upload.parseMessage.trim().length > 0
          ? upload.parseMessage
          : "We couldn’t parse this upload. Please re-export the file and try again.",
      lastUpdated: upload.updatedAt ?? upload.createdAt,
    };
  }

  const normalizedMessage =
    upload.parseStatus &&
    upload.parseStatus.toLowerCase() !== "success" &&
    upload.parseStatus.toLowerCase() !== "complete"
      ? upload.parseMessage
      : null;

  const hasCoverage = Boolean(upload.dateRangeStart && upload.dateRangeEnd);
  const isParseSuccess =
    upload.parseStatus &&
    ["success", "complete", "complete_with_warnings"].includes(upload.parseStatus.toLowerCase());

  // If coverage exists (we already normalized data), surface as active even if parseStatus wasn't updated.
  const label = hasCoverage || isParseSuccess
    ? "ACTIVE"
    : upload.parseStatus
      ? upload.parseStatus.replace(/_/g, " ").toUpperCase()
      : "Upload received";

  const tone: StatusTone = hasCoverage || isParseSuccess
    ? "success"
    : "warning";

  return {
    label,
    tone,
    message:
      normalizedMessage ??
      (hasCoverage
        ? "Usage file processed and active. We’ll keep your dashboard in sync with the latest upload."
        : "Usage file received. Processing shortly."),
    lastUpdated: upload.updatedAt ?? upload.createdAt,
    detail:
      hasCoverage
        ? `Coverage: ${upload.dateRangeStart!.toLocaleDateString()} – ${upload.dateRangeEnd!.toLocaleDateString()}`
        : undefined,
  };
}

export function deriveManualStatus(
  manual: UsageEntryContext["manualUsageUpload"],
): EntryStatus {
  if (!manual) {
    return {
      label: "Not recorded",
      tone: "info",
      message:
        "Log a manual placeholder if SMT access isn’t ready so your rewards stay active.",
    };
  }

  return {
    label: "Placeholder active",
    tone: "success",
    message:
      "We’ll keep your entries active with this manual reading until live data arrives.",
    lastUpdated: manual.uploadedAt,
    detail: `Expires ${manual.expiresAt.toLocaleDateString()}`,
  };
}

