import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";

const WEBHOOK_HEADERS = [
  "x-intelliwatt-secret",
  "x-droplet-webhook-secret",
  "x-smt-secret",
] as const;

type WebhookAuthResult =
  | { matched: true; header: string }
  | { matched: false; reason: string };

function usingWebhookSecret(req: NextRequest): WebhookAuthResult {
  const secret = (
    process.env.INTELLIWATT_WEBHOOK_SECRET ?? process.env.DROPLET_WEBHOOK_SECRET ?? ""
  ).trim();
  if (!secret) return { matched: false, reason: "SECRET_NOT_CONFIGURED" };
  for (const headerName of WEBHOOK_HEADERS) {
    const value = (req.headers.get(headerName) ?? "").trim();
    if (value && value === secret) {
      return { matched: true, header: headerName };
    }
  }
  return { matched: false, reason: "HEADER_MISSING" };
}

export async function GET(req: NextRequest) {
  const secretCheck = usingWebhookSecret(req);
  if (!secretCheck.matched) {
    const gate = requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }
  }

  const esiid = (req.nextUrl.searchParams.get("esiid") ?? "").trim();
  if (!esiid) {
    return NextResponse.json(
      { ok: false, error: "ESIID_REQUIRED" },
      { status: 400 },
    );
  }

  const prismaAny = prisma as any;
  const record = await prismaAny.smtMeterInfo.findFirst({
    where: { esiid },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      esiid: true,
      houseId: true,
      status: true,
      meterNumber: true,
      utilityMeterId: true,
      meterSerialNumber: true,
      updatedAt: true,
      createdAt: true,
      errorMessage: true,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      meterInfo: record ?? null,
    },
    { status: 200 },
  );
}

