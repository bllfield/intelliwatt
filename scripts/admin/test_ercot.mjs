#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// Load .env.vercel if it exists
const envPath = resolve(process.cwd(), '.env.vercel')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const equalIndex = trimmed.indexOf('=')
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim()
        const value = trimmed.substring(equalIndex + 1).trim().replace(/^["']|["']$/g, '')
        if (key) process.env[key] = value
      }
    }
  }
}

try { await import('dotenv/config') } catch {}

const base = process.env.PROD_BASE_URL || 'https://intelliwatt.com'
const admin = process.env.ADMIN_TOKEN
const cron = process.env.CRON_SECRET

if (!admin) {
  console.error('Missing ADMIN_TOKEN')
  process.exit(1)
}

async function test(name, url, headers = {}) {
  try {
    const res = await fetch(url, { headers })
    const text = await res.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text.slice(0, 200) }
    }
    console.log(`\n=== ${name} [${res.status}] ===`)
    console.log(JSON.stringify(body, null, 2))
  } catch (e) {
    console.log(`\n=== ${name} ERROR ===`)
    console.log(e.message)
  }
}

await test('URL Sanity', `${base}/api/admin/ercot/debug/url-sanity`, { 'x-admin-token': admin })
await test('Ingests', `${base}/api/admin/ercot/ingests?limit=3`, { 'x-admin-token': admin })
await test('Debug Last', `${base}/api/admin/ercot/debug/last`, { 'x-admin-token': admin })
if (cron) {
  await test('Cron (header)', `${base}/api/admin/ercot/cron`, { 'x-cron-secret': cron })
  await test('Cron (query)', `${base}/api/admin/ercot/cron?token=${encodeURIComponent(cron)}`)
}

