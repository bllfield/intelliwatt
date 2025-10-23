import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

type AuditEvent = 'shown' | 'selected'

export async function logOffersShown(
  plans: { id: string; supplierName: string; planName: string; tdsp: string }[],
  userKey?: string,
  metadata?: Record<string, any>
) {
  if (!plans.length) return
  await prisma.offerAudit.createMany({
    data: plans.map(p => ({
      event: 'shown' as AuditEvent,
      planId: p.id,
      supplierName: p.supplierName,
      planName: p.planName,
      tdsp: p.tdsp,
      userKey,
      metadata
    }))
  })
}

export async function logOfferSelected(
  plan: { id: string; supplierName: string; planName: string; tdsp: string },
  userKey?: string,
  metadata?: Record<string, any>
) {
  await prisma.offerAudit.create({
    data: {
      event: 'selected',
      planId: plan.id,
      supplierName: plan.supplierName,
      planName: plan.planName,
      tdsp: plan.tdsp,
      userKey,
      metadata
    }
  })
}

export async function listAudits({ limit = 50 }: { limit?: number }) {
  return prisma.offerAudit.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit
  })
}
