import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Vercel provides these at build/runtime (depending on environment).
  // We intentionally expose only non-secret identifiers to help debug deployment/version mismatches.
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    null;
  const ref =
    process.env.VERCEL_GIT_COMMIT_REF ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ??
    null;
  const deployedAt = new Date().toISOString();

  return NextResponse.json({ ok: true, sha, ref, deployedAt });
}


