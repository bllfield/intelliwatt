import { PlanSource, TdspCode } from "@prisma/client";
import { db } from "@/lib/db";

export type TdspCharges = {
  tdspCode: string;
  asOfDate: Date;
  tariffVersionId: string;
  effectiveStart: Date;
  effectiveEnd: Date | null;
  /**
   * Sum of PER_MONTH components for this tariff version, in integer cents
   * per billing cycle. Null when no PER_MONTH components exist.
   */
  monthlyCents: number | null;
  /**
   * Sum of PER_KWH components for this tariff version, in cents per kWh.
   * Null when no PER_KWH components exist.
   */
  perKwhCents: number | null;
  components: Array<{
    chargeType: string;
    unit: string;
    rate: string;
    minKwh?: number | null;
    maxKwh?: number | null;
  }>;
  /**
   * Confidence reflects that values come from our curated tariff table, not
   * from an EFL; callers may still choose to treat this as "MED" confidence.
   */
  confidence: "MED" | "LOW";
};

export async function lookupTdspCharges(args: {
  tdspCode: "ONCOR" | "CENTERPOINT" | "AEP_NORTH" | "AEP_CENTRAL" | "TNMP";
  asOfDate: Date;
}): Promise<TdspCharges | null> {
  const { tdspCode, asOfDate } = args;

  // Ensure tdspCode is a valid enum value; narrow at the boundary.
  const tdspEnum = TdspCode[tdspCode as keyof typeof TdspCode];
  if (!tdspEnum) {
    return null;
  }

  const utility = await db.tdspUtility.findUnique({
    where: { code: tdspEnum },
  });
  if (!utility) {
    return null;
  }

  // Find the tariff version active at asOfDate:
  // - effectiveStart <= asOfDate
  // - effectiveEnd is null OR > asOfDate
  // If multiple match, prefer the one with the latest effectiveStart.
  const version = await db.tdspTariffVersion.findFirst({
    where: {
      tdspId: utility.id,
      effectiveStart: { lte: asOfDate },
      OR: [{ effectiveEnd: null }, { effectiveEnd: { gt: asOfDate } }],
    },
    orderBy: [
      { effectiveStart: "desc" },
      // When multiple versions share the same effectiveStart (e.g., drift/new
      // parse of the same PUCT report), prefer the most recently created one.
      { createdAt: "desc" },
    ],
  });

  if (!version) {
    return null;
  }

  const components = await db.tdspTariffComponent.findMany({
    where: { tariffVersionId: version.id },
  });

  let monthlyCents: number | null = null;
  let perKwhCents: number | null = null;

  for (const c of components) {
    const rateNumber = Number(c.rate);
    if (!Number.isFinite(rateNumber)) continue;
    if (c.unit === "PER_MONTH") {
      monthlyCents = (monthlyCents ?? 0) + rateNumber;
    } else if (c.unit === "PER_KWH") {
      perKwhCents = (perKwhCents ?? 0) + rateNumber;
    }
  }

  // Defensive normalization:
  // Some ingests have historically stored PER_KWH component rates in "cents" vs "mills" (or dollars),
  // resulting in values 100x too large (e.g., 498 instead of 4.98).
  // Delivery charges in TX should never be anywhere near $1/kWh, so fail-safe scale down when clearly wrong.
  if (typeof perKwhCents === "number" && Number.isFinite(perKwhCents) && perKwhCents > 50) {
    perKwhCents = perKwhCents / 100;
  }

  return {
    tdspCode,
    asOfDate,
    tariffVersionId: version.id,
    effectiveStart: version.effectiveStart,
    effectiveEnd: version.effectiveEnd,
    monthlyCents,
    perKwhCents,
    components: components.map((c) => ({
      chargeType: c.chargeType,
      unit: c.unit,
      rate: c.rate.toString(),
      minKwh: c.minKwh,
      maxKwh: c.maxKwh,
    })),
    // Table-backed values: MED confidence by design.
    confidence: "MED",
  };
}


