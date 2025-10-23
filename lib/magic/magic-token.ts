import crypto from 'crypto';
import { db } from '@/lib/db'; // Make sure this is your Prisma client import

export async function createMagicToken(email: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  return token;
}

export async function storeToken(email: string, token: string) {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 15); // 15 min from now

  await db.magicLinkToken.create({
    data: {
      email,
      token,
      expiresAt,
      used: false
    }
  });
} 