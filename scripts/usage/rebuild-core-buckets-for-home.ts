import { prisma } from "@/lib/db";
import { ensureCoreMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";
import { CORE_MONTHLY_BUCKETS, type UsageBucketDef } from "@/lib/plan-engine/usageBuckets";

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
  const overnight = (parseArg("overnight") ?? "").trim().toLowerCase(); // "", "start_day"

  if (!homeId) {
    console.error(
      "Usage: npx tsx scripts/usage/rebuild-core-buckets-for-home.ts --homeId=<id> [--months=12] [--overnight=start_day]",
    );
    process.exit(1);
  }
  if (!(months > 0 && months <= 36)) {
    console.error("--months must be between 1 and 36");
    process.exit(1);
  }
  if (overnight && overnight !== "start_day") {
    console.error("--overnight must be empty or start_day");
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

  const bucketDefs: UsageBucketDef[] =
    overnight === "start_day"
      ? CORE_MONTHLY_BUCKETS.map((b) => {
          if (!b?.key?.includes(".2000-0700")) return b;
          return {
            ...b,
            rule: { ...b.rule, overnightAttribution: "START_DAY" as const },
          };
        })
      : CORE_MONTHLY_BUCKETS;

  const res = await ensureCoreMonthlyBuckets({
    homeId: home.id,
    esiid: home.esiid,
    rangeStart,
    rangeEnd,
    source: "SMT",
    intervalSource: "SMT",
    bucketDefs,
  });

  console.log({
    ok: true,
    homeId: home.id,
    esiid: home.esiid,
    months,
    overnightAttribution: overnight === "start_day" ? "START_DAY" : "ACTUAL_DAY",
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    ...res,
  });
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error({ ok: false, error: msg });
  process.exit(1);
});


