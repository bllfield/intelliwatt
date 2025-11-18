import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isAdminAuthorized(req: NextRequest): boolean {
  const adminToken = process.env.ADMIN_TOKEN;
  const headerToken = req.headers.get("x-admin-token");
  return Boolean(adminToken && headerToken && headerToken === adminToken);
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
      },
      { status: 401 },
    );
  }

  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limitValue = limitParam ? parseInt(limitParam, 10) : undefined;
    const limit = limitValue && Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 50;

    const items = await prisma.smtAuthorization.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json(
      {
        ok: true,
        count: items.length,
        items,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[ADMIN_SMT_AUTH_LIST_ERROR]", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to list SMT authorizations.",
      },
      { status: 500 },
    );
  }
}

