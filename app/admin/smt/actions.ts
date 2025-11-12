'use server';

import { headers } from 'next/headers';

function resolveBaseUrl() {
  const explicit = process.env.ADMIN_INTERNAL_BASE_URL
    ?? process.env.NEXT_PUBLIC_BASE_URL
    ?? process.env.PROD_BASE_URL
    ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?? '';

  if (explicit) {
    try {
      return new URL(explicit.startsWith('http') ? explicit : `https://${explicit}`);
    } catch {
      // fall through to host-based resolution below
    }
  }

  const incomingHeaders = headers();
  const host = incomingHeaders.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return new URL(`${protocol}://${host}`);
}

export async function normalizeLatestServerAction(limit = 5) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error('ADMIN_TOKEN is not configured on the server');
  }

  const baseUrl = resolveBaseUrl();
  const url = new URL(`/api/admin/smt/normalize?limit=${encodeURIComponent(Math.max(1, limit))}`, baseUrl);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken,
      'content-type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Normalize failed: ${res.status} ${text}`.trim());
  }

  return res.json();
}
