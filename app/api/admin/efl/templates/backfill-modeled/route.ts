import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json(
    { ok: false, error, detail: detail ?? null },
    { status },
  );
}

type Ok = {
  ok: true;
  processedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorsCount: number;
  truncated: boolean;
  nextCursorId: string | null;
  lastCursorId: string | null;
  notes: string[];
};

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized");
    }

    const sp = req.nextUrl.searchParams;
    const limit = Math.max(1, Math.min(100, Number(sp.get("limit") ?? 25) || 25));
    const timeBudgetMs = Math.max(
      1000,
      Math.min(240_000, Number(sp.get("timeBudgetMs") ?? 110_000) || 110_000),
    );
    const cursorId = (sp.get("cursorId") ?? "").trim() || null;
    const overwrite = (sp.get("overwrite") ?? "").trim() === "1";
    const onlyStrong = (sp.get("onlyStrong") ?? "").trim() !== "0";

    const startMs = Date.now();
    const notes: string[] = [];

    const where: any = {
      isUtilityTariff: false,
      rateStructure: { not: null },
    };

    // Simple cursor: stable lexicographic paging by RatePlan.id.
    if (cursorId) {
      where.id = { gt: cursorId };
    }

    if (!overwrite) {
      where.OR = [
        { modeledRate500: null },
        { modeledRate1000: null },
        { modeledRate2000: null },
      ];
    }

    // Fetch one extra row so we can paginate even when we don't hit the time budget.
    const plansPlus = await (prisma as any).ratePlan.findMany({
      where,
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        eflUrl: true,
        eflSourceUrl: true,
        modeledRate500: true,
        modeledRate1000: true,
        modeledRate2000: true,
        modeledEflAvgPriceValidation: true,
        rateStructure: true,
      },
    });
    const hasMore = Array.isArray(plansPlus) && plansPlus.length > limit;
    const plans = hasMore ? plansPlus.slice(0, limit) : plansPlus;

    let processedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorsCount = 0;
    let lastCursorId: string | null = null;

    let ranOutOfTime = false;
    for (const p of plans as any[]) {
      lastCursorId = String(p.id);
      if (Date.now() - startMs > timeBudgetMs) {
        ranOutOfTime = true;
        break;
      }

      processedCount++;

      // Extra safety: if not overwrite and already filled, skip.
      if (
        !overwrite &&
        typeof p.modeledRate500 === "number" &&
        typeof p.modeledRate1000 === "number" &&
        typeof p.modeledRate2000 === "number" &&
        p.modeledEflAvgPriceValidation != null
      ) {
        skippedCount++;
        continue;
      }

      const eflUrl = String(p.eflUrl ?? "").trim() || String(p.eflSourceUrl ?? "").trim() || "";
      if (!eflUrl) {
        skippedCount++;
        continue;
      }

      try {
        const fetched = await fetchEflPdfFromUrl(eflUrl);
        if (!fetched.ok) {
          skippedCount++;
          notes.push(`SKIP fetch failed: ratePlanId=${p.id} url=${eflUrl}`);
          continue;
        }

        const pipeline = await runEflPipelineNoStore({
          pdfBytes: fetched.pdfBytes,
          source: "manual",
          offerMeta: null,
        });

        const finalValidation = pipeline.finalValidation ?? null;
        const finalStatus = finalValidation?.status ?? null;
        const passStrength = (pipeline as any)?.passStrength ?? null;

        if (onlyStrong && !(finalStatus === "PASS" && passStrength === "STRONG")) {
          skippedCount++;
          continue;
        }

      const points = Array.isArray(finalValidation?.points) ? finalValidation.points : [];
      if (!finalValidation || points.length === 0) {
        skippedCount++;
        notes.push(`SKIP no validation points: ratePlanId=${p.id} url=${eflUrl}`);
        continue;
      }
        const modeledRateFor = (kwh: number): number | null => {
          const hit = points.find(
            (x: any) => Number(x?.usageKwh ?? x?.kwh ?? x?.usage) === kwh,
          );
          const n = Number(
            hit?.modeledAvgCentsPerKwh ??
              hit?.modeledAvgPriceCentsPerKwh ??
              hit?.modeledCentsPerKwh,
          );
          return Number.isFinite(n) ? n : null;
        };

        const modeledAt = new Date();

        const rsObj: any =
          p.rateStructure && typeof p.rateStructure === "object" ? p.rateStructure : null;
        const nextRateStructure =
          rsObj && typeof rsObj === "object"
            ? ({
                ...rsObj,
                __eflAvgPriceValidation: finalValidation ?? null,
                __eflAvgPriceEvidence: {
                  computedAt: modeledAt.toISOString(),
                  source: "templates_backfill_modeled",
                  passStrength: passStrength ?? null,
                },
              } as any)
            : rsObj;

        await (prisma as any).ratePlan.update({
          where: { id: p.id },
          data: {
            modeledRate500: modeledRateFor(500),
            modeledRate1000: modeledRateFor(1000),
            modeledRate2000: modeledRateFor(2000),
            modeledEflAvgPriceValidation: (finalValidation ?? null) as any,
            modeledComputedAt: modeledAt,
            // Keep the embedded proof in sync for older consumers/tools.
            rateStructure: nextRateStructure as any,
          },
        });

        updatedCount++;
      } catch (e) {
        errorsCount++;
        notes.push(
          `ERROR: ratePlanId=${p.id} ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Continue pagination whenever there might be more work, or we ran out of time.
    const truncated = Boolean(lastCursorId && (ranOutOfTime || hasMore));
    const nextCursorId = truncated ? lastCursorId : null;

    const body: Ok = {
      ok: true,
      processedCount,
      updatedCount,
      skippedCount,
      errorsCount,
      truncated,
      nextCursorId,
      lastCursorId,
      notes: notes.slice(0, 50),
    };
    return NextResponse.json(body);
  } catch (e: any) {
    return jsonError(500, "Internal error", e?.message);
  }
}


