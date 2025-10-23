/**
 * TDSP retail delivery charges — light-weight, pluggable fetcher.
 * Start with a curated JSON feed (TDSP_RATE_JSON_URL). Later you can add scrapers.
 *
 * Expected JSON (per TDSP):
 * {
 *   "ONCOR":    { "effectiveAt": "2025-09-01", "monthlyFeeCents": 395, "deliveryCentsPerKwh": 3.287, "notes": "TCRF incl." },
 *   "CENTERPOINT": { ...same keys... },
 *   "AEP_NORTH":   { ... },
 *   "AEP_CENTRAL": { ... },
 *   "TNMP":        { ... }
 * }
 *
 * - monthlyFeeCents: TDSP fixed customer charge (¢) per month
 * - deliveryCentsPerKwh: TDSP volumetric delivery (¢/kWh)
 * - notes: optional string
 */
import { PrismaClient, TdspCode } from '@prisma/client'

const prisma = new PrismaClient()

export type TdspDelivery = {
  effectiveAt?: string
  monthlyFeeCents: number
  deliveryCentsPerKwh: number
  notes?: string
}

export type TdspDeliveryMap = Partial<Record<keyof typeof TdspCode, TdspDelivery>> & {
  ONCOR?: TdspDelivery
  CENTERPOINT?: TdspDelivery
  AEP_NORTH?: TdspDelivery
  AEP_CENTRAL?: TdspDelivery
  TNMP?: TdspDelivery
}

function assertPositiveNumber(n: unknown, field: string) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid ${field}: ${n}`)
  }
}

export async function fetchTdspJsonFromEnv(): Promise<{ url: string; data: TdspDeliveryMap }> {
  const url = process.env.TDSP_RATE_JSON_URL
  if (!url) throw new Error('TDSP_RATE_JSON_URL not set')
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`TDSP JSON fetch failed: ${res.status}`)
  const data = await res.json()
  return { url, data }
}

export function normalizeTdspMap(raw: any): TdspDeliveryMap {
  const map: TdspDeliveryMap = {}
  const keys: Array<keyof TdspDeliveryMap> = ['ONCOR','CENTERPOINT','AEP_NORTH','AEP_CENTRAL','TNMP']
  for (const k of keys) {
    if (!raw?.[k]) continue
    const item = raw[k]
    assertPositiveNumber(item.monthlyFeeCents, `${k}.monthlyFeeCents`)
    assertPositiveNumber(item.deliveryCentsPerKwh, `${k}.deliveryCentsPerKwh`)
    const eff = typeof item.effectiveAt === 'string' ? item.effectiveAt : undefined
    map[k] = {
      effectiveAt: eff,
      monthlyFeeCents: item.monthlyFeeCents,
      deliveryCentsPerKwh: item.deliveryCentsPerKwh,
      notes: typeof item.notes === 'string' ? item.notes : undefined
    }
  }
  return map
}

/**
 * Store one row per TDSP for this snapshot.
 */
export async function storeTdspSnapshot(sourceUrl: string, map: TdspDeliveryMap) {
  const keys = Object.keys(map) as (keyof TdspDeliveryMap)[]
  const created: string[] = []
  for (const k of keys) {
    const v = map[k]
    if (!v) continue
    const tdsp = k as unknown as TdspCode
    const effectiveAt = v.effectiveAt ? new Date(v.effectiveAt) : null
    const row = await prisma.tdspRateSnapshot.create({
      data: {
        tdsp,
        sourceUrl: sourceUrl,
        payload: v as any,
        effectiveAt: effectiveAt ?? undefined
      }
    })
    created.push(row.id)
  }
  return { created }
}

/**
 * Convenience: latest snapshot per TDSP.
 */
export async function getLatestTdspSnapshots(tdsp?: TdspCode) {
  if (tdsp) {
    const row = await prisma.tdspRateSnapshot.findFirst({
      where: { tdsp },
      orderBy: { createdAt: 'desc' }
    })
    return row ? [row] : []
  }
  // grab latest per-tdsp via distinct on id (two queries for portability)
  const tdspList: TdspCode[] = ['ONCOR','CENTERPOINT','AEP_NORTH','AEP_CENTRAL','TNMP'] as TdspCode[]
  const results = await Promise.all(tdspList.map(t =>
    prisma.tdspRateSnapshot.findFirst({ where: { tdsp: t }, orderBy: { createdAt: 'desc' } })
  ))
  return results.filter(Boolean)
}
