import { PrismaClient } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parse } from "csv-parse";
import { RepSearchBox } from "./RepSearchBox";

const prisma = new PrismaClient() as any;

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: {
    inserted?: string;
    skipped?: string;
    error?: string;
    search?: string;
  };
};

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = normalizeHeader(rawKey);
    if (!key) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function pickNormalized(row: Record<string, unknown>, candidates: string[]): string {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate) && row[candidate]) {
      return String(row[candidate]).trim();
    }
  }
  return "";
}

const CERT_NUMBER_HEADERS = [
  "certnumber",
  "certificatenumber",
  "rep",
  "cert num",
  "certnum",
  "puct",
  "puctnumber",
  "puct number",
  "primaryidno",
];

const LEGAL_NAME_HEADERS = ["companyname", "company name", "name", "legalname", "company", "entityname"];
const DBA_HEADERS = ["dba", "dbaname", "dba name"];
const ADDRESS1_HEADERS = ["address1", "address 1", "street", "streetaddress"];
const ADDRESS2_HEADERS = ["address2", "address 2", "suite", "address line 2"];
const CITY_HEADERS = ["city"];
const STATE_HEADERS = ["state", "st"];
const POSTAL_CODE_HEADERS = ["zip", "zipcode", "postalcode", "zip code"];
const PHONE_HEADERS = ["phone", "phonenumber", "phone number"];
const WEBSITE_HEADERS = ["website", "web site", "url"];
const EMAIL_HEADERS = ["email", "e-mail", "email address"];

async function importPuctRepsFromFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const records = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
    parse(
      buffer,
      {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      },
      (err, parsed) => {
        if (err) {
          reject(err);
        } else {
          resolve(parsed as Record<string, unknown>[]);
        }
      },
    );
  });

  await prisma.puctRep.deleteMany({});

  let inserted = 0;
  let skipped = 0;

  for (const row of records) {
    const normalizedRow = normalizeRow(row);

    const puctNumber = pickNormalized(normalizedRow, CERT_NUMBER_HEADERS);
    const legalName = pickNormalized(normalizedRow, LEGAL_NAME_HEADERS);
    const dbaName = pickNormalized(normalizedRow, DBA_HEADERS);
    const address1 = pickNormalized(normalizedRow, ADDRESS1_HEADERS);
    const address2 = pickNormalized(normalizedRow, ADDRESS2_HEADERS);
    const city = pickNormalized(normalizedRow, CITY_HEADERS);
    const state = pickNormalized(normalizedRow, STATE_HEADERS);
    const postalCode = pickNormalized(normalizedRow, POSTAL_CODE_HEADERS);
    const phone = pickNormalized(normalizedRow, PHONE_HEADERS);
    const website = pickNormalized(normalizedRow, WEBSITE_HEADERS);
    const email = pickNormalized(normalizedRow, EMAIL_HEADERS);

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
  }

  return { inserted, skipped };
}

export default async function PuctRepImportPage({ searchParams }: PageProps) {
  const insertedParam = searchParams?.inserted;
  const skippedParam = searchParams?.skipped;
  const errorParam = searchParams?.error;
  const searchTerm = searchParams?.search?.trim() ?? "";

  let searchResults: any[] = [];
  if (searchTerm) {
    searchResults = await prisma.puctRep.findMany({
      where: {
        OR: [
          { puctNumber: { contains: searchTerm, mode: "insensitive" } },
          { legalName: { contains: searchTerm, mode: "insensitive" } },
          { dbaName: { contains: searchTerm, mode: "insensitive" } },
        ],
      },
      orderBy: [{ legalName: "asc" }],
      take: 50,
    });
  }

  const inserted = insertedParam ? Number(insertedParam) : null;
  const skipped = skippedParam ? Number(skippedParam) : null;
  const errorMessage = errorParam ? decodeURIComponent(errorParam) : null;

  async function uploadAction(formData: FormData) {
    "use server";

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      redirect("/admin/puct/reps?error=CSV%20file%20is%20required");
    }

    try {
      const { inserted, skipped } = await importPuctRepsFromFile(file as File);
      revalidatePath("/admin/puct/reps");
      redirect(`/admin/puct/reps?inserted=${inserted}&skipped=${skipped}`);
    } catch (err) {
      console.error("[PUCT_REP_IMPORT] Upload failed:", err);
      redirect("/admin/puct/reps?error=Import%20failed%2C%20see%20logs%20for%20details");
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-8">
      <h1 className="text-2xl font-semibold text-brand-navy">PUCT REP Directory Import</h1>
      <p className="text-sm text-brand-navy/70">
        Upload the latest PUCT Retail Electric Provider (REP) CSV. This replaces the existing
        directory with the contents of the uploaded file. The canonical CSV exports live in{" "}
        <code className="rounded bg-brand-navy/5 px-1 py-0.5">
          docs/PUCT NUMBER LISTS/rep.csv
        </code>{" "}
        (Windows path{" "}
        <code className="rounded bg-brand-navy/5 px-1 py-0.5">
          C:\Users\bllfi\Documents\Intellipath Solutions\Intelliwatt Website\intelliwatt-clean\docs\PUCT NUMBER LISTS
        </code>
        ).
      </p>

      {errorMessage ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {inserted !== null ? (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          Import complete. Inserted {inserted} records
          {skipped !== null ? `; skipped ${skipped} rows missing certificate or legal name.` : "."}
        </div>
      ) : null}

      <form
        action={uploadAction}
        className="space-y-4 rounded-lg border border-brand-blue/20 bg-brand-white p-6 shadow-lg"
        encType="multipart/form-data"
      >
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-2">
            PUCT REP CSV file
          </label>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-sm text-brand-navy"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center rounded-md border border-brand-blue bg-brand-blue/10 px-3 py-1.5 text-sm font-medium text-brand-navy transition hover:bg-brand-blue/20"
        >
          Upload &amp; Replace REP Directory
        </button>
      </form>

      <div className="rounded-md border border-brand-blue/10 bg-brand-blue/5 p-4 text-xs text-brand-navy/70">
        <p className="font-semibold mb-1">CLI alternative</p>
        <p>
          <code className="rounded bg-brand-navy/5 px-1 py-0.5">
            node scripts/admin/import_puct_reps_from_csv.mjs --file="./docs/PUCT NUMBER LISTS/rep.csv"
          </code>
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-brand-blue/20 bg-brand-white p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-brand-navy">Search REP Directory</h2>
        <RepSearchBox initialValue={searchTerm} />

        {searchTerm ? (
          <div className="space-y-3">
            <p className="text-sm text-brand-navy/70">
              Showing up to 50 results for <span className="font-medium">{searchTerm}</span>.{" "}
              {searchResults.length === 0 ? "No matches found." : `${searchResults.length} match(es) found.`}
            </p>
            {searchResults.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-brand-blue/10">
                <table className="min-w-full text-sm text-left text-brand-navy">
                  <thead className="bg-brand-blue/10 text-xs uppercase tracking-wide text-brand-navy/70">
                    <tr>
                      <th className="px-3 py-2">PUCT #</th>
                      <th className="px-3 py-2">Legal Name</th>
                      <th className="px-3 py-2">DBA</th>
                      <th className="px-3 py-2">City</th>
                      <th className="px-3 py-2">State</th>
                      <th className="px-3 py-2">Phone</th>
                      <th className="px-3 py-2">Website</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((rep) => (
                      <tr key={rep.id} className="border-t border-brand-blue/10 odd:bg-brand-blue/5">
                        <td className="px-3 py-2 font-medium">{rep.puctNumber}</td>
                        <td className="px-3 py-2">{rep.legalName}</td>
                        <td className="px-3 py-2">{rep.dbaName || "—"}</td>
                        <td className="px-3 py-2">{rep.city || "—"}</td>
                        <td className="px-3 py-2">{rep.state || "—"}</td>
                        <td className="px-3 py-2">{rep.phone || "—"}</td>
                        <td className="px-3 py-2">
                          {rep.website ? (
                            <a
                              href={rep.website.startsWith("http") ? rep.website : `https://${rep.website}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand-blue underline"
                            >
                              Website
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

