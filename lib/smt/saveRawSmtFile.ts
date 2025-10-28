// lib/smt/saveRawSmtFile.ts
// Save RAW SMT files to database with idempotency via SHA256

import { prisma } from '@/lib/db';
import crypto from 'crypto';

export interface RawSmtFileInput {
  filename: string;
  sourcePath?: string | null;
  size: number;
  content: string; // base64 encoded
}

export interface RawSmtFileResult {
  id: string;
  alreadyExists: boolean;
}

/**
 * Save a raw SMT file to the database.
 * Idempotent: if file with same sha256 exists, returns existing record.
 * Does NOT parse or transform the file content (RAW only per PC-2025-02).
 */
export async function saveRawSmtFile(input: RawSmtFileInput): Promise<RawSmtFileResult> {
  // Calculate SHA256 from base64 content
  const sha256 = crypto.createHash('sha256').update(input.content, 'base64').digest('hex');
  
  // Check if file already exists (idempotency)
  const existing = await prisma.rawSmtFile.findUnique({
    where: { sha256 },
    select: { id: true }
  });

  if (existing) {
    return { id: existing.id, alreadyExists: true };
  }

  // Convert base64 to Buffer for storage as Bytes
  const contentBuffer = Buffer.from(input.content, 'base64');

  // Create new record
  const created = await prisma.rawSmtFile.create({
    data: {
      filename: input.filename,
      sourcePath: input.sourcePath ?? null,
      size: input.size,
      sha256,
      content: contentBuffer,
    },
    select: { id: true }
  });

  return { id: created.id, alreadyExists: false };
}

