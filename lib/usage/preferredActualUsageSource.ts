import { prisma } from "@/lib/db";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";

const GREEN_BUTTON_UPLOAD_OK_STATUSES = ["complete", "complete_with_warnings"] as const;

/** User uploaded Green Button on this home — usage reads should prefer GB over a partial SMT tail. */
export async function resolveHousePreferredActualUsageSource(
  houseId: string,
): Promise<ActualUsageSource | null> {
  const id = String(houseId ?? "").trim();
  if (!id) return null;
  const upload = await (prisma as any).greenButtonUpload.findFirst({
    where: {
      houseId: id,
      parseStatus: { in: [...GREEN_BUTTON_UPLOAD_OK_STATUSES] },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return upload?.id ? "GREEN_BUTTON" : null;
}

export async function houseHasSuccessfulGreenButtonUpload(houseId: string): Promise<boolean> {
  return (await resolveHousePreferredActualUsageSource(houseId)) === "GREEN_BUTTON";
}
