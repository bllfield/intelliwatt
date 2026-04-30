import { prisma } from "@/lib/db";

export async function resolveDashboardHomeId(userId: string): Promise<string | null> {
  const primaryHouse = await (prisma as any).houseAddress.findFirst({
    where: { userId, archivedAt: null, isPrimary: true } as any,
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (primaryHouse?.id) return String(primaryHouse.id);

  const fallbackHouse = await (prisma as any).houseAddress.findFirst({
    where: { userId, archivedAt: null } as any,
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return fallbackHouse?.id ? String(fallbackHouse.id) : null;
}
