import { prisma } from "@/lib/db";
import { aggregateMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return null;
}

function toIntOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

async function main() {
  const homeId = parseArg("homeId");
  const months = toIntOrNull(parseArg("months")) ?? 12;

  if (!homeId) {
    console.error("Usage: npx tsx scripts/usage/rebuild-core-buckets-for-home.ts --homeId=<id> [--months=12]");
    process.exit(1);
  }
  if (!(months > 0 && months <= 36)) {
    console.error("--months must be between 1 and 36");
    process.exit(1);
  }

  const home = await prisma.houseAddress.findUnique({
    where: { id: homeId },
    select: { id: true, esiid: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true },
  });

  if (!home) {
    console.error({ ok: false, error: "home_not_found", homeId });
    process.exit(1);
  }

  if (!home.esiid) {
    console.error({ ok: false, error: "home_missing_esiid", homeId, address: home.addressLine1 });
    process.exit(1);
  }

  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd);
  rangeStart.setMonth(rangeEnd.getMonth() - months);

  const res = await aggregateMonthlyBuckets({
    homeId: home.id,
    esiid: home.esiid,
    rangeStart,
    rangeEnd,
  });

  console.log({
    ok: true,
    homeId: home.id,
    esiid: home.esiid,
    months,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    ...res,
  });
}

main().catch((e: any) => {
  console.error({ ok: false, error: e?.message ?? String(e) });
  process.exit(1);
});


