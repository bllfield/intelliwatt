import 'dotenv/config'
const base = process.env.PROD_BASE_URL || 'https://intelliwatt.com'
const url = process.env.ERCOT_TEST_URL || process.env.ERCOT_DAILY_URL
const admin = process.env.ADMIN_TOKEN
if (!admin) throw new Error('Missing ADMIN_TOKEN in env')
if (!url) throw new Error('Set ERCOT_TEST_URL or ERCOT_DAILY_URL')
const res = await fetch(`${base}/api/admin/ercot/fetch-latest?url=${encodeURIComponent(url)}&notes=daily`, {
  headers: { 'x-admin-token': admin },
})
const text = await res.text()
console.log(`Status: ${res.status}\n${text}`)

