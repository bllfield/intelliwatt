export type TdspDeliveryRates = {
  tdspSlug: string;
  effectiveDate: string; // ISO
  perKwhDeliveryChargeCents: number; // variable
  monthlyCustomerChargeDollars: number; // fixed
};

export async function getTdspDeliveryRates(args: {
  tdspSlug: string;
  asOf: Date;
}): Promise<TdspDeliveryRates | null> {
  // Stub: wired later to TDSP module DB / master normalized table
  void args;
  return null;
}


