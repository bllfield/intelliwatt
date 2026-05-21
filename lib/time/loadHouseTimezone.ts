import { prisma } from "@/lib/db";
import { resolveHomeTimezone, type HomeTimezoneInput } from "@/lib/time/resolveHomeTimezone";

export async function loadHouseTimezoneInput(
  houseId: string,
): Promise<HomeTimezoneInput & { houseId: string }> {
  try {
    const row = await prisma.houseAddress.findFirst({
      where: { OR: [{ id: houseId }, { houseId }] },
      select: { addressState: true },
    });
    return {
      houseId,
      addressState: row?.addressState ?? null,
    };
  } catch {
    return { houseId, addressState: null };
  }
}

export async function loadHomeTimezoneForHouseId(
  houseId: string,
  overrides?: Partial<HomeTimezoneInput>,
): Promise<string> {
  const input = await loadHouseTimezoneInput(houseId);
  return resolveHomeTimezone({ ...input, ...overrides });
}
