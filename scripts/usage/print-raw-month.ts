/**
 * Print ground-truth raw usage for a single month from SmtInterval (Chicago month).
 * Use to verify which displayed value is correct when Usage / Simulated / Past disagree.
 *
 * Usage: npx tsx scripts/usage/print-raw-month.ts <email|esiid|homeId> [yearMonth]
 * Example: npx tsx scripts/usage/print-raw-month.ts silvabreg@yahoo.com 2026-02
 * Example: npx tsx scripts/usage/print-raw-month.ts 10443720001101972 2026-02
 */

import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getRawMonthKwhFromSmt } from "@/lib/usage/rawMonthFromSmt";

function cleanEsiid(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").trim();
  return digits.length >= 17 ? digits : null;
}

async function resolveHouse(identifier: string): Promise<{ homeId: string; esiid: string } | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  // Email: resolve user -> first house with esiid (primary first)
  if (trimmed.includes("@")) {
    const email = normalizeEmailSafe(trimmed);
    if (!email) return null;
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return null;
    const house = await (prisma as any).houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, NOT: { esiid: null } },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
      select: { id: true, esiid: true },
    });
    if (!house?.esiid) return null;
    return { homeId: house.id, esiid: String(house.esiid) };
  }

  // ESIID (long numeric string)
  const esiid = cleanEsiid(trimmed);
  if (esiid) {
    const house = await prisma.houseAddress.findFirst({
      where: { esiid, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, esiid: true },
    });
    if (!house?.esiid) return null;
    return { homeId: house.id, esiid: String(house.esiid) };
  }

  // homeId (UUID)
  const house = await prisma.houseAddress.findFirst({
    where: { id: trimmed, archivedAt: null },
    select: { id: true, esiid: true },
  });
  if (!house?.esiid) return null;
  return { homeId: house.id, esiid: String(house.esiid) };
}

async function main() {
  const identifier = process.argv[2]?.trim();
  const yearMonth = process.argv[3]?.trim() ?? "2026-02";

  if (!identifier) {
    console.error("Usage: npx tsx scripts/usage/print-raw-month.ts <email|esiid|homeId> [yearMonth]");
    console.error("Example: npx tsx scripts/usage/print-raw-month.ts silvabreg@yahoo.com 2026-02");
    console.error("Example: npx tsx scripts/usage/print-raw-month.ts 10443720001101972 2026-02");
    process.exit(1);
  }

  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    console.error("yearMonth must be YYYY-MM (e.g. 2026-02)");
    process.exit(1);
  }

  const house = await resolveHouse(identifier);
  if (!house) {
    console.error({
      ok: false,
      error: "user_or_house_not_found",
      identifier: identifier.includes("@") ? "(email)" : identifier,
      message: "No user with that email, or no house with that esiid/homeId, or house has no esiid.",
    });
    process.exit(1);
  }

  const raw = await getRawMonthKwhFromSmt({ esiid: house.esiid, yearMonth });
  if (!raw) {
    console.log(
      JSON.stringify({
        yearMonth,
        homeId: house.homeId,
        esiid: house.esiid,
        resolvedFrom: identifier.includes("@") ? "email" : cleanEsiid(identifier) ? "esiid" : "homeId",
        raw: null,
        message: "No intervals for this month",
      })
    );
    process.exit(0);
  }

  console.log(
    JSON.stringify(
      {
        yearMonth,
        homeId: house.homeId,
        esiid: house.esiid,
        resolvedFrom: identifier.includes("@") ? "email" : cleanEsiid(identifier) ? "esiid" : "homeId",
        raw,
      },
      null,
      2
    )
  );
  console.error(
    `\nGround truth for ${yearMonth}: netKwh = ${raw.netKwh} (import ${raw.importKwh}, export ${raw.exportKwh}), ${raw.intervalCount} intervals`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});