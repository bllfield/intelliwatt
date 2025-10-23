/**
 * Helpers for API layers to enforce consent and prevent SSN collection.
 * Use these in any future enrollment/lead-capture endpoints.
 */

export function assertUserConsent(consented: unknown) {
  if (consented !== true && consented !== 'true' && consented !== 1 && consented !== '1') {
    const err = new Error('User consent is required to proceed.')
    ;(err as any).status = 400
    throw err
  }
}

/**
 * Remove any SSN-like fields from incoming payloads before logging/storing.
 * This is defensive: we do not expect/allow SSNs anywhere in IntelliWatt.
 */
export function sanitizeNoSSN<T extends Record<string, any>>(payload: T): T {
  const clone: any = Array.isArray(payload) ? [...payload] : { ...payload }

  function scrub(obj: any) {
    if (!obj || typeof obj !== 'object') return
    for (const k of Object.keys(obj)) {
      const lower = k.toLowerCase()
      const v = obj[k]
      if (lower.includes('ssn') || lower === 'socialsecurity' || lower === 'social_security') {
        delete obj[k]
        continue
      }
      if (typeof v === 'string' && /\b\d{3}-?\d{2}-?\d{4}\b/.test(v)) {
        obj[k] = 'REDACTED'
        continue
      }
      if (typeof v === 'object') scrub(v)
    }
  }

  scrub(clone)
  return clone
}
