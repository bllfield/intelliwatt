#!/usr/bin/env node
/**
 * Debug script to inspect SMT interval data for a specific ESIID
 * Usage: node scripts/debug-esiid.mjs <ESIID>
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const ESIID = process.argv[2] || "10443720004895510";

async function main() {
  console.log(`\n=== Debugging ESIID: ${ESIID} ===\n`);

  // Check master SmtInterval table
  const masterCount = await prisma.smtInterval.count({ where: { esiid: ESIID } });
  console.log(`✓ Master SmtInterval count: ${masterCount}`);

  if (masterCount > 0) {
    const latest = await prisma.smtInterval.findFirst({
      where: { esiid: ESIID },
      orderBy: { ts: "desc" },
      select: { ts: true, kwh: true, meter: true, source: true },
    });
    console.log(`  Latest interval: ${JSON.stringify(latest)}`);

    const summary = await prisma.smtInterval.aggregate({
      where: { esiid: ESIID },
      _count: { _all: true },
      _sum: { kwh: true },
      _min: { ts: true },
      _max: { ts: true },
    });
    console.log(`  Summary: ${JSON.stringify(summary, null, 2)}`);
  } else {
    console.log(`  ⚠️  NO intervals found for this ESIID!`);
  }

  // Check RawSmtFile (all recent files, not filtered by ESIID)
  const rawFiles = await prisma.rawSmtFile.findMany({
    select: { id: true, filename: true, sha256: true, received_at: true, source: true },
    orderBy: { received_at: "desc" },
    take: 5,
  });
  console.log(`\n✓ Recent RawSmtFile entries (last 5): ${rawFiles.length}`);
  if (rawFiles.length > 0) {
    console.log("  Recent files:");
    rawFiles.forEach((f) => {
      console.log(`    - ${f.filename} (${f.source}) received: ${f.received_at}`);
    });
  }

  // Check SmtAuthorization for this ESIID
  const auths = await prisma.smtAuthorization.findMany({
    where: { esiid: ESIID },
    select: { id: true, userId: true, smtStatus: true, smtStatusMessage: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`\n✓ SmtAuthorization count for ESIID: ${auths.length}`);
  if (auths.length > 0) {
    auths.forEach((a) => {
      console.log(`  - Status: ${a.smtStatus} Message: ${a.smtStatusMessage}`);
    });
  }

  console.log("\nDone.\n");
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
