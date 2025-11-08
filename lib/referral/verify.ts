// Verify and decode referral token
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

export function verifyReferralToken(token: string): { userId: string; campaignId: string; issuedAt: number } | null {
  try {
    const secret = process.env.REFERRAL_SECRET || 'default-secret-change-in-production';
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [data, signature] = decoded.split(':');
    
    if (!data || !signature) return null;
    
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
    
    if (signature !== expectedSignature) return null;
    
    const payload = JSON.parse(data);
    
    // Check expiry (90 days)
    const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days in ms
    if (Date.now() - payload.issuedAt > maxAge) return null;
    
    return payload;
  } catch (error) {
    return null;
  }
}

