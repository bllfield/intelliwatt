import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { saveMeterInfoFromDroplet } from "@/lib/smt/meterInfo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
  const secretCheck = usingWebhookSecret(req);
  if (!secretCheck.matched) {
    const gate = requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }
  }

  if (!(req.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return NextResponse.json({ ok: false, error: "EXPECTED_JSON" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  if (!body || typeof body.esiid !== "string" || !body.esiid.trim()) {
    return NextResponse.json({ ok: false, error: "ESIID_REQUIRED" }, { status: 400 });
  }

  try {
    const record = await saveMeterInfoFromDroplet(body);
    return NextResponse.json(
      {
        ok: true,
        meterInfoId: record.id,
        status: record.status,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[SMT] /api/admin/smt/meter-info failed", err);
    return NextResponse.json(
      { ok: false, error: "SAVE_FAILED", message: "Failed to persist meter info" },
      { status: 500 },
    );
  }
}

