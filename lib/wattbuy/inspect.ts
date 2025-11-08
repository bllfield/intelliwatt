// lib/wattbuy/inspect.ts

export type InspectResult = {
  topType: string;                 // 'array' | 'object' | 'null' | 'string' | ...
  topKeys?: string[];              // if object
  foundListPath?: string;          // e.g., 'rates' or '(root)'
  count: number;
  sample?: any[];
  message?: string;
};

/**
 * Find the first obvious array of items in a WattBuy retail-rates payload.
 */
export function inspectRetailRatesPayload(payload: any): InspectResult {
  const type = getType(payload);
  if (type === 'array') {
    return {
      topType: 'array',
      count: payload.length,
      sample: payload.slice(0, 3),
      foundListPath: '(root)',
    };
  }

  if (type === 'object' && payload) {
    const keys = Object.keys(payload);
    // common candidates
    const candidates = ['rates', 'plans', 'results', 'data', 'items'];
    for (const k of candidates) {
      const v = (payload as any)[k];
      if (Array.isArray(v)) {
        return {
          topType: 'object',
          topKeys: keys,
          foundListPath: k,
          count: v.length,
          sample: v.slice(0, 3),
        };
      }
    }
    // generic: first array valued key
    for (const k of keys) {
      const v = (payload as any)[k];
      if (Array.isArray(v)) {
        return {
          topType: 'object',
          topKeys: keys,
          foundListPath: k,
          count: v.length,
          sample: v.slice(0, 3),
        };
      }
    }
    return {
      topType: 'object',
      topKeys: keys,
      count: 0,
      message: 'No array found in object payload.',
    };
  }

  return {
    topType: type,
    count: 0,
    message: 'Payload is not an array or object with an array.',
  };
}

function getType(x: any): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  return typeof x;
}

