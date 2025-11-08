/**
 * Normalize email to lowercase for consistent storage and comparison.
 * Email addresses are case-insensitive per RFC 5321, so we always store them in lowercase.
 */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email) {
    throw new Error('Email is required');
  }
  return email.trim().toLowerCase();
}

/**
 * Safely normalize email, returning null if invalid
 */
export function normalizeEmailSafe(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') {
    return null;
  }
  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes('@')) {
    return null;
  }
  return trimmed.toLowerCase();
}

