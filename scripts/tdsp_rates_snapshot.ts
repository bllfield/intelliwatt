// Usage: npx ts-node scripts/tdsp_rates_snapshot.ts
import 'dotenv/config'
import { fetchTdspJsonFromEnv, normalizeTdspMap, storeTdspSnapshot } from '@/lib/tdsp/fetch'

async function main() {
  try {
    const { url, data } = await fetchTdspJsonFromEnv()
    const norm = normalizeTdspMap(data)
    const res = await storeTdspSnapshot(url, norm)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, source: url, created: res.created.length }, null, 2))
    process.exit(0)
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ ok: false, error: e?.message ?? 'unknown' }, null, 2))
    process.exit(1)
  }
}
main()
