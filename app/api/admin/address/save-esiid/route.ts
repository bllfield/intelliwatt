// app/api/admin/address/save-esiid/route.ts

import { NextRequest, NextResponse } from 'next/server';

import { getCorrelationId } from '@/lib/correlation';

import { requireAdmin } from '@/lib/auth/admin';

import { prisma } from '@/lib/db';



export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';



export async function POST(req: NextRequest) {

  const corrId = getCorrelationId(req.headers);

  const t0 = Date.now();

  const gate = requireAdmin(req);

  if (gate) return gate;



  try {

    const body = await req.json();

    const { houseId, esiid } = body || {};

    if (!houseId || !esiid) {

      return NextResponse.json({ ok: false, corrId, error: 'MISSING_FIELDS' }, { status: 400 });

    }



    const result = await prisma.$transaction(async (tx) => {

      const house = await tx.houseAddress.update({

        where: { id: houseId },

        data: { esiid },

        select: { id: true, esiid: true, userId: true },

      });



      let userProfileUpdated: { id: string; esiid: string | null } | null = null;

      if (house.userId) {

        try {

          userProfileUpdated = await tx.userProfile.update({

            where: { userId: house.userId },

            data: { esiid },

            select: { id: true, esiid: true },

          });

        } catch {

          userProfileUpdated = null;

        }

      }



      return { house, userProfileUpdated };

    });



    const durationMs = Date.now() - t0;

    console.log(JSON.stringify({

      corrId, route: 'admin/address/save-esiid', status: 200, durationMs,

      houseId: result.house.id, esiid: result.house.esiid, userProfileUpdated: Boolean(result.userProfileUpdated)

    }));



    return NextResponse.json({

      ok: true, corrId,

      houseId: result.house.id, esiid: result.house.esiid,

      userProfileUpdated: result.userProfileUpdated

    }, { status: 200 });

  } catch (err: any) {

    const durationMs = Date.now() - t0;

    console.error(JSON.stringify({

      corrId, route: 'admin/address/save-esiid', status: 500, durationMs,

      errorClass: 'BUSINESS_LOGIC', message: err?.message

    }));

    return NextResponse.json({ ok: false, corrId, error: 'SAVE_ESIID_FAILED' }, { status: 500 });

  }

}
