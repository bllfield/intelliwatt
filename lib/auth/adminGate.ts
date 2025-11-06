// lib/auth/adminGate.ts

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/admin';



export function ensureAdmin(req: NextRequest) {

  const gate = requireAdmin(req);

  if (!gate.ok) {

    return NextResponse.json(gate.body, { status: gate.status });

  }

  return null as NextResponse | null;

}

