import { NextRequest, NextResponse } from 'next/server'
import { getFlags, setFlag, setFlags } from '@/lib/flags'

export const runtime = 'nodejs'

/**
 * GET  /api/admin/flags        -> all flags
 * POST /api/admin/flags        -> set multiple { key: value }
 * POST /api/admin/flags?key=K  -> set one (body: { value })
 */
export async function GET() {
  const flags = await getFlags()
  return NextResponse.json({ ok: true, flags })
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')
  const body = await req.json().catch(() => ({}))

  if (key) {
    if (typeof body?.value !== 'string') return NextResponse.json({ ok: false, error: 'value (string) required' }, { status: 400 })
    await setFlag(key, body.value)
    return NextResponse.json({ ok: true })
  } else {
    if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'JSON body required' }, { status: 400 })
    const kv: Record<string,string> = {}
    for (const [k,v] of Object.entries(body)) kv[String(k)] = String(v)
    await setFlags(kv)
    return NextResponse.json({ ok: true })
  }
}
