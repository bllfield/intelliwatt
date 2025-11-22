#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { parse } from "csv-parse";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function getFilePathFromArgs() {
  const arg = process.argv.find((a) => a.startsWith("--file="));
  if (!arg) {
    console.error(
      'Usage: node scripts/admin/import_puct_reps_from_csv.mjs --file="./docs/PUCT NUMBER LISTS/rep.csv"',
    );
    console.error("Note: On Windows, CSVs are stored under the repo at:");
    console.error(
      "  C:\\Users\\bllfi\\Documents\\Intellipath Solutions\\Intelliwatt Website\\intelliwatt-clean\\docs\\PUCT NUMBER LISTS",
    );
    process.exit(1);
  }
  return arg.split("=")[1];
}

const filePath = getFilePathFromArgs();
const resolvedPath = path.resolve(process.cwd(), filePath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

console.log(`[PUCT_REP_IMPORT] Reading CSV from: ${resolvedPath}`);

async function parseCsv(file) {
  const records = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }),
      )
      .on("data", (row) => records.push(row))
      .on("error", (err) => reject(err))
      .on("end", () => resolve());
  });
  return records;
}

function pick(row, candidates) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key]) {
      return String(row[key]).trim();
    }
  }
  return "";
}

async function main() {
  const records = await parseCsv(resolvedPath);
  console.log(`[PUCT_REP_IMPORT] Parsed ${records.length} rows`);

  console.log("[PUCT_REP_IMPORT] Truncating existing PuctRep rows...");
  await prisma.puctRep.deleteMany({});

  let inserted = 0;
  let skipped = 0;

  for (const row of records) {
    const puctNumber = pick(row, [
      "CertNumber",
      "CertificateNumber",
      "REP",
      "Rep",
      "Cert Num",
      "CertNum",
    ]);
    const legalName = pick(row, [
      "CompanyName",
      "Name",
      "LegalName",
      "Company",
      "EntityName",
    ]);
    const dbaName = pick(row, ["DBA", "DbaName", "DBAName"]);
    const address1 = pick(row, ["Address1", "Address 1", "Street", "StreetAddress"]);
    const address2 = pick(row, ["Address2", "Address 2", "Suite"]);
    const city = pick(row, ["City"]);
    const state = pick(row, ["State", "ST"]);
    const postalCode = pick(row, ["Zip", "ZipCode", "PostalCode", "Zip Code"]);
    const phone = pick(row, ["Phone", "PhoneNumber", "Phone Number"]);
    const website = pick(row, ["Website", "WebSite", "URL"]);
    const email = pick(row, ["Email", "E-mail"]);

    if (!puctNumber || !legalName) {
      skipped++;
      continue;
    }

    const baseData = {
      dbaName: dbaName || null,
      address1: address1 || null,
      address2: address2 || null,
      city: city || null,
      state: state || null,
      postalCode: postalCode || null,
      phone: phone || null,
      website: website || null,
      email: email || null,
    };

    try {
      await prisma.puctRep.upsert({
        where: {
          puctNumber_legalName: {
            puctNumber,
            legalName,
          },
        },
        create: {
          puctNumber,
          legalName,
          ...baseData,
        },
        update: baseData,
      });
      inserted++;
    } catch (err) {
      console.error(
        `[PUCT_REP_IMPORT] Failed upsert for puctNumber=${puctNumber} legalName=${legalName}:`,
        err,
      );
    }
  }

  console.log(
    `[PUCT_REP_IMPORT] Done. Inserted=${inserted}, SkippedWithoutKeyFields=${skipped}`,
  );
}

main()
  .catch((err) => {
    console.error("[PUCT_REP_IMPORT] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

