import { PrismaClient } from '@prisma/client'

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
