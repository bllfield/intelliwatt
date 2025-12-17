import { prisma } from "@/lib/db";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";

type Row = {
  id: string;
  endpoint: string;
  fetchedAt: Date;
  houseAddressId: string | null;
  esiid: string | null;
  wattkey: string | null;
  requestKey: string | null;
  payloadJson: unknown;
  payloadSha256: string;
};

async function main() {
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 200);
  const dry = process.argv.includes("--dry");

  if (process.env.WATTBUY_SNAPSHOT_DUALWRITE_MASTER === "1") {
    console.log({
      ok: true,
      skipped: true,
      reason: "WATTBUY_SNAPSHOT_DUALWRITE_MASTER=1 (master already receiving snapshots)",
    });
    return;
  }

  const rows: Row[] = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.findMany({
    orderBy: { fetchedAt: "desc" },
    take: limit,
    select: {
      id: true,
      endpoint: true,
      fetchedAt: true,
      houseAddressId: true,
      esiid: true,
      wattkey: true,
      requestKey: true,
      payloadJson: true,
      payloadSha256: true,
    },
  });

  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const r of rows) {
    processed++;
    try {
      // Best-effort dedupe in master by payloadSha256 + endpoint + wattkey/esiid.
      const existing = await (prisma as any).wattBuyApiSnapshot.findFirst({
        where: {
          payloadSha256: r.payloadSha256,
          endpoint: r.endpoint,
          ...(r.wattkey ? { wattkey: r.wattkey } : {}),
          ...(r.esiid ? { esiid: r.esiid } : {}),
        },
        select: { id: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      if (!dry) {
        await (prisma as any).wattBuyApiSnapshot.create({
          data: {
            fetchedAt: r.fetchedAt,
            endpoint: r.endpoint,
            houseAddressId: r.houseAddressId,
            esiid: r.esiid,
            wattkey: r.wattkey,
            requestKey: r.requestKey,
            payloadJson: r.payloadJson as any,
            payloadSha256: r.payloadSha256,
          },
        });
      }

      inserted++;
    } catch (e) {
      errors++;
      console.error("[map-snapshots-to-master] row failed:", {
        endpoint: r.endpoint,
        fetchedAt: r.fetchedAt,
        payloadSha256: r.payloadSha256,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  console.log({ ok: true, dry, processed, inserted, skipped, errors });
}

main().catch((err) => {
  console.error("[map-snapshots-to-master] failed:", err);
  process.exit(1);
});


