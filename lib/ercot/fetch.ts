import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'

export async function fetchToTmp(url: string, userAgent?: string) {
  const res = await fetch(url, {
    headers: userAgent ? { 'user-agent': userAgent } : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`Fetch failed ${res.status}: ${text.slice(0, 500)}`)
    ;(err as any).status = res.status
    throw err
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
  const tmpPath = `/tmp/ercot_${sha256}.txt`
  await fs.writeFile(tmpPath, buf)
  // capture a few headers
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v
  })
  return { tmpPath, sha256, headers }
}

