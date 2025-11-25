// Verify and decode referral token
import crypto from 'crypto';

function getReferralSecret(): string {
  return process.env.REFERRAL_SECRET || 'default-secret-change-in-production';
}

export function generateReferralToken(userId: string, campaignId = 'default'): string {
  const payload = {
    userId,
    campaignId,
    issuedAt: Date.now(),
  };

  const serialized = JSON.stringify(payload);
  const encodedPayload = Buffer.from(serialized).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getReferralSecret())
    .update(encodedPayload)
    .digest('hex');

  return `${encodedPayload}.${signature}`;
}

export function verifyReferralToken(token: string): { userId: string; campaignId: string; issuedAt: number } | null {
  try {
    if (!token) {
      return null;
    }

    const [encodedPayload, signature] = token.split('.');

    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = crypto
      .createHmac('sha256', getReferralSecret())
      .update(encodedPayload)
      .digest('hex');

    if (signature !== expectedSignature) {
      return null;
    }

    const jsonPayload = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const payload = JSON.parse(jsonPayload);

    const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days
    if (Date.now() - payload.issuedAt > maxAge) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

