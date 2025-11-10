import { readFile } from 'node:fs/promises'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

// heuristic parser that tolerates pipe/csv/tsv, tries to find an ESIID per line
function tokenize(line: string): string[] {
  if (line.includes('|')) return line.split('|')
  if (line.includes('\t')) return line.split('\t')
  return line.split(',')
}

function pickTdsp(hay: string) {
  const s = hay.toLowerCase()
  if (s.includes('oncor')) return 'oncor'
  if (s.includes('centerpoint')) return 'centerpoint'
  if (s.includes('aep') && s.includes('north')) return 'aep_north'
  if (s.includes('aep') && s.includes('central')) return 'aep_central'
  if (s.includes('tnmp') || s.includes('new mexico')) return 'tnmp'
  if (s.includes('mou')) return 'mou'
  if (s.includes('coop')) return 'coop'
  return 'unknown'
}

const ESIID_RE = /\b1\d{16,17}\b/ // 17-18 digits starting with 1

export async function ingestLocalFile(absPath: string, sha256: string, note?: string) {
  const buf = await readFile(absPath, 'utf8')
  const lines = buf.split(/\r?\n/).filter(Boolean)

  // idempotence: if we already processed this sha256, skip
  const existing = await db.ercotIngest.findUnique({ where: { fileSha256: sha256 } })
  if (existing) {
    return await db.ercotIngest.update({
      where: { id: existing.id },
      data: { status: 'skipped', note: note || existing.note },
    })
  }

  let rowCount = 0
  let tdspSeen: string | undefined

  const toUpsert: Prisma.ErcotEsiidIndexUpsertArgs[] = []

  for (const rawLine of lines) {
    const cols = tokenize(rawLine).map(c => c.trim())
    if (cols.length < 2) continue

    const joined = cols.join(' ')
    const esiidMatch = joined.match(ESIID_RE)
    if (!esiidMatch) continue

    const esiid = esiidMatch[0]
    // naive mapping for address-ish fields
    const addr = cols.find(c => /\d+ [\w\s.-]+/i.test(c)) || null
    const city = cols.find(c => /[A-Za-z\s]+,?\s*TX\b/i.test(c))?.replace(/,?\s*TX\b/i, '')?.trim() || null
    const zip = cols.find(c => /^\d{5}(-\d{4})?$/.test(c)) || null
    const tdspGuess = pickTdsp(joined)
    if (!tdspSeen && tdspGuess !== 'unknown') tdspSeen = tdspGuess

    toUpsert.push({
      where: { esiid },
      create: {
        esiid,
        serviceAddress1: addr || undefined,
        city: city || undefined,
        state: 'TX',
        zip: zip || undefined,
        tdsp: tdspGuess,
        raw: cols as unknown as Prisma.InputJsonValue,
        srcFileSha256: sha256,
      },
      update: {
        serviceAddress1: addr || undefined,
        city: city || undefined,
        state: 'TX',
        zip: zip || undefined,
        tdsp: tdspGuess,
        raw: cols as unknown as Prisma.InputJsonValue,
        srcFileSha256: sha256,
      },
    } as any)
  }

  // upsert in batches to avoid long transactions
  const batch = 1000
  for (let i = 0; i < toUpsert.length; i += batch) {
    const slice = toUpsert.slice(i, i + batch)
    await db.$transaction(
      slice.map(args => db.ercotEsiidIndex.upsert(args as any)),
      { timeout: 60000 }
    )
    rowCount += slice.length
  }

  return await db.ercotIngest.create({
    data: {
      status: 'ok',
      note,
      fileSha256: sha256,
      tdsp: tdspSeen,
      rowCount,
    },
  })
}
