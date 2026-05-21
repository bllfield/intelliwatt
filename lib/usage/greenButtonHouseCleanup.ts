import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

/** Removes persisted Green Button usage for a house (intervals, raw, uploads). */
export async function clearGreenButtonUsageForHouse(houseId: string): Promise<void> {
  const id = String(houseId ?? "").trim();
  if (!id) return;

  if (USAGE_DB_ENABLED) {
    await (usagePrisma as any).greenButtonInterval?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).rawGreenButton?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).homeMonthlyUsageBucket?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).homeDailyUsageBucket?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
  }
  await prisma.greenButtonUpload.deleteMany({ where: { houseId: id } }).catch(() => null);
  await prisma.manualUsageUpload
    .deleteMany({ where: { houseId: id, source: "green_button" } })
    .catch(() => null);
}
