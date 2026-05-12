import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { runEflPipeline } from "@/lib/plan-engine-next/efl/runEflPipeline";
import { adminUsageAuditForHome } from "@/lib/usage/adminUsageAudit";
import { adminPersistCurrentPlanFromEflPipeline } from "@/lib/current-plan/adminPersistCurrentPlanFromEflPipeline";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type Body = {
  cursor?: string | null;
  limit?: number | null;
  timeBudgetMs?: number | null;
  dryRun?: boolean | null;
  source?: string | null;
  usageMonths?: number | null;
  resultsLimit?: number | null;
};

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error, ...(details ? { details } : {}) },
    { status },
  );
}

function normalizeEmailLoose(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    const limitRaw = body.limit ?? 50;
    const limit = Math.max(
      1,
      Math.min(200, Number.isFinite(limitRaw as any) ? Number(limitRaw) : 50),
    );
    const timeBudgetRaw = body.timeBudgetMs ?? 240_000;
    const timeBudgetMs = Math.max(
      5_000,
      Math.min(
        270_000,
        Number.isFinite(timeBudgetRaw as any) ? Number(timeBudgetRaw) : 240_000,
      ),
    );
    const deadlineMs = Date.now() + timeBudgetMs;
    const shouldStop = () => Date.now() >= deadlineMs - 2_500;

    const dryRun = body.dryRun === true;
    const cursor = String(body.cursor ?? "").trim() || null;
    const source = String(body.source ?? "current_plan_efl").trim() || "current_plan_efl";
    const usageMonthsRaw = body.usageMonths ?? 12;
    const usageMonths = Math.max(
      1,
      Math.min(24, Number.isFinite(usageMonthsRaw as any) ? Number(usageMonthsRaw) : 12),
    );
    const resultsLimitRaw = body.resultsLimit ?? 200;
    const resultsLimit = Math.max(
      0,
      Math.min(
        2000,
        Number.isFinite(resultsLimitRaw as any) ? Number(resultsLimitRaw) : 200,
      ),
    );

    const results: any[] = [];
    let processed = 0;
    let persisted = 0;
    let resolved = 0;
    let skipped = 0;
    let truncated = false;
    let nextCursor: string | null = null;
    let resultsTruncated = false;
    let cursorLocal: string | null = cursor;

    while (!shouldStop()) {
      const items = await (prisma as any).eflParseReviewQueue.findMany({
        where: {
          resolvedAt: null,
          kind: "EFL_PARSE",
          source,
        },
        orderBy: { createdAt: "asc" },
        take: limit,
        ...(cursorLocal ? { cursor: { id: cursorLocal }, skip: 1 } : {}),
      });

      if (!Array.isArray(items) || items.length === 0) {
        truncated = false;
        nextCursor = null;
        break;
      }

      for (const it of items as any[]) {
        if (shouldStop()) {
          truncated = true;
          break;
        }

        const id = String(it?.id ?? "");
        nextCursor = id || nextCursor;
        processed++;

        const rawText = String(it?.rawText ?? "").trim();
        const eflPdfSha256 = String(it?.eflPdfSha256 ?? "").trim();
        const repPuctCertificate = String(it?.repPuctCertificate ?? "").trim() || null;
        const eflVersionCode = String(it?.eflVersionCode ?? "").trim() || null;
        const userEmail = normalizeEmailLoose((it?.derivedForValidation as any)?.userEmail);

        if (!rawText || !eflPdfSha256 || !userEmail) {
          skipped++;
          if (!dryRun) {
            try {
              await (prisma as any).eflParseReviewQueue.update({
                where: { id },
                data: {
                  queueReason: [
                    "CURRENT_PLAN_QUEUE_PROCESSOR_SKIP",
                    !rawText ? "missing_rawText" : null,
                    !eflPdfSha256 ? "missing_eflPdfSha256" : null,
                    !userEmail ? "missing_userEmail" : null,
                  ]
                    .filter(Boolean)
                    .join(":"),
                  updatedAt: new Date(),
                },
              });
            } catch {
              // ignore
            }
          }
          if (!resultsTruncated && results.length < resultsLimit) {
            results.push({
              id,
              source,
              supplier: it?.supplier ?? null,
              planName: it?.planName ?? null,
              status: "SKIPPED",
              note: !rawText
                ? "missing_rawText"
                : !eflPdfSha256
                  ? "missing_eflPdfSha256"
                  : "missing_userEmail",
            });
          } else {
            resultsTruncated = true;
          }
          continue;
        }

        let pipeline: any = null;
        let usageAudit: any = null;
        let currentPlanPersist: any = null;
        try {
          pipeline = await runEflPipeline({
            source: "queue_open",
            actor: "system",
            dryRun: true,
            rawText,
            identity: {
              eflPdfSha256,
              repPuctCertificate,
              eflVersionCode,
            },
            offerMeta: {
              supplier: it?.supplier ?? null,
              planName: it?.planName ?? null,
              termMonths: typeof it?.termMonths === "number" ? it.termMonths : null,
              tdspName: it?.tdspName ?? null,
            },
          });

          usageAudit = await adminUsageAuditForHome({
            usageEmail: userEmail,
            usageMonths,
            requiredBucketKeys: Array.isArray(pipeline?.requiredBucketKeys)
              ? pipeline.requiredBucketKeys
              : [],
            rateStructure: pipeline?.rateStructure ?? null,
            tdspSlug: null,
            rawTextForTdspInference: rawText,
          });

          if (!dryRun) {
            currentPlanPersist = await adminPersistCurrentPlanFromEflPipeline({
              usageEmail: userEmail,
              usageHomeId: (usageAudit as any)?.usageContext?.homeId ?? null,
              pipelineResult: {
                rawTextPreview: String(pipeline?.rawTextPreview ?? rawText),
                rawTextLen: pipeline?.rawTextLen ?? rawText.length,
                rawTextTruncated: Boolean(pipeline?.rawTextTruncated ?? false),
                eflPdfSha256: pipeline?.eflPdfSha256 ?? eflPdfSha256,
                repPuctCertificate: pipeline?.repPuctCertificate ?? repPuctCertificate,
                eflVersionCode: pipeline?.eflVersionCode ?? eflVersionCode,
                planRules: pipeline?.planRules ?? null,
                rateStructure: pipeline?.rateStructure ?? null,
                finalValidation: pipeline?.finalValidation ?? null,
                passStrength: pipeline?.passStrength ?? null,
                queued: pipeline?.queued ?? false,
                queueReason: pipeline?.queueReason ?? pipeline?.finalValidation?.queueReason ?? null,
              },
            });
          }

          const resolvedNow = Boolean(currentPlanPersist?.ok);
          if (resolvedNow) {
            persisted++;
            resolved++;
          } else {
            skipped++;
          }

          if (!dryRun) {
            try {
              await (prisma as any).eflParseReviewQueue.update({
                where: { id },
                data: resolvedNow
                  ? {
                      rawText,
                      planRules: pipeline?.planRules ?? null,
                      rateStructure: pipeline?.rateStructure ?? null,
                      validation: pipeline?.validation ?? null,
                      derivedForValidation: {
                        ...(pipeline?.derivedForValidation ?? {}),
                        userEmail,
                        usageAudit: usageAudit ?? null,
                      },
                      finalStatus: String(pipeline?.finalValidation?.status ?? "PASS"),
                      queueReason: null,
                      resolvedAt: new Date(),
                      resolvedBy: "AUTO_CURRENT_PLAN",
                      resolutionNotes: `AUTO_CURRENT_PLAN: current-plan template persisted. parsedCurrentPlanId=${currentPlanPersist?.parsedCurrentPlanId ?? "—"}`,
                    }
                  : {
                      rawText,
                      planRules: pipeline?.planRules ?? null,
                      rateStructure: pipeline?.rateStructure ?? null,
                      validation: pipeline?.validation ?? null,
                      derivedForValidation: {
                        ...(pipeline?.derivedForValidation ?? {}),
                        userEmail,
                        usageAudit: usageAudit ?? null,
                      },
                      finalStatus: String(pipeline?.finalValidation?.status ?? null),
                      queueReason:
                        currentPlanPersist?.error
                          ? `CURRENT_PLAN_QUEUE_PROCESSOR: ${String(currentPlanPersist.error)}`
                          : String(
                              pipeline?.finalValidation?.queueReason ??
                                "CURRENT_PLAN_QUEUE_PROCESSOR: persistence failed",
                            ),
                      updatedAt: new Date(),
                    },
              });
            } catch {
              // ignore
            }
          }

          if (!resultsTruncated && results.length < resultsLimit) {
            results.push({
              id,
              source,
              supplier: it?.supplier ?? null,
              planName: it?.planName ?? null,
              finalStatus: pipeline?.finalValidation?.status ?? null,
              passStrength: pipeline?.passStrength ?? null,
              resolvedNow,
              persistedCurrentPlan: resolvedNow,
              parsedCurrentPlanId: currentPlanPersist?.parsedCurrentPlanId ?? null,
              usageEmail: userEmail,
              note: resolvedNow
                ? `parsedCurrentPlanId=${currentPlanPersist?.parsedCurrentPlanId ?? "—"}`
                : currentPlanPersist?.error ?? "persistence_failed",
            });
          } else {
            resultsTruncated = true;
          }
        } catch (e: any) {
          skipped++;
          if (!dryRun) {
            try {
              await (prisma as any).eflParseReviewQueue.update({
                where: { id },
                data: {
                  queueReason: `CURRENT_PLAN_QUEUE_PROCESSOR_ERROR: ${String(
                    e?.message ?? e ?? "unknown error",
                  ).slice(0, 3900)}`,
                  updatedAt: new Date(),
                },
              });
            } catch {
              // ignore
            }
          }
          if (!resultsTruncated && results.length < resultsLimit) {
            results.push({
              id,
              source,
              supplier: it?.supplier ?? null,
              planName: it?.planName ?? null,
              status: "ERROR",
              error: e?.message ? String(e.message) : String(e),
            });
          } else {
            resultsTruncated = true;
          }
        }
      }

      if (truncated) break;
      cursorLocal =
        typeof nextCursor === "string" && nextCursor.trim() ? nextCursor.trim() : null;
      if (!cursorLocal) break;
    }

    return NextResponse.json({
      ok: true,
      source,
      dryRun,
      usageMonths,
      processed,
      persisted,
      resolved,
      skipped,
      truncated,
      nextCursor,
      results,
      resultsTruncated,
    });
  } catch (error: any) {
    return jsonError(500, "Failed to process open current-plan queue.", {
      message: error?.message ?? String(error),
    });
  }
}
