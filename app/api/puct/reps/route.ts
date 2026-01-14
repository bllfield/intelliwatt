import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

  const repsRaw = await prisma.puctRep.findMany({
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

  return NextResponse.json({ ok: true, reps: out });
}

