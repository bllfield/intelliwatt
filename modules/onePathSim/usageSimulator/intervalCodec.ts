/**
 * v1_delta_varint: compress 15-min interval arrays for cache/storage.
 * Sort by timestamp; first ts as int32 (unix seconds), then delta-seconds (varint) + kwh scaled * 1000 (varint).
 * 0.001 kWh resolution; deltas compress well (900s typical).
 */

export const INTERVAL_CODEC_V1 = "v1_delta_varint";
const KWH_SCALE = 1000; // 0.001 kWh resolution
const MAX_KWH_SCALED = 65535; // clamp to fit uint16 range for varint
export const INTERVAL_CODEC_KWH_RESOLUTION = 1 / KWH_SCALE;

function writeVarint(buf: number[], v: number): void {
  let n = Math.floor(v);
  if (n < 0) n = 0;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    buf.push(byte);
  } while (n !== 0);
}

function readVarint(buf: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = offset;
  while (i < buf.length) {
    const byte = buf[i++]!;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: i };
    shift += 7;
    if (shift > 28) break;
  }
  return { value, next: i };
}

function writeInt32LE(buf: number[], v: number): void {
  const x = Math.floor(v);
  buf.push(x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff);
}

function readInt32LE(buf: Buffer, offset: number): number {
  return (
    (buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16) | (buf[offset + 3]! << 24)) >>>
    0
  );
}

export function encodeIntervalsV1(
  intervals: Array<{ timestamp: string; kwh: number }>
): { codec: typeof INTERVAL_CODEC_V1; bytes: Buffer } {
  const sorted = [...intervals].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const out: number[] = [];
  let prevTs = 0;
  for (let i = 0; i < sorted.length; i++) {
    const ts = new Date(sorted[i]!.timestamp).getTime();
    const sec = Math.round(ts / 1000);
    const kwh = quantizeIntervalKwhForCodec(sorted[i]!.kwh);
    const scaled = Math.min(MAX_KWH_SCALED, Math.round(kwh * KWH_SCALE));
    if (i === 0) {
      writeInt32LE(out, sec);
      prevTs = sec;
    } else {
      const delta = sec - prevTs;
      writeVarint(out, delta >= 0 ? delta : 0);
      prevTs = sec;
    }
    writeVarint(out, scaled);
  }
  return { codec: INTERVAL_CODEC_V1, bytes: Buffer.from(out) };
}

/** Quantize one interval to codec precision/clamp semantics (same as encode path). */
export function quantizeIntervalKwhForCodec(kwh: number): number {
  const kwhRaw = Math.max(0, Number(kwh) || 0);
  const rounded = Math.round(kwhRaw * KWH_SCALE) / KWH_SCALE;
  const scaled = Math.min(MAX_KWH_SCALED, Math.round(rounded * KWH_SCALE));
  return scaled / KWH_SCALE;
}

/**
 * Codec-derived total drift tolerance for aggregate comparisons:
 *  - per-interval rounding error is modeled as uniform[-q/2, q/2], q=resolution
 *  - stddev(sum) = q * sqrt(N / 12)
 *  - tolerance uses sigmaMultiplier * stddev plus 0.01 kWh aggregate display rounding floor
 */
export function deriveCodecTotalDriftToleranceKwh(args: {
  intervalCount: number;
  sigmaMultiplier?: number;
}): number {
  const n = Math.max(0, Math.floor(Number(args.intervalCount) || 0));
  const sigmaMultiplier = Number.isFinite(Number(args.sigmaMultiplier))
    ? Math.max(1, Number(args.sigmaMultiplier))
    : 4;
  if (n <= 0) return 0.01;
  const stddev = INTERVAL_CODEC_KWH_RESOLUTION * Math.sqrt(n / 12);
  const rawTol = sigmaMultiplier * stddev;
  const withFloor = Math.max(0.01, rawTol);
  return Math.round(withFloor * 10000) / 10000;
}

export function decodeIntervalsV1(
  bytes: Buffer
): Array<{ timestamp: string; kwh: number }> {
  if (bytes.length < 4) return [];
  const out: Array<{ timestamp: string; kwh: number }> = [];
  let offset = 0;
  let prevTs = 0;
  let i = 0;
  while (offset < bytes.length) {
    if (i === 0) {
      prevTs = readInt32LE(bytes, offset);
      offset += 4;
    } else {
      const { value: delta, next } = readVarint(bytes, offset);
      offset = next;
      prevTs += delta;
    }
    if (offset >= bytes.length) break;
    const { value: scaled, next } = readVarint(bytes, offset);
    offset = next;
    const kwh = scaled / KWH_SCALE;
    const ts = new Date(prevTs * 1000).toISOString();
    out.push({ timestamp: ts, kwh });
    i++;
  }
  return out;
}

