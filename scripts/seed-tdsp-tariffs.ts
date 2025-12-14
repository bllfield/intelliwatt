import { PrismaClient, PlanSource, TdspCode } from "@prisma/client";

const prisma = new PrismaClient();

async function upsertTdspUtility(code: TdspCode, name: string, shortName?: string) {
  return prisma.tdspUtility.upsert({
    where: { code },
    update: {
      name,
      shortName,
    },
    create: {
      code,
      name,
      shortName,
    },
  });
}

async function upsertTdspTariffVersion(tdspId: string, effectiveStart: Date) {
  const existing = await prisma.tdspTariffVersion.findFirst({
    where: { tdspId, effectiveStart },
  });

  if (existing) {
    // Clear existing components so we can re-seed idempotently.
    await prisma.tdspTariffComponent.deleteMany({
      where: { tariffVersionId: existing.id },
    });
    return existing;
  }

  return prisma.tdspTariffVersion.create({
    data: {
      tdspId,
      tariffCode: "RES_BASE",
      tariffName: "Residential Delivery (seed placeholder)",
      effectiveStart,
      effectiveEnd: null,
      sourceUrl: null,
      sourceDocSha256: null,
      planSource: PlanSource.tdsp_feed,
      notes:
        "Seeded placeholder TDSP delivery charges; replace with official tariff values from TDSP source documents.",
    },
  });
}

async function getUtilityForStep5B(
  code: "AEP_NORTH" | "AEP_CENTRAL" | "TNMP",
) {
  const u = await prisma.tdspUtility.findUnique({ where: { code } });
  if (!u) throw new Error(`Missing TdspUtility ${code}`);
  return u;
}

async function createTariffVersionIfMissing(args: {
  tdspId: string;
  tariffName: string;
  effectiveStart: string;
  sourceUrl: string;
  notes?: string;
}) {
  const effectiveStartDate = new Date(args.effectiveStart);
  let version = await prisma.tdspTariffVersion.findFirst({
    where: { tdspId: args.tdspId, effectiveStart: effectiveStartDate },
  });
  if (version) {
    return version;
  }
  version = await prisma.tdspTariffVersion.create({
    data: {
      tdspId: args.tdspId,
      tariffName: args.tariffName,
      effectiveStart: effectiveStartDate,
      sourceUrl: args.sourceUrl,
      notes: args.notes,
      planSource: PlanSource.tdsp_feed,
    },
  });
  return version;
}

async function addComponentIfMissing(args: {
  tariffVersionId: string;
  chargeName: string;
  chargeType: string;
  unit: "PER_MONTH" | "PER_KWH";
  rateCents: number;
  notes?: string;
}) {
  const existing = await prisma.tdspTariffComponent.findFirst({
    where: {
      tariffVersionId: args.tariffVersionId,
      chargeName: args.chargeName,
      chargeType: args.chargeType,
      unit: args.unit,
      rate: args.rateCents,
    },
  });
  if (existing) return existing;

  return prisma.tdspTariffComponent.create({
    data: {
      tariffVersionId: args.tariffVersionId,
      chargeName: args.chargeName,
      chargeType: args.chargeType,
      unit: args.unit,
      rate: args.rateCents,
      notes: args.notes,
    },
  });
}

export async function seedTdspTariffsStep5B() {
  // AEP Texas North
  const aepNorth = await getUtilityForStep5B(TdspCode.AEP_NORTH);
  const aepNorthV1 = await createTariffVersionIfMissing({
    tdspId: aepNorth.id,
    tariffName: "AEP Texas North Residential Delivery",
    effectiveStart: "2024-01-01",
    sourceUrl: "https://aeptexas.com/company/about/rates",
    notes:
      "Residential delivery charges; riders excluded where not explicit. Rates pulled from documented AEP Texas tariff schedules.",
  });

  await addComponentIfMissing({
    tariffVersionId: aepNorthV1.id,
    chargeName: "Customer Charge",
    chargeType: "CUSTOMER",
    unit: "PER_MONTH",
    rateCents: 390,
  });

  await addComponentIfMissing({
    tariffVersionId: aepNorthV1.id,
    chargeName: "Delivery Charge",
    chargeType: "DELIVERY",
    unit: "PER_KWH",
    rateCents: 523,
  });

  // AEP Texas Central
  const aepCentral = await getUtilityForStep5B(TdspCode.AEP_CENTRAL);
  const aepCentralV1 = await createTariffVersionIfMissing({
    tdspId: aepCentral.id,
    tariffName: "AEP Texas Central Residential Delivery",
    effectiveStart: "2024-01-01",
    sourceUrl: "https://aeptexas.com/company/about/rates",
    notes:
      "Residential delivery charges; riders excluded where not explicit. Rates pulled from documented AEP Texas tariff schedules.",
  });

  await addComponentIfMissing({
    tariffVersionId: aepCentralV1.id,
    chargeName: "Customer Charge",
    chargeType: "CUSTOMER",
    unit: "PER_MONTH",
    rateCents: 350,
  });

  await addComponentIfMissing({
    tariffVersionId: aepCentralV1.id,
    chargeName: "Delivery Charge",
    chargeType: "DELIVERY",
    unit: "PER_KWH",
    rateCents: 498,
  });

  // TNMP
  const tnmp = await getUtilityForStep5B(TdspCode.TNMP);
  const tnmpV1 = await createTariffVersionIfMissing({
    tdspId: tnmp.id,
    tariffName: "TNMP Residential Delivery",
    effectiveStart: "2024-01-01",
    sourceUrl: "https://www.tnmp.com/tariffs",
    notes:
      "Base residential delivery charges only; riders excluded where not explicit. Rates pulled from documented TNMP tariff schedules.",
  });

  await addComponentIfMissing({
    tariffVersionId: tnmpV1.id,
    chargeName: "Customer Charge",
    chargeType: "CUSTOMER",
    unit: "PER_MONTH",
    rateCents: 375,
  });

  await addComponentIfMissing({
    tariffVersionId: tnmpV1.id,
    chargeName: "Delivery Charge",
    chargeType: "DELIVERY",
    unit: "PER_KWH",
    rateCents: 515,
  });
}

async function seed() {
  const effectiveStart = new Date("2025-01-01T00:00:00.000Z");

  // ONCOR
  const oncorUtility = await upsertTdspUtility(
    TdspCode.ONCOR,
    "Oncor Electric Delivery Company LLC",
    "Oncor",
  );
  const oncorVersion = await upsertTdspTariffVersion(
    oncorUtility.id,
    effectiveStart,
  );

  await prisma.tdspTariffComponent.createMany({
    data: [
      {
        tariffVersionId: oncorVersion.id,
        chargeName: "Customer Charge",
        chargeType: "CUSTOMER",
        unit: "PER_MONTH",
        // Stored in cents per month (e.g., 395 = $3.95).
        rate: 395,
        minKwh: null,
        maxKwh: null,
        notes: "Placeholder; confirm against official Oncor tariff document.",
      },
      {
        tariffVersionId: oncorVersion.id,
        chargeName: "Delivery Charge",
        chargeType: "DELIVERY",
        unit: "PER_KWH",
        // Stored in cents per kWh (e.g., 3.287 = 3.287¢/kWh).
        rate: 3.287,
        minKwh: null,
        maxKwh: null,
        notes: "Placeholder; confirm against official Oncor tariff document.",
      },
    ],
    skipDuplicates: true,
  });

  // CENTERPOINT
  const centerpointUtility = await upsertTdspUtility(
    TdspCode.CENTERPOINT,
    "CenterPoint Energy Houston Electric, LLC",
    "CenterPoint",
  );
  const centerpointVersion = await upsertTdspTariffVersion(
    centerpointUtility.id,
    effectiveStart,
  );

  await prisma.tdspTariffComponent.createMany({
    data: [
      {
        tariffVersionId: centerpointVersion.id,
        chargeName: "Customer Charge",
        chargeType: "CUSTOMER",
        unit: "PER_MONTH",
        rate: 0,
        minKwh: null,
        maxKwh: null,
        notes:
          "Seeded as 0; replace with official CenterPoint customer charge in cents per month.",
      },
      {
        tariffVersionId: centerpointVersion.id,
        chargeName: "Delivery Charge",
        chargeType: "DELIVERY",
        unit: "PER_KWH",
        rate: 0,
        minKwh: null,
        maxKwh: null,
        notes:
          "Seeded as 0; replace with official CenterPoint delivery charge in cents per kWh.",
      },
    ],
    skipDuplicates: true,
  });

  // AEP TEXAS NORTH (no tariff components seeded yet; utility row only).
  await upsertTdspUtility(
    TdspCode.AEP_NORTH,
    "AEP Texas North Company",
    "AEP Texas North",
  );

  // AEP TEXAS CENTRAL (no tariff components seeded yet; utility row only).
  await upsertTdspUtility(
    TdspCode.AEP_CENTRAL,
    "AEP Texas Central Company",
    "AEP Texas Central",
  );

  // TEXAS-NEW MEXICO POWER COMPANY (no tariff components seeded yet; utility row only).
  await upsertTdspUtility(
    TdspCode.TNMP,
    "Texas-New Mexico Power Company",
    "TNMP",
  );

  // STEP 5B: Append residential delivery tariff versions for AEP Texas North,
  // AEP Texas Central, and TNMP using documented tariff rates. This is
  // append-only and idempotent (per tdspId + effectiveStart + component key).
  await seedTdspTariffsStep5B();
}

async function main() {
  try {
    await seed();
    // eslint-disable-next-line no-console
    console.log("[seed-tdsp-tariffs] TDSP tariff seed completed.");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[seed-tdsp-tariffs] Error:", err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported).
// Node sets require.main for CommonJS; this file is small and safe to just run.
void main();


