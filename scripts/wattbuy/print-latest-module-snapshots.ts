import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";

async function main() {
  const take = Number(process.argv.find((a) => a.startsWith("--take="))?.split("=")[1] ?? 10);

  const rows = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.findMany({
    orderBy: { fetchedAt: "desc" },
    take,
    select: {
      id: true,
      endpoint: true,
      fetchedAt: true,
      esiid: true,
      wattkey: true,
      houseAddressId: true,
      requestKey: true,
      payloadSha256: true,
    },
  });

  console.log({ ok: true, take, count: rows.length, rows });
}

main().catch((err) => {
  console.error("[print-latest-module-snapshots] failed:", err);
  process.exit(1);
});


