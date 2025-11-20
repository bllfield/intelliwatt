import type { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db';

export function cleanEsiid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  value = value.replace(/^'+/, '').replace(/'+$/, '').trim();
  if (!value) return null;
  return value;
}

export async function resolveSmtEsiid(opts: {
  prismaClient?: PrismaClient;
  explicitEsiid?: string | null;
  houseId?: string | null;
}): Promise<string | null> {
  const client = opts.prismaClient ?? prisma;

  const explicit = cleanEsiid(opts.explicitEsiid);
  if (explicit) return explicit;

  if (opts.houseId) {
    const address = await client.houseAddress.findFirst({
      where: { houseId: opts.houseId },
      select: { esiid: true },
    });
    const fromHouse = cleanEsiid(address?.esiid);
    if (fromHouse) return fromHouse;
  }

  const fallback = cleanEsiid(process.env.ESIID_DEFAULT ?? null);
  if (fallback && process.env.NODE_ENV !== 'production') {
    return fallback;
  }

  return null;
}

export function extractWattbuyEsiid(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  const candidates = new Set<string>();

  const addCandidate = (value: unknown) => {
    if (typeof value !== 'string') return;
    const cleaned = cleanEsiid(value);
    if (cleaned) candidates.add(cleaned);
  };

  addCandidate(record.esiid);
  addCandidate(record.esid);
  addCandidate(record.serviceId);

  if (record.service && typeof record.service === 'object') {
    addCandidate((record.service as Record<string, unknown>).esiid);
    addCandidate((record.service as Record<string, unknown>).esid);
  }

  const collectArray = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === 'object') {
          const obj = entry as Record<string, unknown>;
          addCandidate(obj.esiid);
          addCandidate(obj.esid);
        }
      }
    }
  };

  collectArray(record['results']);
  collectArray(record['plans']);
  collectArray(record['addresses']);
  collectArray(record['meters']);

  if (!candidates.size) return null;

  for (const candidate of Array.from(candidates)) {
    const digitsOnly = candidate.replace(/\D/g, '');
    if (digitsOnly.length >= 10) {
      return digitsOnly;
    }
  }

  return Array.from(candidates)[0] ?? null;
}
