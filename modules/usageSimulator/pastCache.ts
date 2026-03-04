/**
 * Persistent cache for Past simulated dataset. One canonical builder; avoid full rebuild on every GET.
 * Uses the usage DB (USAGE_DATABASE_URL); same DB as UsageShapeProfile and simulated usage buckets.
 */

import { createHash } from "crypto";
import { usagePrisma } from "@/lib/db/usageClient";

export const PAST_ENGINE_VERSION = "production_past_stitched_v1";

export type PastInputHashPayload = {
  engineVersion: string;
  windowStartUtc: string;
  windowEndUtc: string;
  timezone: string;
  travelRanges: Array<{ startDate: string; endDate: string }>;
  buildInputs: Record<string, unknown>;
};

/** Stable hash of buildInputs + travelRanges + timezone + window + engineVersion (base64url). */
export function computePastInputHash(payload: PastInputHashPayload): string {
  const canonical = {
    engineVersion: payload.engineVersion,
    windowStartUtc: payload.windowStartUtc,
    windowEndUtc: payload.windowEndUtc,
    timezone: payload.timezone,
    travelRanges: (payload.travelRanges ?? []).slice().sort((a, b) => {
      const sa = `${a.startDate}-${a.endDate}`;
      const sb = `${b.startDate}-${b.endDate}`;
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    }),
    buildInputsHash: stableHashObject(payload.buildInputs),
  };
  const json = JSON.stringify(canonical);
  const digest = createHash("sha256").update(json, "utf8").digest();
  return digest.toString("base64url").slice(0, 44);
}

function stableHashObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj ?? {}).sort();
  const reduced: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (k === "snapshots" && typeof v === "object" && v !== null) {
      reduced[k] = "(snapshots)";
      continue;
    }
    reduced[k] = v;
  }
  return createHash("sha256").update(JSON.stringify(reduced), "utf8").digest("hex").slice(0, 16);
}

export type CachedPastDataset = {
  datasetJson: Record<string, unknown>;
  intervalsCodec: string;
  intervalsCompressed: Buffer;
};

/** Guard: usage client may not have cache table (e.g. old generate or no USAGE_DATABASE_URL). */
function getCacheModel(): { findUnique: (args: any) => Promise<any>; upsert: (args: any) => Promise<any> } | null {
  try {
    const model = (usagePrisma as any).pastSimulatedDatasetCache;
    return model && typeof model.findUnique === "function" && typeof model.upsert === "function" ? model : null;
  } catch {
    return null;
  }
}

export async function getCachedPastDataset(args: {
  houseId: string;
  scenarioId: string;
  inputHash: string;
}): Promise<CachedPastDataset | null> {
  const model = getCacheModel();
  if (!model) return null;
  const row = await model
    .findUnique({
      where: {
        houseId_scenarioId_inputHash: {
          houseId: args.houseId,
          scenarioId: args.scenarioId,
          inputHash: args.inputHash,
        },
      },
      select: { datasetJson: true, intervalsCodec: true, intervalsCompressed: true },
    })
    .catch(() => null);
  if (!row?.datasetJson || !row?.intervalsCompressed) return null;
  return {
    datasetJson: row.datasetJson as Record<string, unknown>,
    intervalsCodec: String(row.intervalsCodec ?? ""),
    intervalsCompressed: Buffer.isBuffer(row.intervalsCompressed)
      ? row.intervalsCompressed
      : Buffer.from(row.intervalsCompressed),
  };
}

export async function saveCachedPastDataset(args: {
  houseId: string;
  scenarioId: string;
  inputHash: string;
  engineVersion: string;
  windowStartUtc: string;
  windowEndUtc: string;
  datasetJson: Record<string, unknown>;
  intervalsCodec: string;
  intervalsCompressed: Buffer;
}): Promise<void> {
  const model = getCacheModel();
  if (!model) return;
  try {
    await model.upsert({
      where: {
        houseId_scenarioId_inputHash: {
          houseId: args.houseId,
          scenarioId: args.scenarioId,
          inputHash: args.inputHash,
        },
      },
      create: {
        houseId: args.houseId,
        scenarioId: args.scenarioId,
        inputHash: args.inputHash,
        engineVersion: args.engineVersion,
        windowStartUtc: args.windowStartUtc,
        windowEndUtc: args.windowEndUtc,
        datasetJson: args.datasetJson,
        intervalsCodec: args.intervalsCodec,
        intervalsCompressed: args.intervalsCompressed,
      },
      update: {
        updatedAt: new Date(),
        datasetJson: args.datasetJson,
        intervalsCodec: args.intervalsCodec,
        intervalsCompressed: args.intervalsCompressed,
      },
    });
  } catch {
    // Cache unavailable (e.g. no USAGE_DATABASE_URL, table missing, or connection failed). Non-fatal.
  }
}
