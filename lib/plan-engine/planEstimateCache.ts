import crypto from "node:crypto";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";

const ENDPOINT = "PLAN_ENGINE_ESTIMATE_V1";

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function getCachedPlanEstimate(args: {
  houseAddressId: string;
  ratePlanId: string;
  inputsSha256: string;
  monthsCount: number;
  endpoint?: string;
}): Promise<any | null> {
  const houseAddressId = String(args.houseAddressId ?? "").trim();
  const ratePlanId = String(args.ratePlanId ?? "").trim();
  const inputsSha256 = String(args.inputsSha256 ?? "").trim();
  const monthsCount = Math.max(1, Math.floor(Number(args.monthsCount ?? 12) || 12));
  const endpoint = String(args.endpoint ?? ENDPOINT).trim() || ENDPOINT;
  if (!houseAddressId || !ratePlanId || !inputsSha256) return null;

  const requestKey = `plan_estimate|ratePlanId=${ratePlanId}|months=${monthsCount}`;
  try {
    const row = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.findFirst({
      where: {
        endpoint,
        houseAddressId,
        requestKey,
        payloadSha256: inputsSha256,
      },
      orderBy: { createdAt: "desc" },
      select: { payloadJson: true },
    });
    return row?.payloadJson ?? null;
  } catch {
    return null;
  }
}

export async function putCachedPlanEstimate(args: {
  houseAddressId: string;
  ratePlanId: string;
  esiid?: string | null;
  inputsSha256: string;
  monthsCount: number;
  payloadJson: any;
  endpoint?: string;
}): Promise<void> {
  const houseAddressId = String(args.houseAddressId ?? "").trim();
  const ratePlanId = String(args.ratePlanId ?? "").trim();
  const inputsSha256 = String(args.inputsSha256 ?? "").trim();
  const monthsCount = Math.max(1, Math.floor(Number(args.monthsCount ?? 12) || 12));
  const endpoint = String(args.endpoint ?? ENDPOINT).trim() || ENDPOINT;
  if (!houseAddressId || !ratePlanId || !inputsSha256) return;

  const requestKey = `plan_estimate|ratePlanId=${ratePlanId}|months=${monthsCount}`;
  try {
    await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.create({
      data: {
        endpoint,
        houseAddressId,
        esiid: args.esiid ? String(args.esiid) : null,
        requestKey,
        payloadJson: args.payloadJson ?? null,
        payloadSha256: inputsSha256,
      },
    });
  } catch {
    // best-effort only
  }
}


