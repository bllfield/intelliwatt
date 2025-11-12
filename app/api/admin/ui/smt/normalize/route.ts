import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

export async function POST(req: NextRequest) {
  try {
    const ADMIN_TOKEN = requireEnv("ADMIN_TOKEN");

    const url = new URL(req.url);
    const limit = url.searchParams.get("limit") ?? "5";
    const dryRun = url.searchParams.get("dryRun") ?? "";

    const baseUrl = requireEnv("PROD_BASE_URL") || "https://intelliwatt.com";
    const target = new URL(`/api/admin/smt/normalize`, baseUrl);
    target.searchParams.set("limit", limit);
    if (dryRun) target.searchParams.set("dryRun", dryRun);

    const res = await fetch(target.toString(), {
      method: "POST",
      headers: {
        "x-admin-token": ADMIN_TOKEN,
        "content-type": "application/json",
      },
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return NextResponse.json(
      { ok: res.ok, status: res.status, data },
      { status: res.status },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "UNKNOWN_ERROR" },
      { status: 500 },
    );
  }
}
