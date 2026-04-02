import { NextRequest, NextResponse } from "next/server";
import { resolveManualMonthlyLabHome } from "../../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function empty(source: "PREFILL" | "DEFAULT" | "UNKNOWN" = "UNKNOWN") {
  return { value: null, source };
}

export async function GET(request: NextRequest) {
  const ctx = await resolveManualMonthlyLabHome(request);
  if (!ctx.ok) return ctx.response;
  const { testHomeHouseId } = ctx;
  return NextResponse.json({
    ok: true,
    houseId: testHomeHouseId,
    prefill: {
      homeStyle: empty(),
      insulationType: empty(),
      windowType: empty(),
      foundation: empty(),
      squareFeet: empty(),
      stories: empty(),
      homeAge: empty(),
      hasPool: empty(),
      summerTemp: empty("DEFAULT"),
      winterTemp: empty("DEFAULT"),
    },
  });
}
