export type TdspDeliveryRates = {
  tdspSlug: string;
  effectiveDate: string; // ISO
  perKwhDeliveryChargeCents: number; // variable
  monthlyCustomerChargeDollars: number; // fixed
};

import { lookupTdspCharges } from "@/lib/utility/tdspTariffs";

function mapTdspSlugToTdspCode(
  tdspSlug: string,
): "ONCOR" | "CENTERPOINT" | "AEP_NORTH" | "AEP_CENTRAL" | "TNMP" | null {
  const s = String(tdspSlug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, "_")
    .replace(/-+/g, "_");

  if (s === "oncor") return "ONCOR";
  // CenterPoint aliases observed across sources (WattBuy/TDSP tables/etc.)
  if (s === "centerpoint" || s === "cnp" || s === "cenpnt" || s === "center_point") return "CENTERPOINT";
  if (s === "tnmp") return "TNMP";

  // Accept common aliases for AEP territories.
  if (s === "aep_n" || s === "aep_north" || s === "aep_texas_north" || s === "aep_texas_n") return "AEP_NORTH";
  if (s === "aep_c" || s === "aep_central" || s === "aep_texas_central" || s === "aep_texas_c") return "AEP_CENTRAL";

  // Some callers may pass verbose slugs.
  if (s === "aep_texas_north" || s === "aep_texas_n") return "AEP_NORTH";
  if (s === "aep_texas_central" || s === "aep_texas_c") return "AEP_CENTRAL";

  return null;
}

export async function getTdspDeliveryRates(args: {
  tdspSlug: string;
  asOf: Date;
}): Promise<TdspDeliveryRates | null> {
  try {
    const code = mapTdspSlugToTdspCode(args.tdspSlug);
    if (!code) return null;

    const charges = await lookupTdspCharges({ tdspCode: code, asOfDate: args.asOf });
    if (!charges) return null;

    // Best-effort but fail-closed: require both per-kWh and monthly components.
    const perKwh = typeof charges.perKwhCents === "number" && Number.isFinite(charges.perKwhCents) ? charges.perKwhCents : null;
    const monthlyCents = typeof charges.monthlyCents === "number" && Number.isFinite(charges.monthlyCents) ? charges.monthlyCents : null;
    if (perKwh == null || monthlyCents == null) return null;

    return {
      tdspSlug: args.tdspSlug,
      effectiveDate: charges.effectiveStart.toISOString(),
      perKwhDeliveryChargeCents: perKwh,
      monthlyCustomerChargeDollars: Number((monthlyCents / 100).toFixed(2)),
    };
  } catch {
    return null;
  }
}


