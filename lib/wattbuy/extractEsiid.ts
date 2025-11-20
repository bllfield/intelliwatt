import { cleanEsiid } from '@/lib/smt/esiid';

const ESIID_KEYS = ['esiid', 'esiId', 'esi_id', 'ESIID', 'ESI_ID', 'esi'];
const UTILITY_KEYS = [
  'utility_name',
  'utilityName',
  'utility',
  'name',
  'company_name',
  'companyName',
];
const TERRITORY_KEYS = ['tdsp', 'tdsp_name', 'tdspSlug', 'territory', 'utility_territory'];

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectChildren(value: unknown): unknown[] {
  if (!isObjectLike(value)) return [];
  if (Array.isArray(value)) return value;
  return Object.values(value);
}

function findFirstString(target: unknown, keys: string[], maxDepth = 4): string | null {
  if (!isObjectLike(target)) return null;

  const queue: Array<{ node: unknown; depth: number }> = [{ node: target, depth: 0 }];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;

    if (!isObjectLike(node) || visited.has(node)) continue;
    visited.add(node);

    for (const key of keys) {
      const value = (node as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    if (depth >= maxDepth) continue;

    for (const child of collectChildren(node)) {
      queue.push({ node: child, depth: depth + 1 });
    }
  }

  return null;
}

export function extractEsiidDetails(electricityInfo: unknown): {
  esiid: string | null;
  utility: string | null;
  territory: string | null;
} {
  if (!isObjectLike(electricityInfo)) {
    return { esiid: null, utility: null, territory: null };
  }

  const esiid = findFirstString(electricityInfo, ESIID_KEYS);
  const utility = findFirstString(electricityInfo, UTILITY_KEYS);
  const territory = findFirstString(electricityInfo, TERRITORY_KEYS);

  return { esiid: cleanEsiid(esiid), utility, territory };
}


