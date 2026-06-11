import { NextRequest, NextResponse } from "next/server";
import { resolveExportDeploymentMetadata } from "@/lib/admin/exportDeploymentMetadata";
import { gateManualGapfillAdmin } from "@/app/api/admin/tools/manual-gapfill/_helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = gateManualGapfillAdmin(request);
  if (denied) return denied;

  const metadata = resolveExportDeploymentMetadata();
  return NextResponse.json({
    ok: true,
    ...metadata,
  });
}
