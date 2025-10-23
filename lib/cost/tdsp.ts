import { PrismaClient, TdspCode } from '@prisma/client'
import { TdspDelivery } from './types'

const prisma = new PrismaClient()

/**
 * Lookup latest TDSP snapshot at/before the billing period (or just latest if none have effectiveAt).
 */
export async function getTdspForPeriod(tdsp: TdspCode, at: Date): Promise<TdspDelivery | null> {
  // Prefer effectiveAt <= at; fallback to most recent createdAt.
  const row =
    (await prisma.tdspRateSnapshot.findFirst({
      where: { tdsp, effectiveAt: { lte: at } },
      orderBy: { effectiveAt: 'desc' }
    })) ||
    (await prisma.tdspRateSnapshot.findFirst({
      where: { tdsp },
      orderBy: { createdAt: 'desc' }
    }))
  if (!row) return null
  const p = row.payload as any
  return {
    monthlyFeeCents: Number(p?.monthlyFeeCents || 0),
    deliveryCentsPerKwh: Number(p?.deliveryCentsPerKwh || 0),
    effectiveAt: p?.effectiveAt,
    notes: p?.notes
  }
}
