import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/ercot/lookup-esiid
 * 
 * Lookup ESIID from address using ERCOT data.
 * Requires x-admin-token header.
 */
export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const body = await req.json();
    const { line1, city, state, zip } = body || {};

    if (!line1 || !city || !state || !zip) {
      return NextResponse.json(
        { ok: false, error: 'MISSING_ADDRESS_FIELDS', details: 'line1, city, state, and zip are required' },
        { status: 400 }
      );
    }

    // Query ErcotEsiidIndex for matching address
    // Using fuzzy matching on address line1 and exact match on zip
    const results = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        esiid,
        "addressLine1",
        city,
        state,
        zip,
        utility,
        tdsp,
        similarity("addressLine1", $1) as similarity
      FROM "ErcotEsiidIndex"
      WHERE zip = $2
        AND similarity("addressLine1", $1) > 0.3
      ORDER BY similarity DESC
      LIMIT 10
    `, line1, zip).catch(() => []);

    if (results.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'NO_ESIID_FOUND',
        message: 'No ESIID found for this address in ERCOT data',
        address: { line1, city, state, zip },
      }, { status: 404 });
    }

    // Return best match
    const bestMatch = results[0];
    return NextResponse.json({
      ok: true,
      esiid: bestMatch.esiid,
      utility: bestMatch.utility,
      tdsp: bestMatch.tdsp,
      address: {
        line1: bestMatch.addressLine1,
        city: bestMatch.city,
        state: bestMatch.state,
        zip: bestMatch.zip,
      },
      similarity: bestMatch.similarity,
      matches: results.length,
      allMatches: results.map((r: any) => ({
        esiid: r.esiid,
        address: r.addressLine1,
        similarity: r.similarity,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to lookup ESIID' },
      { status: 500 }
    );
  }
}

