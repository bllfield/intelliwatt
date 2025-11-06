// app/api/admin/address/resolve-and-save/route.ts

import { NextRequest, NextResponse } from 'next/server';

import { getCorrelationId } from '@/lib/correlation';

import { ensureAdmin } from '@/lib/auth/adminGate';

import { prisma } from '@/lib/db';

import { resolveAddressToEsiid } from '@/lib/resolver/addressToEsiid';



export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';



export async function POST(req: NextRequest) {

  const corrId = getCorrelationId(req.headers);

  const t0 = Date.now();

  const deny = ensureAdmin(req);

  if (deny) return deny;



  try {

    const body = await req.json();

    const { houseId, line1, city, state, zip } = body || {};

    if (!houseId || !line1 || !city || !state || !zip) {

      return NextResponse.json({ ok: false, corrId, error: 'MISSING_FIELDS' }, { status: 400 });

    }



    // 1) Resolve ESIID via provider wrapper (currently WattBuy)

    const lookup = await resolveAddressToEsiid({ line1, city, state, zip });

    if (!lookup.esiid) {

      const durationMs = Date.now() - t0;

      console.warn(JSON.stringify({

        corrId, route: 'admin/address/resolve-and-save', status: 404, durationMs,

        reason: 'NO_ESIID_FOUND', address: { line1, city, state, zip }

      }));

      return NextResponse.json({ ok: false, corrId, error: 'NO_ESIID_FOUND', details: lookup?.raw ?? null }, { status: 404 });

    }



    // 2) Persist in a transaction:

    //    - Update HouseAddress.esiid

    //    - If HouseAddress has a userId, update UserProfile.esiid as well

    const result = await prisma.$transaction(async (tx) => {

      const house = await tx.houseAddress.update({

        where: { id: houseId },

        data: { esiid: lookup.esiid! }, // Non-null: already checked above

        select: { id: true, esiid: true, userId: true },

      });



      let userProfileUpdated: { id: string; esiid: string | null } | null = null;

      if (house.userId) {

        try {

          userProfileUpdated = await tx.userProfile.update({

            where: { userId: house.userId },

            data: { esiid: lookup.esiid! }, // Non-null: already checked above

            select: { id: true, esiid: true },

          });

        } catch {

          // If there isn't a matching user profile row, ignore

          userProfileUpdated = null;

        }

      }



      return { house, userProfileUpdated };

    });



    const durationMs = Date.now() - t0;

    console.log(JSON.stringify({

      corrId, route: 'admin/address/resolve-and-save', status: 200, durationMs,

      houseId: result.house.id, esiid: result.house.esiid, utility: lookup.utility ?? null,

      userProfileUpdated: Boolean(result.userProfileUpdated)

    }));



    return NextResponse.json({

      ok: true,

      corrId,

      houseId: result.house.id,

      esiid: result.house.esiid,

      utility: lookup.utility ?? null,

      territory: lookup.territory ?? null,

      userProfileUpdated: result.userProfileUpdated,

    }, { status: 200 });

  } catch (err: any) {

    const durationMs = Date.now() - t0;

    if (err?.code === 'P2002') {

      // Unique constraint failed on HouseAddress.esiid

      console.error(JSON.stringify({

        corrId, route: 'admin/address/resolve-and-save', status: 409, durationMs,

        errorClass: 'PRISMA_UNIQUE_CONSTRAINT', message: err?.message, code: err?.code

      }));

      return NextResponse.json({

        ok: false, corrId, error: 'ESIID_ALREADY_ASSIGNED', field: 'esiid'

      }, { status: 409 });

    }

    console.error(JSON.stringify({

      corrId, route: 'admin/address/resolve-and-save', status: 500, durationMs,

      errorClass: 'BUSINESS_LOGIC', message: err?.message

    }));

    return NextResponse.json({ ok: false, corrId, error: 'RESOLVE_AND_SAVE_FAILED' }, { status: 500 });

  }

}
