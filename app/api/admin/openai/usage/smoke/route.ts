import { NextRequest, NextResponse } from "next/server";

import { logOpenAIUsage } from "@/lib/admin/openaiUsage";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return NextResponse.json(
      { ok: false, error: "ADMIN_TOKEN not configured" },
      { status: 500 },
    );
  }

  const headerToken = req.headers.get("x-admin-token");
  if (!headerToken || headerToken !== adminToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // This intentionally logs a dummy event so we can verify that:
  // - Prisma can write OpenAIUsageEvent in the current runtime
  // - /admin/openai/usage reflects new rows (no caching surprises)
  await logOpenAIUsage({
    module: "admin",
    operation: "usage-smoke",
    model: "n/a",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    requestId: null,
    userId: null,
    houseId: null,
    metadata: {
      at: new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true });
}


