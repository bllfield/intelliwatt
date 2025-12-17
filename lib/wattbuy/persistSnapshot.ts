import crypto from "node:crypto";

import { prisma } from "@/lib/db";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";
import { extractEsiidDetails } from "@/lib/wattbuy/extractEsiid";

export type PersistWattBuySnapshotArgs = {
  endpoint: "ELECTRICITY" | "ELECTRICITY_INFO" | "OFFERS" | string;
  payload: unknown;
  houseAddressId?: string | null;
  esiid?: string | null;
  wattkey?: string | null;
  requestKey?: string | null;
};

function safeJsonStringify(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    // Best-effort: if payload can't be stringified, capture a sentinel
    return JSON.stringify({ __stringifyError: true });
  }
}

export async function persistWattBuySnapshot(
  args: PersistWattBuySnapshotArgs,
): Promise<void> {
  try {
    const fetchedAt = new Date();
    // Ensure JSONB NOT NULL constraints are always satisfied.
    const payloadForDb: unknown =
      args.payload === null || args.payload === undefined
        ? { __emptyPayload: true }
        : args.payload;

    const payloadStr = safeJsonStringify(payloadForDb);
    const payloadSha256 = crypto
      .createHash("sha256")
      .update(payloadStr, "utf8")
      .digest("hex");

    // Best-effort enrichment: if this looks like electricity/info payload, try to extract ESIID.
    let inferredEsiid: string | null = null;
    try {
      if (String(args.endpoint).toUpperCase() === "ELECTRICITY_INFO") {
        inferredEsiid = extractEsiidDetails(payloadForDb as any).esiid ?? null;
      }
    } catch {
      inferredEsiid = null;
    }

    // 1) Source of truth: WattBuy module DB
    try {
      await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.create({
        data: {
          fetchedAt,
          endpoint: String(args.endpoint),
          houseAddressId: args.houseAddressId ?? null,
          esiid: (args.esiid ?? inferredEsiid) ?? null,
          wattkey: args.wattkey ?? null,
          requestKey: args.requestKey ?? null,
          payloadJson: payloadForDb as any,
          payloadSha256,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[WATTBUY_SNAPSHOT] module persist failed:",
        err instanceof Error ? err.message : String(err),
      );
    }

    // 2) Optional dual-write to master DB (bridge / transitional only)
    if (process.env.WATTBUY_SNAPSHOT_DUALWRITE_MASTER === "1") {
      try {
        await (prisma as any).wattBuyApiSnapshot.create({
          data: {
            fetchedAt,
            endpoint: String(args.endpoint),
            houseAddressId: args.houseAddressId ?? null,
            esiid: (args.esiid ?? inferredEsiid) ?? null,
            wattkey: args.wattkey ?? null,
            requestKey: args.requestKey ?? null,
            payloadJson: payloadForDb as any,
            payloadSha256,
          },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[WATTBUY_SNAPSHOT] master dual-write failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } catch (err) {
    // Never block WattBuy flows on audit persistence failures.
    // eslint-disable-next-line no-console
    console.warn(
      "[WATTBUY_SNAPSHOT] persist failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}


