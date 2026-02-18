import { appliancesPrisma } from "@/lib/db/appliancesClient";

export type ApplianceProfileSimulatedRow = {
  appliancesJson: unknown;
};

export async function getApplianceProfileSimulatedByUserHouse(args: {
  userId: string;
  houseId: string;
}): Promise<ApplianceProfileSimulatedRow | null> {
  try {
    const rec = await appliancesPrisma.applianceProfileSimulated.findUnique({
      where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
      select: { appliancesJson: true },
    });
    return (rec as ApplianceProfileSimulatedRow | null) ?? null;
  } catch {
    return null;
  }
}

