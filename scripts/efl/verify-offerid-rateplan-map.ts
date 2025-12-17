import { prisma } from "@/lib/db";

async function main() {
  const offerIds = process.argv.slice(2).filter(Boolean);
  if (!offerIds.length) {
    console.error(
      "Usage: npx tsx scripts/efl/verify-offerid-rateplan-map.ts <offerId> [offerId2 ...]",
    );
    process.exit(2);
  }

  const rows = await (prisma as any).offerIdRatePlanMap.findMany({
    where: { offerId: { in: offerIds } },
    select: {
      offerId: true,
      ratePlanId: true,
      linkedBy: true,
      lastLinkedAt: true,
      createdAt: true,
      updatedAt: true,
      notes: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const found = new Set(rows.map((r: any) => String(r.offerId)));
  const missing = offerIds.filter((id) => !found.has(String(id)));

  console.log({
    ok: true,
    inputOfferIds: offerIds,
    foundCount: rows.length,
    missing,
    rows,
  });
}

main().catch((err) => {
  console.error("[verify-offerid-rateplan-map] failed:", err);
  process.exit(1);
});


