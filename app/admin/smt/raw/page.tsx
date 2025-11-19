import { headers } from "next/headers";
import BillingReadsTable from "@/components/admin/smt/BillingReadsTable";
import { prisma } from "@/lib/db";
import { NormalizeLatestButton } from "@/components/admin/smt/NormalizeLatestButton";
import AdminSmtRawClient from "./RawClient";
import ManualUploadForm from "./ManualUploadForm";

export const dynamic = "force-dynamic";

function resolveBaseUrl() {
  const explicit =
    process.env.ADMIN_INTERNAL_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.PROD_BASE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    "";

  if (explicit) {
    try {
      return new URL(explicit.startsWith("http") ? explicit : `https://${explicit}`);
    } catch {
      // fall through and try to resolve from incoming headers instead
    }
  }

  const incoming = headers();
  const host = incoming.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return new URL(`${protocol}://${host}`);
}

type PageProps = {
  searchParams: { [key: string]: string | string[] | undefined };
};

type BillingReadRecord = {
  id: string;
  esiid: string;
  meter: string | null;
  tdspCode: string | null;
  tdspName: string | null;
  readStart: Date | null;
  readEnd: Date | null;
  billDate: Date | null;
  kwhTotal: number | null;
  kwhBilled: number | null;
  source: string | null;
  rawSmtFileId: bigint | null;
};

export default async function AdminSmtRawPage({ searchParams }: PageProps) {
  async function normalizeLatestAction(payload: { esiid?: string }) {
    "use server";

    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      throw new Error("ADMIN_TOKEN is not configured on the server.");
    }

    const baseUrl = resolveBaseUrl();
    const body: { latest: true; esiid?: string } = { latest: true };
    if (payload?.esiid) {
      body.esiid = payload.esiid;
    }

    const response = await fetch(new URL("/api/admin/smt/normalize", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": adminToken,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await response.text();
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Normalize endpoint returned non-JSON response (HTTP ${response.status}).`);
      }
    }

    if (!response.ok || json?.ok === false) {
      const detail = json?.error || json?.message;
      throw new Error(detail ? `Normalize failed: ${detail}` : `Normalize failed (HTTP ${response.status}).`);
    }

    return json;
  }

  const esiidFilter =
    typeof searchParams?.esiid === "string" ? searchParams.esiid.trim() : "";
  const limitParam =
    typeof searchParams?.limit === "string"
      ? parseInt(searchParams.limit, 10)
      : NaN;
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 500)
      : 100;

  const billingWhere = esiidFilter ? { esiid: esiidFilter } : {};

  const billingReadsRaw = (await (prisma as any).smtBillingRead.findMany({
    where: billingWhere,
    orderBy: [{ billDate: "desc" }, { readStart: "desc" }],
    take: limit,
  })) as BillingReadRecord[];

  const billingReads = billingReadsRaw.map((row) => ({
    id: row.id,
    esiid: row.esiid,
    meter: row.meter ?? null,
    tdspCode: row.tdspCode ?? null,
    tdspName: row.tdspName ?? null,
    readStart: row.readStart ? row.readStart.toISOString() : null,
    readEnd: row.readEnd ? row.readEnd.toISOString() : null,
    billDate: row.billDate ? row.billDate.toISOString() : null,
    kwhTotal: row.kwhTotal ?? null,
    kwhBilled: row.kwhBilled ?? null,
    source: row.source ?? null,
    rawSmtFileId: row.rawSmtFileId ? row.rawSmtFileId.toString() : null,
  }));

  return (
    <div className="space-y-10 pb-10">
      <ManualUploadForm />
      <NormalizeLatestButton action={normalizeLatestAction} />
      <AdminSmtRawClient />
      <section className="mt-10 space-y-4">
        <h2 className="text-lg font-semibold">SMT Billing Reads (Admin)</h2>
        <p className="text-sm text-muted-foreground">
          Latest billing-level SMT reads pulled via /api/admin/smt/pull. Filter by ESIID or adjust the row limit to inspect specific meters.
        </p>
        <BillingReadsTable
          initialEsiid={esiidFilter}
          initialLimit={limit}
          rows={billingReads}
        />
      </section>
    </div>
  );
}

