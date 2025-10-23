import { NextResponse } from 'next/server'
import { modulesCatalog } from '@/lib/catalog/modules'

export const runtime = 'nodejs'

/**
 * GET /api/admin/modules
 * Returns the catalog of modules with metadata.
 */
export async function GET() {
  return NextResponse.json({ ok: true, modules: modulesCatalog })
}
