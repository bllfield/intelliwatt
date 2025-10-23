import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { qaAnalyzePlans } from '@/lib/planmaster/qa'

const prisma = new PrismaClient()
export const runtime = 'nodejs'

/**
 * GET /api/admin/qa/master_plans?limit=50&tdsp=ONCOR
 * Returns recent MasterPlans plus computed QA flags.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)
  const tdsp = searchParams.get('tdsp') || undefined
  const supplier = searchParams.get('supplier') || undefined

  const where: any = {}
  if (tdsp) where.tdsp = tdsp as any
  if (supplier) where.supplierName = { contains: supplier, mode: 'insensitive' }

  const rows = await prisma.masterPlan.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      supplierName: true,
      planName: true,
      termMonths: true,
      tdsp: true,
      eflUrl: true,
      tosUrl: true,
      yracUrl: true,
      hasBillCredit: true,
      docs: true,
      rateModel: true
    }
  })

  const results = qaAnalyzePlans(rows as any)
  return NextResponse.json({ ok: true, count: rows.length, results })
}
