import { prisma } from '@/lib/db';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

export type SaveRawSmtFileInput = {
  filename: string;
  sourcePath?: string | null;
  size: number;
  sha256: string;
  content: Buffer;
};

export async function saveRawSmtFile(input: SaveRawSmtFileInput) {
  // Idempotency by sha256 (unique)
  try {
    const created = await prisma.rawSmtFile.create({
      data: {
        filename: input.filename,
        storage_path: input.sourcePath ?? null,
        size_bytes: input.size,
        sha256: input.sha256,
        content: input.content ?? null,
      },
      select: { id: true, sha256: true },
    });
    return { created: true, id: created.id, sha256: created.sha256 };
  } catch (err: any) {
    // Unique constraint => already exists; fetch existing id
    const existing = await prisma.rawSmtFile.findUnique({
      where: { sha256: input.sha256 },
      select: { id: true, sha256: true },
    });
    if (existing) return { created: false, id: existing.id, sha256: existing.sha256 };
    throw err;
  }
}

