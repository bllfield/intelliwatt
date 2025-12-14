import { PlanSource, TdspCode } from "@prisma/client";
import { db } from "@/lib/db";

export type IngestTariffComponent = {
  chargeName: string;
  chargeType: "CUSTOMER" | "DELIVERY";
  unit: "PER_MONTH" | "PER_KWH";
  rateCents: string;
};

export type UpsertTdspTariffFromIngestArgs = {
  tdspCode: "ONCOR" | "CENTERPOINT" | "AEP_NORTH" | "AEP_CENTRAL" | "TNMP";
  effectiveStartISO: string;
  sourceUrl: string;
  sourceDocSha256: string;
  components: IngestTariffComponent[];
};

/**
 * Upsert TDSP tariff versions and components from an ingest source.
 *
 * - Never mutates existing versions in-place.
 * - Creates new TdspTariffVersion rows when content or source doc changes.
 * - Closes prior open-ended versions when a newer effectiveStart is introduced.
 */
export async function upsertTdspTariffFromIngest(
  args: UpsertTdspTariffFromIngestArgs,
) {
  const { tdspCode, effectiveStartISO, sourceUrl, sourceDocSha256, components } =
    args;

  const tdspEnum = TdspCode[tdspCode as keyof typeof TdspCode];
  if (!tdspEnum) {
    throw new Error(`Unknown TdspCode in ingest: ${tdspCode}`);
  }

  const utility = await db.tdspUtility.findUnique({
    where: { code: tdspEnum },
  });
  if (!utility) {
    throw new Error(`TdspUtility not found for code ${tdspCode}`);
  }

  const effectiveStart = new Date(effectiveStartISO);
  if (Number.isNaN(effectiveStart.getTime())) {
    throw new Error(
      `Invalid effectiveStartISO for ${tdspCode}: ${effectiveStartISO}`,
    );
  }

  // Find existing versions for this TDSP + effectiveStart.
  const existingVersions = await (db as any).tdspTariffVersion.findMany({
    where: { tdspId: utility.id, effectiveStart },
    orderBy: { createdAt: "desc" },
  });

  const latestExisting = existingVersions[0] ?? null;

  if (latestExisting && latestExisting.sourceDocSha256 === sourceDocSha256) {
    // Same source document already ingested for this effectiveStart; assume
    // components are identical and treat as a no-op to avoid duplicates.
    return {
      action: "noop",
      tdspCode,
      effectiveStartISO,
      versionId: latestExisting.id,
    } as const;
  }

  // Insert a new TdspTariffVersion row (append-only).
  const newVersion = await (db as any).tdspTariffVersion.create({
    data: {
      tdspId: utility.id,
      tariffName: `${tdspCode} Residential Delivery (PUCT ingest)`,
      effectiveStart,
      effectiveEnd: null,
      sourceUrl,
      sourceDocSha256,
      planSource: PlanSource.tdsp_feed,
      notes:
        latestExisting && latestExisting.sourceDocSha256
          ? "INGEST: drift/new parse relative to previous PUCT Rate_Report."
          : "INGEST: initial PUCT Rate_Report ingest for this effectiveStart.",
    },
  });

  // Close any prior open-ended versions with earlier effectiveStart.
  await (db as any).tdspTariffVersion.updateMany({
    where: {
      tdspId: utility.id,
      effectiveStart: { lt: effectiveStart },
      effectiveEnd: null,
    },
    data: {
      effectiveEnd: effectiveStart,
    },
  });

  // Insert components for the new version.
  for (const c of components) {
    await (db as any).tdspTariffComponent.create({
      data: {
        tariffVersionId: newVersion.id,
        chargeName: c.chargeName,
        chargeType: c.chargeType,
        unit: c.unit,
        rate: c.rateCents,
        minKwh: null,
        maxKwh: null,
        notes: null,
      },
    });
  }

  return {
    action: "created",
    tdspCode,
    effectiveStartISO,
    versionId: newVersion.id,
  } as const;
}


