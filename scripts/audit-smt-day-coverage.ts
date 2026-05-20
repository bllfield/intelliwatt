/**
 * Compare raw SmtInterval rows for one Chicago calendar day vs loadSmtDateCoverage() / ledger.
 * Use during SMT unification phases when slot counting or day status changes (see docs/SMT_UNIFICATION_PLAN.md).
 *
 * Usage: npx tsx scripts/audit-smt-day-coverage.ts <esiid> <dateKey>
 * Example: npx tsx scripts/audit-smt-day-coverage.ts 10400511114390001 2026-05-17
 */
import "dotenv/config";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local"), override: true });

import { prisma } from "@/lib/db";
import {
  addDateKeyDays,
  chicagoSlot96FromTs,
  loadSmtDateCoverage,
  missingChicagoSlotsFromFilledSlots,
  smtCoverageDateKey,
  SMT_TAIL_REQUIRED_INTERVALS_PER_DAY,
} from "@/lib/usage/smtTailCoverage";
import { loadSmtDayLedgerStatusForDate, reconcileSmtIntervalDayLedger } from "@/lib/usage/smtDayCoverageLedger";

const esiid = String(process.argv[2] ?? "10400511114390001").trim();
const dateKey = String(process.argv[3] ?? "2026-05-17").slice(0, 10);

function slotLabel(slot: number): string {
  const h = Math.floor(slot / 4);
  const m = (slot % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} CT (slot ${slot})`;
}

async function main() {
  if (!esiid || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    console.error("Usage: npx tsx scripts/audit-smt-day-coverage.ts <esiid> <YYYY-MM-DD>");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (check .env.local).");
    process.exit(1);
  }

  const startDate = addDateKeyDays(dateKey, -1);
  const endDate = addDateKeyDays(dateKey, 1);
  const rows = await prisma.smtInterval.findMany({
    where: {
      esiid,
      ts: {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      },
    },
    select: { ts: true, kwh: true, meter: true },
    orderBy: { ts: "asc" },
  });

  const onTargetDate = rows.filter((r) => smtCoverageDateKey(r.ts) === dateKey);
  const uniqueIso = new Set(onTargetDate.map((r) => r.ts.toISOString()));
  const slots = new Map<number, Array<{ ts: string; meter: string; kwh: string }>>();
  for (const r of onTargetDate) {
    const slot = chicagoSlot96FromTs(r.ts);
    if (slot == null) continue;
    const list = slots.get(slot) ?? [];
    list.push({
      ts: r.ts.toISOString(),
      meter: String(r.meter ?? ""),
      kwh: String(r.kwh ?? ""),
    });
    slots.set(slot, list);
  }
  const filledSlots = new Set(slots.keys());
  const missingSlots = missingChicagoSlotsFromFilledSlots(filledSlots);
  const duplicateSlots = [...filledSlots].filter((s) => (slots.get(s)?.length ?? 0) > 1);

  const coverage = await loadSmtDateCoverage({ esiid, dateKeys: [dateKey] });
  const ledgerStatus = await loadSmtDayLedgerStatusForDate({ esiid, dateKey });
  const ledger = await reconcileSmtIntervalDayLedger({ esiid }).catch(() => null);

  console.log("\n=== SMT day coverage audit ===\n");
  console.log("esiid:", esiid);
  console.log("dateKey (Chicago):", dateKey);
  console.log("query window UTC:", `${startDate} .. ${endDate}`);
  console.log("");
  console.log("--- Raw DB (rows with Chicago dateKey) ---");
  console.log("rowCount:", onTargetDate.length);
  console.log("uniqueTimestampCount (old method):", uniqueIso.size);
  console.log("distinctChicagoSlotCount (system method):", filledSlots.size);
  console.log("requiredSlotsPerDay:", SMT_TAIL_REQUIRED_INTERVALS_PER_DAY);
  console.log("missingSlots:", missingSlots.length ? missingSlots.map(slotLabel).join(", ") : "(none)");
  if (duplicateSlots.length) {
    console.log("duplicateSlots (multiple rows same slot):", duplicateSlots.join(", "));
    for (const slot of duplicateSlots.slice(0, 5)) {
      console.log(`  slot ${slot}:`, slots.get(slot));
    }
  }
  console.log("");
  console.log("--- loadSmtDateCoverage() ---");
  console.log("countsByDate:", coverage.countsByDate[dateKey]);
  console.log("missingSlotsByDate:", coverage.missingSlotsByDate[dateKey] ?? []);
  console.log("incomplete:", coverage.incompleteDateKeys.includes(dateKey));
  console.log("");
  console.log("--- Ledger ---");
  console.log("persistedStatus:", ledgerStatus ?? "(no row)");
  console.log("reconcile.byDate:", ledger?.byDate[dateKey] ?? "(n/a)");
  console.log("intervalCountAtLastCheck would use:", coverage.countsByDate[dateKey]);

  const spillover = rows
    .filter((r) => smtCoverageDateKey(r.ts) !== dateKey)
    .map((r) => ({
      chicagoDate: smtCoverageDateKey(r.ts),
      ts: r.ts.toISOString(),
      slot: chicagoSlot96FromTs(r.ts),
    }));
  if (spillover.length) {
    console.log("");
    console.log("--- Rows in query window but other Chicago dates (first 8) ---");
    spillover.slice(0, 8).forEach((r) => console.log(r));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
