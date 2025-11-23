import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  const rawQuery = searchParams.get("q") ?? "";
  const query = rawQuery.trim();

  const limitParam = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const take = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT, 1), MAX_LIMIT);

  const where =
    query.length > 0
      ? {
          OR: [
            { legalName: { contains: query, mode: "insensitive" as const } },
            { dbaName: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : undefined;

  const reps = await prisma.puctRep.findMany({
    where,
    select: {
      id: true,
      puctNumber: true,
      legalName: true,
      dbaName: true,
    },
    orderBy: { legalName: "asc" },
    take,
  });

  return NextResponse.json({ ok: true, reps });
}

