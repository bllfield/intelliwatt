import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { pickBestSmtAuthorization } from "@/lib/smt/authorizationSelection";
import { normalizeEmail } from "@/lib/utils/email";

type UserSummary = { id: string; email: string };

type HouseSummary = {
  id: string;
  houseId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip5: string | null;
  esiid: string | null;
  tdspSlug: string | null;
  utilityName: string | null;
  isPrimary: boolean;
  archivedAt: Date | null;
};

export type UsageEntryContext = {
  user: UserSummary | null;
  loadError?: string | null;
  houseAddress: HouseSummary | null;
  smtLatestIntervalAt?: Date | null;
  existingAuthorization: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    smtStatus: string | null;
    smtStatusMessage: string | null;
    smtAgreementId: string | null;
    smtSubscriptionId: string | null;
    meterNumber: string | null;
    authorizationStartDate: Date | null;
    authorizationEndDate: Date | null;
    smtLastSyncAt?: Date | null;
    archivedAt: Date | null;
  } | null;
  displacedAttention: boolean;
  greenButtonUpload: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    parseStatus: string | null;
    parseMessage: string | null;
    dateRangeStart: Date | null;
    dateRangeEnd: Date | null;
    intervalMinutes: number | null;
    fileName: string;
    fileSizeBytes: number | null;
  } | null;
  manualUsageUpload: {
    id: string;
    uploadedAt: Date;
    expiresAt: Date;
    source: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

export async function loadUsageEntryContext(): Promise<UsageEntryContext> {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  const prismaAny = prisma as any;

  try {
    let user: UserSummary | null = null;
    if (sessionEmail) {
      const normalizedEmail = normalizeEmail(sessionEmail);
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true },
      });
    }

    let houseAddress: HouseSummary | null = null;
    if (user) {
      const select = {
        id: true,
        houseId: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
        isPrimary: true,
        archivedAt: true,
      } satisfies Record<string, boolean>;

      houseAddress =
        (await prismaAny.houseAddress.findFirst({
          where: { userId: user.id, archivedAt: null, isPrimary: true },
          orderBy: { createdAt: "desc" },
          select,
        })) ??
        (await prismaAny.houseAddress.findFirst({
          where: { userId: user.id, archivedAt: null },
          orderBy: { createdAt: "desc" },
          select,
        }));
    }

    let existingAuthorization: UsageEntryContext["existingAuthorization"] = null;
    if (user && houseAddress) {
      const authorizationCandidates = await prismaAny.smtAuthorization.findMany({
        where: {
          userId: user.id,
          houseAddressId: houseAddress.id,
          archivedAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          smtStatus: true,
          smtStatusMessage: true,
          smtAgreementId: true,
          smtSubscriptionId: true,
          meterNumber: true,
          authorizationStartDate: true,
          authorizationEndDate: true,
          smtLastSyncAt: true,
          archivedAt: true,
        },
      });
      existingAuthorization = pickBestSmtAuthorization(authorizationCandidates as any[]) as any;
    }

    // SMT "Updated" should reflect the latest ingested interval timestamp when available.
    // This is the most user-meaningful "last updated" signal (versus auth.createdAt).
    let smtLatestIntervalAt: Date | null = null;
    try {
      if (houseAddress?.esiid) {
        const latest = await prismaAny.smtInterval.findFirst({
          where: { esiid: houseAddress.esiid },
          orderBy: { ts: "desc" },
          select: { ts: true },
        });
        smtLatestIntervalAt = latest?.ts ?? null;
      }
    } catch {
      smtLatestIntervalAt = null;
    }

    let userProfile = null;
    if (user) {
      userProfile = await prismaAny.userProfile.findUnique({
        where: { userId: user.id },
        select: {
          esiidAttentionRequired: true,
          esiidAttentionCode: true,
        },
      });
    }

    const displacedAttention =
      Boolean(userProfile?.esiidAttentionRequired) &&
      userProfile?.esiidAttentionCode === "smt_replaced";

    const greenButtonUpload =
      houseAddress &&
      (await prismaAny.greenButtonUpload.findFirst({
        where: { houseId: houseAddress.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          parseStatus: true,
          parseMessage: true,
          dateRangeStart: true,
          dateRangeEnd: true,
          intervalMinutes: true,
          fileName: true,
          fileSizeBytes: true,
        },
      }));

    // Fallback: if a Green Button upload never updated its coverage but intervals exist,
    // surface coverage so the dashboard can show ACTIVE instead of stuck PENDING.
    let gbCoverage: { start: Date | null; end: Date | null; count: number } | null = null;
    if (houseAddress) {
      const coverage = await (prismaAny.usagePrisma ?? usagePrisma)?.greenButtonInterval
        .aggregate({
          where: { homeId: houseAddress.id },
          _count: { _all: true },
          _min: { timestamp: true },
          _max: { timestamp: true },
        })
        .catch(() => null);

      if (coverage && (coverage._count?._all ?? 0) > 0) {
        gbCoverage = {
          start: coverage._min?.timestamp ?? null,
          end: coverage._max?.timestamp ?? null,
          count: coverage._count?._all ?? 0,
        };
      }
    }

    const resolvedGreenButtonUpload = greenButtonUpload
      ? {
          ...greenButtonUpload,
          dateRangeStart: greenButtonUpload.dateRangeStart ?? gbCoverage?.start ?? null,
          dateRangeEnd: greenButtonUpload.dateRangeEnd ?? gbCoverage?.end ?? null,
        }
      : gbCoverage
        ? {
            id: "derived-coverage",
            createdAt: gbCoverage.start ?? new Date(),
            updatedAt: gbCoverage.end ?? new Date(),
            parseStatus: "complete",
            parseMessage: null,
            dateRangeStart: gbCoverage.start,
            dateRangeEnd: gbCoverage.end,
            intervalMinutes: 15,
            fileName: "derived",
            fileSizeBytes: null,
          }
        : null;

    const manualUsageUpload =
      houseAddress &&
      (await prismaAny.manualUsageUpload.findFirst({
        where: { houseId: houseAddress.id },
        orderBy: { uploadedAt: "desc" },
        select: {
          id: true,
          uploadedAt: true,
          expiresAt: true,
          source: true,
          createdAt: true,
          updatedAt: true,
        },
      }));

    return {
      user,
      houseAddress,
      existingAuthorization,
      smtLatestIntervalAt,
      displacedAttention,
      greenButtonUpload: resolvedGreenButtonUpload,
      manualUsageUpload,
    };
  } catch (e: any) {
    return {
      user: null,
      houseAddress: null,
      existingAuthorization: null,
      smtLatestIntervalAt: null,
      displacedAttention: false,
      greenButtonUpload: null,
      manualUsageUpload: null,
      loadError: e?.message ?? String(e ?? "usage_entry_context_failed"),
    };
  }
}

