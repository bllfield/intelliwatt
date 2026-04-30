import { NextRequest, NextResponse } from "next/server";
import { resolveOnePathWriteTarget } from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const houseId = String(url.searchParams.get("houseId") ?? "").trim();
  if (!houseId) return NextResponse.json({ ok: false, error: "house_required" }, { status: 400 });
  const target = await resolveOnePathWriteTarget({ request, requestedHouseId: houseId });
  if (!target.ok) return target.response;
  return NextResponse.json({
    ok: true,
    houseId: target.testHomeHouseId,
    prefill: {
      homeStyle: { value: null, source: "UNKNOWN" },
      insulationType: { value: null, source: "UNKNOWN" },
      windowType: { value: null, source: "UNKNOWN" },
      foundation: { value: null, source: "UNKNOWN" },
      squareFeet: { value: null, source: "UNKNOWN" },
      stories: { value: null, source: "UNKNOWN" },
      homeAge: { value: null, source: "UNKNOWN" },
      hasPool: { value: null, source: "UNKNOWN" },
      summerTemp: { value: null, source: "UNKNOWN" },
      winterTemp: { value: null, source: "UNKNOWN" },
    },
  });
}
