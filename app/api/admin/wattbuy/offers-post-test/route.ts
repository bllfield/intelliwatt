import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/admin";
import { composeWattbuyAddress, formatUnitForWattbuy } from "@/lib/wattbuy/formatAddress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiKey(): string {
  const key = (process.env.WATTBUY_API_KEY ?? "").trim();
  if (!key) throw new Error("WATTBUY_API_KEY is not set");
  return key;
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const { searchParams } = new URL(req.url);
    const addressRaw = (searchParams.get("address") ?? "").trim();
    const unitRaw = (searchParams.get("unit") ?? searchParams.get("line2") ?? "").trim();
    const city = (searchParams.get("city") ?? "").trim();
    const state = (searchParams.get("state") ?? "").trim();
    const zip = (searchParams.get("zip") ?? "").trim();

    const language = (searchParams.get("language") ?? "en").trim();
    const all = (searchParams.get("all") ?? "true").trim().toLowerCase() === "true";
    const is_renter = (searchParams.get("is_renter") ?? "false").trim().toLowerCase() === "true";

    if (!addressRaw || !city || !state || !zip) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_params",
          message: "Provide address, city, state, zip (and optionally unit, is_renter, all).",
        },
        { status: 400 },
      );
    }

    const compositeAddress = composeWattbuyAddress(addressRaw, unitRaw);
    const formattedUnit = formatUnitForWattbuy(unitRaw);

    const body = {
      address: compositeAddress || addressRaw,
      city,
      state,
      zip,
      language,
      all,
      is_renter,
    };

    const res = await fetch("https://apis.wattbuy.com/v3/offers", {
      method: "POST",
      headers: {
        "x-api-key": apiKey(),
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return NextResponse.json(
      {
        ok: res.ok,
        status: res.status,
        where: { address: compositeAddress || addressRaw, unit: formattedUnit ?? null, city, state, zip },
        request: body,
        data,
        textPreview: data ? undefined : String(text ?? "").slice(0, 500),
      },
      { status: res.status },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "OFFERS_POST_TEST_ERROR", message: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}

