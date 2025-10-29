import { NextResponse } from "next/server";

/**
 * GET /api/admin/smt/health
 * 
 * Public health check endpoint for SMT module.
 * Returns 200 OK if service is available.
 */
export async function GET() {
  return NextResponse.json({ ok: true, service: "smt" }, { status: 200 });
}

