import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";

export type AdminHouseLookupRow = {
  id: string;
  esiid: string | null;
  isPrimary: boolean;
  label: string;
  addressLine1: string | null;
  addressCity: string | null;
  addressState: string | null;
};

function buildHouseLabel(row: {
  id: string;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  esiid?: string | null;
}): string {
  const address = [row.addressLine1, row.addressCity, row.addressState]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const esiid = String(row.esiid ?? "").trim();
  if (address && esiid) return `${address} (${esiid})`;
  if (address) return address;
  if (esiid) return esiid;
  return row.id;
}

export async function lookupAdminHousesByEmail(emailRaw: string): Promise<{
  ok: true;
  email: string;
  userId: string;
  houses: AdminHouseLookupRow[];
} | {
  ok: false;
  error: "email_required" | "user_not_found";
}> {
  const email = normalizeEmailSafe(emailRaw);
  if (!email) return { ok: false, error: "email_required" };

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!user) return { ok: false, error: "user_not_found" };

  const houses = await prisma.houseAddress.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      esiid: true,
      isPrimary: true,
      addressLine1: true,
      addressCity: true,
      addressState: true,
    },
  });

  return {
    ok: true,
    email: String(user.email ?? email),
    userId: user.id,
    houses: houses.map((row) => ({
      id: row.id,
      esiid: row.esiid ? String(row.esiid) : null,
      isPrimary: row.isPrimary === true,
      label: buildHouseLabel({
        id: row.id,
        esiid: row.esiid ? String(row.esiid) : null,
        addressLine1: row.addressLine1,
        addressCity: row.addressCity,
        addressState: row.addressState,
      }),
      addressLine1: row.addressLine1,
      addressCity: row.addressCity,
      addressState: row.addressState,
    })),
  };
}

export async function resolveAdminHouseSelection(args: {
  email?: string | null;
  houseId?: string | null;
  esiid?: string | null;
}): Promise<AdminHouseLookupRow | null> {
  const houseId = String(args.houseId ?? "").trim();
  if (houseId) {
    const row = await prisma.houseAddress.findFirst({
      where: { id: houseId, archivedAt: null },
      select: {
        id: true,
        esiid: true,
        isPrimary: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      esiid: row.esiid ? String(row.esiid) : null,
      isPrimary: row.isPrimary === true,
      label: buildHouseLabel({
        id: row.id,
        esiid: row.esiid ? String(row.esiid) : null,
        addressLine1: row.addressLine1,
        addressCity: row.addressCity,
        addressState: row.addressState,
      }),
      addressLine1: row.addressLine1,
      addressCity: row.addressCity,
      addressState: row.addressState,
    };
  }

  const esiid = String(args.esiid ?? "").trim();
  if (esiid) {
    const row = await prisma.houseAddress.findFirst({
      where: { esiid, archivedAt: null },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        esiid: true,
        isPrimary: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      esiid: row.esiid ? String(row.esiid) : null,
      isPrimary: row.isPrimary === true,
      label: buildHouseLabel({
        id: row.id,
        esiid: row.esiid ? String(row.esiid) : null,
        addressLine1: row.addressLine1,
        addressCity: row.addressCity,
        addressState: row.addressState,
      }),
      addressLine1: row.addressLine1,
      addressCity: row.addressCity,
      addressState: row.addressState,
    };
  }

  const emailLookup = await lookupAdminHousesByEmail(String(args.email ?? ""));
  if (!emailLookup.ok) return null;
  return emailLookup.houses[0] ?? null;
}
