import { NextRequest, NextResponse } from "next/server";

import { TdspTariffIngestRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  runPuctRateReportIngest,
  type PuctTdspIngestResult,
} from "@/scripts/tdsp/ingest-puct-rate-reports";

type Json = Record<string, any>;

function jsonError(status: number, error: string, meta?: Json) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(meta ?? {}),
    },
    { status },
  );
}

export const dynamic = "force-dynamic";

function getAdminToken(): string | null {
  return (
    process.env.TDSP_TARIFF_INGEST_ADMIN_TOKEN || process.env.ADMIN_TOKEN || null
  );
}

function isCronRequest(req: NextRequest): boolean {
  return !!req.headers.get("x-vercel-cron");
}

async function handleIngest(req: NextRequest, method: "GET" | "POST") {
  const cron = isCronRequest(req);
  const adminToken = getAdminToken();

  if (!cron) {
    if (!adminToken) {
      return jsonError(500, "TDSP_TARIFF_INGEST_ADMIN_TOKEN/ADMIN_TOKEN not configured");
    }

    const authHeader = req.headers.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;
    const headerToken = req.headers.get("x-admin-token")?.trim() || null;

    const token = bearer || headerToken;
    if (!token || token !== adminToken) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }
  }

  const now = new Date();

  const run = await (db as any).tdspTariffIngestRun.create({
    data: {
      startedAt: now,
      status: TdspTariffIngestRunStatus.PARTIAL,
      trigger: cron ? "VERCEL_CRON" : "ADMIN_API",
      sourceKind: "PUCT_RATE_REPORT_PDF",
    },
  });

  let results: PuctTdspIngestResult[] = [];
  let summary: {
    processedTdspCount: number;
    createdVersionCount: number;
    noopVersionCount: number;
    skippedTdspCount: number;
    errorTdspCount: number;
  };

  let finalStatus: TdspTariffIngestRunStatus =
    TdspTariffIngestRunStatus.ERROR;
  let errorMessage: string | null = null;

  try {
    const ingestResult = await runPuctRateReportIngest({ debugDate: false });
    results = ingestResult.results;
    summary = ingestResult.summary;

    if (
      summary.errorTdspCount === 0 &&
      summary.processedTdspCount > 0
    ) {
      finalStatus = TdspTariffIngestRunStatus.SUCCESS;
    } else if (summary.errorTdspCount >= summary.processedTdspCount) {
      finalStatus = TdspTariffIngestRunStatus.ERROR;
    } else {
      finalStatus = TdspTariffIngestRunStatus.PARTIAL;
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    errorMessage = msg.slice(0, 4000);
    finalStatus = TdspTariffIngestRunStatus.ERROR;
    results = [];
    summary = {
      processedTdspCount: 0,
      createdVersionCount: 0,
      noopVersionCount: 0,
      skippedTdspCount: 0,
      errorTdspCount: 0,
    };
  }

  const changes = results
    .filter((r) => r.action === "created" || r.action === "noop")
    .map((r) => ({
      tdspCode: r.tdspCode,
      action: r.action,
      effectiveStartISO: r.effectiveStartISO ?? null,
      versionId: r.versionId ?? null,
      sha256: r.sourceDocSha256 ?? null,
    }));

  const errors = results
    .filter((r) => r.action === "error")
    .map((r) => ({
      tdspCode: r.tdspCode,
      message: r.message ?? "Unknown ingest error",
    }));

  const finishedAt = new Date();

  await (db as any).tdspTariffIngestRun.update({
    where: { id: run.id },
    data: {
      finishedAt,
      status: finalStatus,
      processedTdspCount: summary.processedTdspCount,
      createdVersionCount: summary.createdVersionCount,
      noopVersionCount: summary.noopVersionCount,
      skippedTdspCount: summary.skippedTdspCount,
      errorTdspCount: summary.errorTdspCount,
      changesJson: changes,
      errorsJson: errors,
      logs:
        errorMessage ??
        `PUCT ingest: processed=${summary.processedTdspCount} created=${summary.createdVersionCount} noop=${summary.noopVersionCount} skipped=${summary.skippedTdspCount} errors=${summary.errorTdspCount}`,
    },
  });

  return NextResponse.json({
    ok: true,
    runId: run.id,
    status: finalStatus,
    summary,
    changes,
    errors,
  });
}

export async function POST(req: NextRequest) {
  return handleIngest(req, "POST");
}

export async function GET(req: NextRequest) {
  return handleIngest(req, "GET");
}


