import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function errDetails(err: unknown): { message: string; code?: string | null } {
  const anyErr = err as any;
  const msg =
    err instanceof Error
      ? err.message
      : typeof anyErr?.message === "string"
        ? anyErr.message
        : String(err ?? "unknown error");
  const code =
    typeof anyErr?.code === "string" ? (anyErr.code as string) : null;
  return { message: msg, ...(code ? { code } : {}) };
}

export async function GET(req: NextRequest) {
  // Debug: confirm which DB Vercel is connected to (safe to return; no secrets).
  let dbInfo: { db: string | null; schema: string | null } | null = null;
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return jsonError(500, "ADMIN_TOKEN not configured");

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) return jsonError(401, "Unauthorized");

    if (!process.env.CURRENT_PLAN_DATABASE_URL) {
      return jsonError(500, "CURRENT_PLAN_DATABASE_URL is not configured");
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "100");
    const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));
    const q = (url.searchParams.get("q") || "").trim();
    const onlyFromBills = url.searchParams.get("onlyFromBills") === "1";

    const currentPlanPrisma = getCurrentPlanPrisma() as any;
    try {
      const r = (await currentPlanPrisma.$queryRaw`SELECT current_database()::text AS db, current_schema()::text AS schema`) as any;
      const row = Array.isArray(r) ? r[0] : r;
      dbInfo = {
        db: typeof row?.db === "string" ? row.db : null,
        schema: typeof row?.schema === "string" ? row.schema : null,
      };
    } catch {
      // ignore (best-effort only)
    }
    const delegate = currentPlanPrisma.billPlanTemplate as any;

    const where: any = {};
    if (q) {
      where.OR = [
        { providerName: { contains: q, mode: "insensitive" } },
        { planName: { contains: q, mode: "insensitive" } },
        { providerNameKey: { contains: q.toUpperCase(), mode: "insensitive" } },
        { planNameKey: { contains: q.toUpperCase(), mode: "insensitive" } },
      ];
    }

    if (onlyFromBills) {
      // Restrict to templates that have at least one ParsedCurrentPlan derived from a STATEMENT upload.
      // IMPORTANT: do this fully in the DB (DISTINCT + JOIN) so we don't:
      // - cap at 500 ParsedCurrentPlan rows (bug)
      // - build a huge OR list in JS (slow / can exceed query size)
      //
      // We tag current-plan EFL uploads with filename prefix `EFL:` in CurrentPlanBillUpload.

      const qLike = `%${q}%`;
      const qKeyLike = `%${q.toUpperCase()}%`;

      const rows = q
        ? await currentPlanPrisma.$queryRaw`
            WITH keys AS (
              SELECT DISTINCT
                UPPER(p."providerNameKey") AS "providerNameKey",
                UPPER(p."planNameKey") AS "planNameKey"
              FROM "ParsedCurrentPlan" p
              JOIN "CurrentPlanBillUpload" u
                ON u."id" = p."uploadId"
              WHERE p."uploadId" IS NOT NULL
                AND p."providerNameKey" IS NOT NULL
                AND p."planNameKey" IS NOT NULL
                AND u."filename" NOT ILIKE 'EFL:%'
            )
            SELECT t.*
            FROM "BillPlanTemplate" t
            JOIN keys k
              ON k."providerNameKey" = t."providerNameKey"
             AND k."planNameKey" = t."planNameKey"
            WHERE
              (t."providerName" ILIKE ${qLike}
               OR t."planName" ILIKE ${qLike}
               OR t."providerNameKey" ILIKE ${qKeyLike}
               OR t."planNameKey" ILIKE ${qKeyLike})
            ORDER BY t."updatedAt" DESC
            LIMIT ${limit}
          `
        : await currentPlanPrisma.$queryRaw`
            WITH keys AS (
              SELECT DISTINCT
                UPPER(p."providerNameKey") AS "providerNameKey",
                UPPER(p."planNameKey") AS "planNameKey"
              FROM "ParsedCurrentPlan" p
              JOIN "CurrentPlanBillUpload" u
                ON u."id" = p."uploadId"
              WHERE p."uploadId" IS NOT NULL
                AND p."providerNameKey" IS NOT NULL
                AND p."planNameKey" IS NOT NULL
                AND u."filename" NOT ILIKE 'EFL:%'
            )
            SELECT t.*
            FROM "BillPlanTemplate" t
            JOIN keys k
              ON k."providerNameKey" = t."providerNameKey"
             AND k."planNameKey" = t."planNameKey"
            ORDER BY t."updatedAt" DESC
            LIMIT ${limit}
          `;

      const templates = (Array.isArray(rows) ? rows : []).map((t: any) => ({
        id: String(t.id),
        providerNameKey: String(t.providerNameKey ?? ""),
        planNameKey: String(t.planNameKey ?? ""),
        providerName: (t.providerName as string | null) ?? null,
        planName: (t.planName as string | null) ?? null,
        rateType: (t.rateType as string | null) ?? null,
        variableIndexType: (t.variableIndexType as string | null) ?? null,
        termMonths: typeof t.termMonths === "number" ? t.termMonths : null,
        earlyTerminationFeeCents: typeof t.earlyTerminationFeeCents === "number" ? t.earlyTerminationFeeCents : null,
        baseChargeCentsPerMonth: typeof t.baseChargeCentsPerMonth === "number" ? t.baseChargeCentsPerMonth : null,
        hasTimeOfUse: Boolean(t.timeOfUseConfigJson),
        hasBillCredits: Boolean(t.billCreditsJson),
        updatedAt: (t.updatedAt as Date).toISOString(),
        createdAt: (t.createdAt as Date).toISOString(),
      }));

      return NextResponse.json({
        ok: true,
        limit,
        count: templates.length,
        templates,
        ...(dbInfo ? { dbInfo } : {}),
      });
    }

    const rows = await delegate.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const templates = (rows ?? []).map((t: any) => ({
      id: String(t.id),
      providerNameKey: String(t.providerNameKey ?? ""),
      planNameKey: String(t.planNameKey ?? ""),
      providerName: (t.providerName as string | null) ?? null,
      planName: (t.planName as string | null) ?? null,
      rateType: (t.rateType as string | null) ?? null,
      variableIndexType: (t.variableIndexType as string | null) ?? null,
      termMonths: typeof t.termMonths === "number" ? t.termMonths : null,
      earlyTerminationFeeCents: typeof t.earlyTerminationFeeCents === "number" ? t.earlyTerminationFeeCents : null,
      baseChargeCentsPerMonth: typeof t.baseChargeCentsPerMonth === "number" ? t.baseChargeCentsPerMonth : null,
      hasTimeOfUse: Boolean(t.timeOfUseConfigJson),
      hasBillCredits: Boolean(t.billCreditsJson),
      updatedAt: (t.updatedAt as Date).toISOString(),
      createdAt: (t.createdAt as Date).toISOString(),
    }));

    return NextResponse.json({
      ok: true,
      limit,
      count: templates.length,
      templates,
      ...(dbInfo ? { dbInfo } : {}),
    });
  } catch (e) {
    const d = errDetails(e);
    // eslint-disable-next-line no-console
    console.error("[admin/current-plan/bill-plan-templates] Failed to load templates", {
      code: (d as any).code ?? null,
      message: d.message,
    });

    const msg = String(d.message || "");
    const code = (d as any).code ?? null;
    const looksLikeMissingTable =
      code === "P2021" ||
      /relation\s+"?BillPlanTemplate"?\s+does\s+not\s+exist/i.test(msg) ||
      /table\s+`?BillPlanTemplate`?\s+does\s+not\s+exist/i.test(msg);

    const hint = looksLikeMissingTable
      ? "Current-plan DB schema missing tables. Run: npx prisma db execute --schema prisma/current-plan/schema.prisma --file scripts/sql/current-plan/ensure_bill_plan_template.sql"
      : null;

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load bill plan templates",
        ...(code ? { code } : {}),
        details: msg.slice(0, 600),
        ...(hint ? { hint } : {}),
        ...(dbInfo ? { dbInfo } : {}),
      },
      { status: 500 },
    );
  }
}

