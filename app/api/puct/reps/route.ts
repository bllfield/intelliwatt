import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
// We want the REP dropdown to be able to show the full list (small enough in practice).
// Keep a safety cap anyway.
const MAX_LIMIT = 2000;

function normKey(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const WEBSITE_ALIAS_RULES: Array<{ needle: string; label: string; key: string }> = [
  // U.S. Retailers, LLC markets Discount Power via discountpowertx.com.
  { needle: "discountpower", label: "Discount Power", key: "discountpower" },
  { needle: "cirroenergy", label: "Cirro Energy", key: "cirroenergy" },
];

// Some brand relationships are not reliably represented in PUCT legalName/dbaName fields.
// Encode a small, explicit map so the dropdown is usable even if website is missing/blank.
const PUCT_NUMBER_ALIASES: Record<string, string[]> = {
  // US RETAILERS LLC / Cirro Energy also sells as Discount Power (discountpowertx.com).
  "10177": ["Discount Power"],
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  const rawQuery = searchParams.get("q") ?? "";
  const query = rawQuery.trim();
  const queryKey = normKey(query);

  const limitParam = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const take = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT, 1), MAX_LIMIT);

  const where =
    query.length > 0
      ? {
          OR: [
            { legalName: { contains: query, mode: "insensitive" as const } },
            { dbaName: { contains: query, mode: "insensitive" as const } },
            { puctNumber: { contains: query } },
            { website: { contains: query, mode: "insensitive" as const } },
            // If the user types a well-known brand name (e.g. "Discount Power") that may not appear
            // in legalName/dbaName, match by website keywords so the REP can still be found.
            ...(queryKey.includes("discountpower")
              ? [{ website: { contains: "discountpower", mode: "insensitive" as const } }]
              : []),
          ],
        }
      : undefined;

  const repsBase = await prisma.puctRep.findMany({
    where,
    select: {
      id: true,
      puctNumber: true,
      legalName: true,
      dbaName: true,
      website: true,
    },
    orderBy: { legalName: "asc" },
    take,
  });

  // IMPORTANT:
  // The client dropdown often requests `limit=200` with no `q`. That means many relevant REPs
  // (including ones customers expect by brand name) may not appear purely due to alphabetical truncation.
  // To make key brands discoverable, we union in a small "extras" set (still read-only) before aliasing.
  const repsExtras =
    query.length === 0
      ? await prisma.puctRep.findMany({
          where: {
            OR: [
              // Discount Power / Cirro (US Retailers). Customers often search by brand, but legalName is far down.
              { puctNumber: "10177" },
              { legalName: { contains: "US RETAILERS", mode: "insensitive" as const } },
              { dbaName: { contains: "CIRRO", mode: "insensitive" as const } },
              { website: { contains: "discountpower", mode: "insensitive" as const } },
            ],
          },
          select: {
            id: true,
            puctNumber: true,
            legalName: true,
            dbaName: true,
            website: true,
          },
          take: 20,
        })
      : [];

  const repsRaw = (() => {
    const merged: Array<(typeof repsBase)[number]> = [];
    const seen = new Set<string>();
    const add = (rows: any[]) => {
      for (const r of rows ?? []) {
        const id = String((r as any)?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(r);
      }
    };
    add(repsBase as any);
    add(repsExtras as any);
    return merged;
  })();

  // Add alias entries so customers can find the REP by either the legal entity name
  // or the marketed brand name (e.g., "Discount Power" vs "U.S. Retailers, LLC").
  const out: Array<{ id: string; puctNumber: string; legalName: string; dbaName: string | null }> = [];
  const seen = new Set<string>();

  const push = (row: { id: string; puctNumber: string; legalName: string; dbaName: string | null }) => {
    const key = `${row.puctNumber}|${row.legalName}|${row.dbaName ?? ""}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };

  for (const r of repsRaw) {
    const base = {
      id: r.id,
      puctNumber: r.puctNumber,
      legalName: r.legalName,
      dbaName: r.dbaName ?? null,
    };
    push(base);

    const website = typeof r.website === "string" ? r.website : "";
    const websiteKey = normKey(website);

    // Explicit aliasing by PUCT number (always-on for known brands).
    const explicit = PUCT_NUMBER_ALIASES[String(r.puctNumber ?? "")] ?? [];
    for (const label of explicit) {
      const aliasLabel = String(label).trim();
      if (!aliasLabel) continue;
      const aliasKey = normKey(aliasLabel);
      const legalKey = normKey(r.legalName);
      const dbaKey = r.dbaName ? normKey(r.dbaName) : "";

      if (aliasKey && aliasKey !== legalKey && aliasKey !== dbaKey) {
        push({
          id: `alias:${r.puctNumber}:${aliasKey}:brand`,
          puctNumber: r.puctNumber,
          legalName: aliasLabel,
          dbaName: `${r.legalName}${r.dbaName ? ` (${r.dbaName})` : ""}`,
        });
      }

      if (aliasKey && !dbaKey.includes(aliasKey)) {
        push({
          id: `alias:${r.puctNumber}:${aliasKey}:legal`,
          puctNumber: r.puctNumber,
          legalName: r.legalName,
          dbaName: `${aliasLabel}${r.dbaName ? ` (${r.dbaName})` : ""}`,
        });
      }
    }

    for (const rule of WEBSITE_ALIAS_RULES) {
      const hasByWebsite = websiteKey.includes(rule.needle);
      const hasByNames =
        normKey(r.legalName).includes(rule.key) || (r.dbaName ? normKey(r.dbaName).includes(rule.key) : false);
      if (!hasByWebsite && !hasByNames) continue;

      const aliasLabel = rule.label;
      const aliasKey = normKey(aliasLabel);
      const legalKey = normKey(r.legalName);
      const dbaKey = r.dbaName ? normKey(r.dbaName) : "";

      // Alias A: start with brand label (for alphabetical discoverability)
      if (aliasKey && aliasKey !== legalKey && aliasKey !== dbaKey) {
        push({
          id: `alias:${r.puctNumber}:${rule.key}:brand`,
          puctNumber: r.puctNumber,
          legalName: aliasLabel,
          dbaName: `${r.legalName}${r.dbaName ? ` (${r.dbaName})` : ""}`,
        });
      }

      // Alias B: keep legal entity name but include the brand label in the parentheses
      if (aliasKey && !dbaKey.includes(aliasKey)) {
        push({
          id: `alias:${r.puctNumber}:${rule.key}:legal`,
          puctNumber: r.puctNumber,
          legalName: r.legalName,
          dbaName: `${aliasLabel}${r.dbaName ? ` (${r.dbaName})` : ""}`,
        });
      }
    }
  }

  out.sort((a, b) => a.legalName.localeCompare(b.legalName, "en", { sensitivity: "base" }));

  return NextResponse.json({
    ok: true,
    reps: out,
    meta: {
      query: query.length ? query : null,
      limitRequested: Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT,
      returned: out.length,
      // Helps confirm which deployment is serving traffic.
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    },
  });
}

