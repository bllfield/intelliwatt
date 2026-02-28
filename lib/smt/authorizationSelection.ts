type SmtAuthorizationLike = {
  id: string;
  smtStatus?: string | null;
  smtStatusMessage?: string | null;
  emailConfirmationStatus?: string | null;
  createdAt?: Date | string | null;
};

function statusTier(row: SmtAuthorizationLike): number {
  const status = String(row.smtStatus ?? "").trim().toUpperCase();
  const message = String(row.smtStatusMessage ?? "").trim().toUpperCase();
  if (
    status === "ACTIVE" ||
    status === "ALREADY_ACTIVE" ||
    status === "ACT" ||
    message.includes("ACTIVE")
  ) {
    return 4;
  }
  if (status === "PENDING" || status === "" || message.includes("PENDING")) {
    return 3;
  }
  if (status === "DECLINED" || message.includes("DECLINED") || message.includes("NOT ACCEPTED")) {
    return 2;
  }
  if (status === "EXPIRED" || status === "ERROR") {
    return 1;
  }
  return 0;
}

function createdAtMs(row: SmtAuthorizationLike): number {
  if (!row.createdAt) return 0;
  const d = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

export function pickBestSmtAuthorization<T extends SmtAuthorizationLike>(rows: T[]): T | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const tierDiff = statusTier(b) - statusTier(a);
    if (tierDiff !== 0) return tierDiff;
    const emailA = String(a.emailConfirmationStatus ?? "").trim().toUpperCase() === "APPROVED" ? 1 : 0;
    const emailB = String(b.emailConfirmationStatus ?? "").trim().toUpperCase() === "APPROVED" ? 1 : 0;
    if (emailB !== emailA) return emailB - emailA;
    return createdAtMs(b) - createdAtMs(a);
  });
  return sorted[0] ?? null;
}
