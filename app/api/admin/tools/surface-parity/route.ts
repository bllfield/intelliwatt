import { NextRequest, NextResponse } from "next/server";
import { runSurfaceParityAuditForEmail } from "@/lib/usage/surfaceParityAudit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email : "";
    const houseId = typeof body?.houseId === "string" ? body.houseId : null;
    const result = await runSurfaceParityAuditForEmail({ email, houseId });
    const status = result.error === "email_required" ? 400 : result.error ? 404 : 200;
    return NextResponse.json(result, { status });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "surface_parity_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
