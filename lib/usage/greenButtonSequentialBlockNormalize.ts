import { DateTime } from "luxon";

import {
  createHomeIntervalCalendar,
  homeLocalSequentialSlotUtc,
  normalizeEnergyToKwh,
} from "@/lib/time/homeIntervalCalendar";
import type {
  GreenButton15MinInterval,
  GreenButtonNormalizeChunkProgress,
  GreenButtonNormalizeOptions,
  GreenButtonRawReading,
} from "@/lib/usage/greenButtonNormalize";
import type { GreenButtonParsedIntervalBlock } from "@/lib/usage/greenButtonParser";

const GREEN_BUTTON_HOME = createHomeIntervalCalendar("America/Chicago");

/** IntervalBlock interval start date label → Chicago local service calendar day. */
export function smtIntervalBlockServiceDateKey(blockStartEpochSeconds: number): string | null {
  if (!Number.isFinite(blockStartEpochSeconds)) return null;
  const dt = DateTime.fromSeconds(Math.trunc(blockStartEpochSeconds), { zone: "utc" });
  return dt.isValid ? dt.toFormat("yyyy-MM-dd") : null;
}

function readingToKwh(reading: GreenButtonRawReading): number | null {
  return normalizeEnergyToKwh(reading.value, reading.unit);
}

function blockToIntervals(block: GreenButtonParsedIntervalBlock): GreenButton15MinInterval[] {
  const out: GreenButton15MinInterval[] = [];
  for (let slotIndex = 0; slotIndex < block.readings.length; slotIndex += 1) {
    const reading = block.readings[slotIndex];
    if (!reading) continue;
    const kwh = readingToKwh(reading);
    if (kwh == null) continue;

    const timestamp = homeLocalSequentialSlotUtc(block.serviceDateKey, slotIndex, GREEN_BUTTON_HOME);
    if (!timestamp) continue;

    out.push({
      timestamp,
      consumptionKwh: kwh,
      intervalMinutes: 15,
      unit: "kWh",
    });
  }
  return out;
}

/** Sequential local-day slotting for SMT ESPI IntervalBlock exports (no epoch bucketing, no repair). */
export function normalizeGreenButtonIntervalBlocksTo15Min(
  blocks: GreenButtonParsedIntervalBlock[],
  _options?: GreenButtonNormalizeOptions,
): GreenButton15MinInterval[] {
  const results: GreenButton15MinInterval[] = [];
  for (const block of blocks) {
    results.push(...blockToIntervals(block));
  }
  results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return results;
}

export const GREEN_BUTTON_SEQUENTIAL_BLOCKS_PER_CHUNK = 50;

export function normalizeGreenButtonIntervalBlocksTo15MinChunked(
  blocks: GreenButtonParsedIntervalBlock[],
  options?: GreenButtonNormalizeOptions & {
    blocksPerChunk?: number;
    onChunkStart?: (progress: Pick<GreenButtonNormalizeChunkProgress, "chunkIndex" | "chunkCount" | "readingsInChunk">) => void;
    onChunkComplete?: (progress: GreenButtonNormalizeChunkProgress) => void;
  },
): GreenButton15MinInterval[] {
  const chunkSize = Math.max(1, options?.blocksPerChunk ?? GREEN_BUTTON_SEQUENTIAL_BLOCKS_PER_CHUNK);
  const chunkCount = Math.max(1, Math.ceil(blocks.length / chunkSize));
  const results: GreenButton15MinInterval[] = [];

  for (let offset = 0; offset < blocks.length; offset += chunkSize) {
    const chunk = blocks.slice(offset, offset + chunkSize);
    const chunkIndex = Math.floor(offset / chunkSize) + 1;
    const readingsInChunk = chunk.reduce((sum, block) => sum + block.readings.length, 0);
    options?.onChunkStart?.({ chunkIndex, chunkCount, readingsInChunk });
    const chunkStart = Date.now();
    for (const block of chunk) {
      results.push(...blockToIntervals(block));
    }
    options?.onChunkComplete?.({
      chunkIndex,
      chunkCount,
      readingsInChunk,
      ms: Date.now() - chunkStart,
      bucketsAfter: results.length,
    });
  }

  results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return results;
}
