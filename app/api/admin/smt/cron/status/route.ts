"use server";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { refreshSmtAuthorizationStatus } from "@/lib/smt/agreements";

export const dynamic = "force-dynamic";

const ADMIN_HEADER = "x-admin-token";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const BATCH_SIZE = 10;

type CronStatusFilter = "PENDING" | "ALL";

interface CronBody {
  limit?: number;
  status?: CronStatusFilter;
}

/**
 * POST /api/admin/smt/cron/status
 *
 * Protected admin endpoint intended for Vercel Cron (hourly) to refresh
 * SMT agreement status for pending authorizations. Requires x-admin-token.
 */
export async function POST(req: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;
  const providedToken = req.headers.get(ADMIN_HEADER);

  if (!adminToken || providedToken !== adminToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
        message: "Invalid or missing admin token.",
      },
      { status: 401 },
    );
  }

  let body: CronBody = {};
  try {
    const json = await req.json();
    if (json && typeof json === "object") {
      body = json as CronBody;
    }
  } catch {
    body = {};
  }

  const limit = Math.max(1, Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const statusFilter: CronStatusFilter = body.status ?? "PENDING";

  try {
    const where: Record<string, unknown> = {
      archivedAt: null,
    };

    if (statusFilter === "PENDING") {
      where.OR = [{ smtStatus: null }, { smtStatus: "PENDING" }];
    }

    const pending = await prisma.smtAuthorization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true },
    });

    let updated = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async ({ id }) => {
          try {
            const result = await refreshSmtAuthorizationStatus(id);
            if (result.ok) {
              updated += 1;
            } else {
              failed += 1;
            }
          } catch (error) {
            console.error("[SMT] cron status refresh error", { id, error });
            failed += 1;
          }
        }),
      );
    }

    return NextResponse.json(
      {
        ok: true,
        scanned: pending.length,
        updated,
        failed,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[SMT] /api/admin/smt/cron/status error", error);
    return NextResponse.json(
      {
        ok: false,
        error: "internal-error",
        message: "Failed to run SMT status cron.",
      },
      { status: 500 },
    );
  }
}


