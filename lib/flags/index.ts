import { PrismaClient } from '@prisma/client'
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

const prisma = new PrismaClient()
type Cache = { data: Record<string,string>, ts: number }
let cache: Cache = { data: {}, ts: 0 }
const TTL_MS = 30_000

function bootstrapFromEnv(): Record<string,string> {
  try {
    const raw = process.env.FEATURE_FLAGS_BOOTSTRAP
    if (!raw) return {}
    const obj = JSON.parse(raw)
    const kv: Record<string,string> = {}
    for (const [k,v] of Object.entries(obj)) kv[k] = String(v)
    return kv
  } catch { return {} }
}

async function loadAll(): Promise<Record<string,string>> {
  const rows = await prisma.featureFlag.findMany()
  const merged = { ...bootstrapFromEnv() }
  for (const r of rows) merged[r.key] = r.value
  return merged
}

export async function getFlags(): Promise<Record<string,string>> {
  const now = Date.now()
  if (now - cache.ts < TTL_MS && Object.keys(cache.data).length) return cache.data
  const data = await loadAll()
  cache = { data, ts: now }
  return data
}

export async function getFlag(key: string): Promise<string | undefined> {
  return (await getFlags())[key]
}

export async function flagBool(key: string, def = false): Promise<boolean> {
  const v = await getFlag(key)
  if (v == null) return def
  return ['1','true','yes','on'].includes(String(v).toLowerCase())
}

export async function flagPercent(key: string, def?: number): Promise<number | undefined> {
  const v = await getFlag(key)
  if (v == null) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

export async function setFlag(key: string, value: string) {
  await prisma.featureFlag.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  })
  cache = { data: {}, ts: 0 } // bust cache
}

export async function setFlags(kv: Record<string,string>) {
  const ops = Object.entries(kv).map(([key, value]) =>
    prisma.featureFlag.upsert({ where: { key }, update: { value }, create: { key, value } })
  )
  await Promise.all(ops)
  cache = { data: {}, ts: 0 }
}

/**
 * Synchronous feature flag helper for environment-based flags.
 * Use this for flags that don't require database lookups.
 * 
 * Dual flag system:
 * - Async flags (flagBool, getFlag): Database-backed with caching
 * - Sync flags (flagBoolSync, flags): Environment variable based
 */
export function flagBoolSync(value: string | undefined, defaultVal = false): boolean {
  if (value == null) return defaultVal;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Typed feature flags for common integrations and settings.
 * These are environment-based and available synchronously.
 */
export const flags = {
  // Integration flags (client-accessible via NEXT_PUBLIC_)
  wattbuyEnabled: flagBoolSync(process.env.NEXT_PUBLIC_FLAG_WATTBUY, false),
  smtEnabled: flagBoolSync(process.env.NEXT_PUBLIC_FLAG_SMT, false),
  greenButtonEnabled: flagBoolSync(process.env.NEXT_PUBLIC_FLAG_GREENBUTTON, false),

  // Server-only flags
  strictPIILogging: flagBoolSync(process.env.FLAG_STRICT_PII_LOGGING, true),
} as const;

export const wattbuyEsiidDisabled =
  process.env.WATTBUY_ESIID_DISABLED?.toLowerCase() !== 'false';