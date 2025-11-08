import { Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { prisma } from '@/lib/db';
import { normalizeAddress } from '@/lib/ercot/normalize';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

function buildSslOption(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname?.toLowerCase() || '';
    if (!host || host === 'localhost' || host === '127.0.0.1') {
      return false;
    }
    if (parsed.searchParams.get('sslmode') === 'disable') {
      return false;
    }
  } catch (err) {
    // fall through to enabling SSL with relaxed verification
  }
  return { rejectUnauthorized: false } as const;
}

export type MatchInput = {
  line1: string;
  city?: string;
  zip: string;
  minScore?: number; // default 0.85
  limit?: number;    // default 5
};

export async function findErcotCandidates(
  input: MatchInput,
  databaseUrl = process.env.DATABASE_URL
) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }
  const { normLine1, normCity, normZip } = normalizeAddress({
    line1: input.line1,
    city: input.city,
    zip: input.zip,
  });

  if (!normLine1 || !normZip) {
    return { ok: false, reason: 'NORMALIZATION_FAILED', candidates: [] as any[] };
  }

  const minScore = input.minScore ?? 0.85;
  const limit = input.limit ?? 5;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: buildSslOption(databaseUrl),
  });

  const sql = `
    SELECT
      id,
      esiid,
      "tdspCode",
      "serviceAddress1",
      "serviceCity",
      "serviceState",
      "serviceZip",
      status,
      "premiseType",
      "postedAtUtc",
      "normLine1",
      "normCity",
      "normZip",
      similarity("normLine1", $1) AS sim
    FROM "ErcotEsiidIndex"
    WHERE "normZip" = $2
    ORDER BY sim DESC
    LIMIT $3
  `;

  const client = await pool.connect();
  try {
    const res = await client.query(sql, [normLine1, normZip, String(limit)]);
    const candidates = (res.rows || []).map((r: any) => ({
      esiid: r.esiid,
      tdspCode: r.tdspCode,
      serviceAddress1: r.serviceAddress1,
      serviceCity: r.serviceCity,
      serviceState: r.serviceState,
      serviceZip: r.serviceZip,
      score: Number(r.sim),
      normLine1: r.normline1 || r.normLine1,
      normZip: r.normzip || r.normZip,
    })).filter((c: any) => c.score >= minScore);

    return {
      ok: true,
      input: { normLine1, normCity, normZip },
      candidates,
      threshold: minScore,
    };
  } finally {
    client.release();
    await new Promise((r) => setTimeout(r, 0));
  }
}

