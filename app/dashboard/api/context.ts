import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
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
  houseAddress: HouseSummary | null;
  existingAuthorization: {
    id: string;
    createdAt: Date;
    smtStatus: string | null;
    smtStatusMessage: string | null;
    smtAgreementId: string | null;
    smtSubscriptionId: string | null;
    meterNumber: string | null;
    authorizationStartDate: Date | null;
    authorizationEndDate: Date | null;
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
    existingAuthorization = await prismaAny.smtAuthorization.findFirst({
      where: {
        userId: user.id,
        houseAddressId: houseAddress.id,
        archivedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        smtStatus: true,
        smtStatusMessage: true,
        smtAgreementId: true,
        smtSubscriptionId: true,
        meterNumber: true,
        authorizationStartDate: true,
        authorizationEndDate: true,
        archivedAt: true,
      },
    });
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
    displacedAttention,
    greenButtonUpload,
    manualUsageUpload,
  };
}

