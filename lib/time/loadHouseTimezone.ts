import { prisma } from "@/lib/db";
import { resolveHomeTimezone, type HomeTimezoneInput } from "@/lib/time/resolveHomeTimezone";

export async function loadHouseTimezoneInput(
  houseId: string,
): Promise<HomeTimezoneInput & { houseId: string }> {
  const houseAddress = (prisma as { houseAddress?: { findFirst?: Function } }).houseAddress;
  if (typeof houseAddress?.findFirst !== "function") {
    return { houseId, addressState: null };
  }
  const row = await houseAddress.findFirst({
    where: { OR: [{ id: houseId }, { houseId }] },
    select: { addressState: true },
  });
  return {
    houseId,
    addressState: row?.addressState ?? null,
  };
}

export async function loadHomeTimezoneForHouseId(
  houseId: string,
  overrides?: Partial<HomeTimezoneInput>,
): Promise<string> {
  const input = await loadHouseTimezoneInput(houseId);
  return resolveHomeTimezone({ ...input, ...overrides });
}
