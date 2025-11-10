import 'dotenv/config'
const base = process.env.PROD_BASE_URL || 'https://intelliwatt.com'
const res = await fetch(`${base}/api/admin/ercot/cron?token=${encodeURIComponent(process.env.CRON_SECRET || '')}`)
const text = await res.text()
console.log(`Status: ${res.status}\n${text}`)

