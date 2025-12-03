import { prisma } from "@/lib/db";
import {
  findAgreementForEsiid,
  terminateSmtAgreement,
  type SmtAgreementSummary,
} from "@/lib/smt/agreements";

export async function setPrimaryHouse(
  userId: string,
  houseId: string,
  opts: { keepOthers?: boolean } = {},
): Promise<{ archivedHouseIds: string[] }> {
  const now = new Date();

  const client = prisma as any;

  const result = await client.$transaction(async (tx: any) => {
    const otherHouses = await tx.houseAddress.findMany({
      where: {
        userId,
        archivedAt: null,
        id: { not: houseId },
      },
      select: { id: true },
    });

    const otherIds = otherHouses.map((house: any) => house.id);
    let archivedHouseIds: string[] = [];

    if (otherIds.length > 0) {
      if (opts.keepOthers) {
        await tx.houseAddress.updateMany({
          where: { id: { in: otherIds } },
          data: { isPrimary: false },
        });
      } else {
        await tx.houseAddress.updateMany({
          where: { id: { in: otherIds } },
          data: { isPrimary: false, archivedAt: now },
        });

        await tx.smtAuthorization.updateMany({
          where: { houseAddressId: { in: otherIds }, archivedAt: null },
          data: {
            archivedAt: now,
            smtStatus: "archived",
            smtStatusMessage: "Superseded by new address",
            revokedReason: "address_replaced",
          },
        });

        archivedHouseIds = otherIds;
      }
    }

    await tx.houseAddress.update({
      where: { id: houseId },
      data: { isPrimary: true, archivedAt: null },
    });

    return { archivedHouseIds };
  });
  return result;
}

export async function archiveAuthorizationsForHouse(houseId: string, reason: string) {
  const now = new Date();

  const result = await (prisma as any).smtAuthorization.updateMany({
    where: { houseAddressId: houseId, archivedAt: null },
    data: {
      archivedAt: now,
      smtStatus: reason === "conflict_replaced" ? "revoked_conflict" : "archived",
      smtStatusMessage:
        reason === "address_replaced"
          ? "Superseded by new address"
          : "Authorization archived",
      revokedReason: reason,
    },
  });

  return result.count ?? 0;
}

type ArchiveConflictParams = {
  newAuthorizationId: string;
  newHouseId: string;
  userId: string;
  esiid: string;
  meterNumber?: string | null;
};

type DisplacedTerminationTarget = {
  agreementId: string | null;
  contactEmail: string | null;
  esiid: string | null;
  userId: string;
};

type ArchiveConflictTransactionResult = {
  archivedAuthorizationIds: string[];
  displacedUserIds: string[];
  displacedTargets: DisplacedTerminationTarget[];
};

export async function archiveConflictingAuthorizations({
  newAuthorizationId,
  newHouseId,
  userId,
  esiid,
  meterNumber,
}: ArchiveConflictParams): Promise<{
  archivedAuthorizationIds: string[];
  displacedUserIds: string[];
}> {
  const now = new Date();

  const client = prisma as any;

  const result = await client.$transaction(async (tx: any): Promise<ArchiveConflictTransactionResult> => {
    const orClauses = [
      { esiid },
      meterNumber && meterNumber.trim().length > 0 ? { meterNumber } : null,
    ].filter(Boolean) as { esiid?: string; meterNumber?: string }[];

    if (!orClauses.length) {
      return {
        archivedAuthorizationIds: [] as string[],
        displacedUserIds: [] as string[],
        displacedTargets: [] as DisplacedTerminationTarget[],
      };
    }

    const conflicts = await tx.smtAuthorization.findMany({
      where: {
        archivedAt: null,
        id: { not: newAuthorizationId },
        OR: orClauses,
      },
      select: {
        id: true,
        userId: true,
        houseAddressId: true,
        smtAgreementId: true,
        contactEmail: true,
        esiid: true,
      },
    });

    if (!conflicts.length) {
      return {
        archivedAuthorizationIds: [] as string[],
        displacedUserIds: [] as string[],
        displacedTargets: [] as DisplacedTerminationTarget[],
      };
    }

    const archivedAuthorizationIds: string[] = [];
    const displacedUserIds = new Set<string>();
    const displacedTargets: DisplacedTerminationTarget[] = [];

    for (const auth of conflicts) {
      archivedAuthorizationIds.push(auth.id);

      await tx.smtAuthorization.update({
        where: { id: auth.id },
        data: {
          archivedAt: now,
          smtStatus: "revoked_conflict",
          smtStatusMessage: `Superseded by authorization ${newAuthorizationId}`,
          revokedReason: "conflict_replaced",
        },
      });

      if (auth.houseAddressId) {
        await tx.houseAddress.update({
          where: { id: auth.houseAddressId },
          data: { archivedAt: now, isPrimary: false },
        });
      }

      const displacedEntries = await tx.entry.findMany({
        where: {
          userId: auth.userId,
          type: "smart_meter_connect",
          houseId: auth.houseAddressId ?? null,
        },
        select: { id: true, status: true },
      });

      for (const entry of displacedEntries) {
        await tx.entry.update({
          where: { id: entry.id },
          data: {
            status: "EXPIRED",
            expiresAt: now,
            expirationReason: "Smart Meter Texas authorization replaced by another IntelliWatt household",
            lastValidated: now,
          },
        });

        await tx.entryStatusLog.create({
          data: {
            entryId: entry.id,
            previous: entry.status,
            next: "EXPIRED",
            reason: "smt_replaced",
          },
        });
      }

      displacedTargets.push({
        agreementId: auth.smtAgreementId ?? null,
        contactEmail: auth.contactEmail ?? null,
        esiid: auth.esiid ?? null,
        userId: auth.userId,
      });

      if (auth.userId !== userId) {
        displacedUserIds.add(auth.userId);
      }
    }

    if (displacedUserIds.size > 0) {
      const displaced = Array.from(displacedUserIds);
      try {
        for (const displacedUserId of displaced) {
          await tx.userProfile.upsert({
            where: { userId: displacedUserId },
            update: {
              esiidAttentionRequired: true,
              esiidAttentionCode: "smt_replaced",
              esiidAttentionAt: now,
            },
            create: {
              userId: displacedUserId,
              esiidAttentionRequired: true,
              esiidAttentionCode: "smt_replaced",
              esiidAttentionAt: now,
            },
          });
        }
      } catch (err) {
        console.warn(
          "[archiveConflictingAuthorizations] Failed to set attention flags; run prisma migrate deploy?",
          err,
        );
      }
    }

    return {
      archivedAuthorizationIds,
      displacedUserIds: Array.from(displacedUserIds),
      displacedTargets,
    };
  });

  await terminateDisplacedAuthorizations(result.displacedTargets);

  return {
    archivedAuthorizationIds: result.archivedAuthorizationIds,
    displacedUserIds: result.displacedUserIds,
  };
}

async function terminateDisplacedAuthorizations(
  targets: DisplacedTerminationTarget[],
) {
  const attempted = new Set<string>();
  const userEmailCache = new Map<string, string | null>();

  for (const target of targets) {
    let agreementId = target.agreementId ?? null;
    let email = target.contactEmail?.trim() ?? null;

    if (!email) {
      if (!userEmailCache.has(target.userId)) {
        const user = await prisma.user.findUnique({
          where: { id: target.userId },
          select: { email: true },
        });
        userEmailCache.set(
          target.userId,
          user?.email ? user.email.trim() : null,
        );
      }
      email = userEmailCache.get(target.userId) ?? null;
    }

    if (!agreementId && target.esiid) {
      try {
        const lookup = await findAgreementForEsiid(target.esiid);

        const normalizedEmail = email?.toLowerCase() ?? null;

        let candidate: SmtAgreementSummary | null = null;

        if (normalizedEmail) {
          candidate =
            lookup.agreements.find((agreement) => {
              const agreementEmail = extractEmailFromAgreement(agreement);
              return (
                agreementEmail && agreementEmail.toLowerCase() === normalizedEmail
              );
            }) ?? null;
        }

        if (!candidate) {
          candidate =
            lookup.agreements.find((agreement) =>
              isAgreementLikelyActive(agreement),
            ) ?? null;
        }

        if (!candidate) {
          candidate = lookup.match ?? null;
        }

        if (candidate?.agreementNumber) {
          agreementId = String(candidate.agreementNumber);
          if (!email) {
            const resolvedEmail = extractEmailFromAgreement(candidate);
            email = resolvedEmail ? resolvedEmail.trim() : null;
          }
        }
      } catch (error) {
        console.error(
          "[archiveConflictingAuthorizations] Failed to lookup displaced SMT agreement",
          { esiid: target.esiid, error },
        );
      }
    }

    if (!agreementId || !email) {
      console.warn(
        "[archiveConflictingAuthorizations] Skipping SMT termination; missing agreement or email",
        { agreementId, email, esiid: target.esiid, userId: target.userId },
      );
      continue;
    }

    email = email.trim();

    const dedupeKey = `${agreementId.toString().toLowerCase()}::${email.toLowerCase()}`;
    if (attempted.has(dedupeKey)) {
      continue;
    }
    attempted.add(dedupeKey);

    try {
      await terminateSmtAgreement(agreementId, email);
    } catch (error) {
      console.error(
        "[archiveConflictingAuthorizations] Failed to terminate displaced SMT agreement",
        { agreementId, email, error },
      );
    }
  }
}

function extractEmailFromAgreement(
  agreement: SmtAgreementSummary | null,
): string | null {
  if (!agreement) return null;
  return extractEmailFromRaw(agreement.raw);
}

function extractEmailFromRaw(value: any): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    if (value.includes("@")) {
      return value;
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = extractEmailFromRaw(item);
      if (result) return result;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (
        typeof nested === "string" &&
        key.toLowerCase().includes("email") &&
        nested.includes("@")
      ) {
        return nested;
      }
      const result = extractEmailFromRaw(nested);
      if (result) return result;
    }
  }

  return null;
}

function isAgreementLikelyActive(agreement: {
  status?: string | null;
  statusReason?: string | null;
}): boolean {
  const statusRaw =
    agreement.status?.toLowerCase() ??
    agreement.statusReason?.toLowerCase() ??
    "";
  if (!statusRaw) return false;

  if (statusRaw.includes("non active") || statusRaw.includes("terminate")) {
    return false;
  }

  return statusRaw.includes("active") || statusRaw === "act";
}


