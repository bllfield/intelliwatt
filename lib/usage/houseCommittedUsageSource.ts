import { prisma } from "@/lib/db";
import { pickBestSmtAuthorization } from "@/lib/smt/authorizationSelection";
import { readHouseCommittedUsageSource } from "@/lib/usage/commitHouseUsageSource";
import { resolveGreenButtonConnectionExpiresAt } from "@/lib/usage/awardGreenButtonUsageEntry";
import { isGreenButtonUploadParseError } from "@/lib/usage/greenButtonUploadStatus";
import { getLatestUsableRawGreenButtonIdForHouse } from "@/modules/realUsageAdapter/greenButton";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";

function normStatus(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

/** SMT pull/heal only when the stored authorization is still eligible. */
export function isActiveSmtAuthorizationRow(
  auth: {
    smtStatus?: string | null;
    authorizationEndDate?: Date | null;
  } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!auth) return false;
  const end = auth.authorizationEndDate;
  if (end && now.getTime() > end.getTime()) return false;
  const status = normStatus(auth.smtStatus);
  return status === "ACTIVE" || status === "ALREADY_ACTIVE" || status === "ACT";
}

export async function houseHasUsableGreenButton(houseId: string): Promise<boolean> {
  const id = String(houseId ?? "").trim();
  if (!id) return false;
  const rawId = await getLatestUsableRawGreenButtonIdForHouse(id).catch(() => null);
  return Boolean(rawId);
}

/** One-time legacy inference for homes that predate `HouseAddress.committedUsageSource`. */
async function inferLegacyCommittedUsageSource(args: {
  houseId: string;
  userId?: string | null;
}): Promise<ActualUsageSource | null> {
  const houseId = String(args.houseId ?? "").trim();
  if (!houseId) return null;

  const upload = await prisma.greenButtonUpload
    .findFirst({
      where: { houseId },
      orderBy: { createdAt: "desc" },
      select: { parseStatus: true, createdAt: true },
    })
    .catch(() => null);

  const gbUploadActive =
    upload &&
    !isGreenButtonUploadParseError(upload.parseStatus) &&
    resolveGreenButtonConnectionExpiresAt(upload.createdAt).getTime() >= Date.now() &&
    (await houseHasUsableGreenButton(houseId));

  if (gbUploadActive) return "GREEN_BUTTON";

  const authWhere: Record<string, unknown> = {
    archivedAt: null,
    OR: [{ houseAddressId: houseId }, { houseId }],
  };
  if (args.userId) authWhere.userId = args.userId;

  const authorizationCandidates = await prisma.smtAuthorization
    .findMany({
      where: authWhere as any,
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { smtStatus: true, authorizationEndDate: true },
    })
    .catch(() => []);
  const authorization = pickBestSmtAuthorization(authorizationCandidates as any[]);
  if (isActiveSmtAuthorizationRow(authorization as any)) return "SMT";

  return null;
}

/**
 * User-site homes use one explicit committed source stored on `HouseAddress`.
 * Connecting/uploading a mode writes that choice and clears the other source's data.
 */
export async function resolveHouseCommittedUsageSource(args: {
  houseId: string;
  userId?: string | null;
  esiid?: string | null;
}): Promise<ActualUsageSource | null> {
  const houseId = String(args.houseId ?? "").trim();
  if (!houseId) return null;

  const stored = await readHouseCommittedUsageSource(houseId);
  if (stored) return stored;

  return inferLegacyCommittedUsageSource({
    houseId,
    userId: args.userId ?? null,
  });
}

export async function isHouseCommittedToGreenButton(args: {
  houseId: string;
  userId?: string | null;
  esiid?: string | null;
}): Promise<boolean> {
  return (await resolveHouseCommittedUsageSource(args)) === "GREEN_BUTTON";
}
