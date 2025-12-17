import { prisma } from "@/lib/db";
import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";

type Args = {
  limit: number;
  timeBudgetMs: number;
  cursorId: string | null;
  overwrite: boolean;
  onlyStrong: boolean;
};

function parseArgs(): Args {
  const out: Args = {
    limit: 25,
    timeBudgetMs: 10 * 60 * 1000,
    cursorId: null,
    overwrite: false,
    onlyStrong: true,
  };

  for (const raw of process.argv.slice(2)) {
    const [k, vRaw] = raw.split("=", 2);
    const v = (vRaw ?? "").trim();
    if (k === "--limit") out.limit = Math.max(1, Math.min(200, Number(v) || 25));
    if (k === "--timeBudgetMs")
      out.timeBudgetMs = Math.max(1000, Math.min(60 * 60 * 1000, Number(v) || out.timeBudgetMs));
    if (k === "--cursorId") out.cursorId = v || null;
    if (k === "--overwrite") out.overwrite = v === "1" || v === "true";
    if (k === "--onlyStrong") out.onlyStrong = !(v === "0" || v === "false");
  }

  return out;
}

async function main() {
  const args = parseArgs();
  const startMs = Date.now();

  const where: any = {
    isUtilityTariff: false,
    rateStructure: { not: null },
  };

  if (args.cursorId) where.id = { gt: args.cursorId };

  if (!args.overwrite) {
    where.OR = [
      { modeledRate500: null },
      { modeledRate1000: null },
      { modeledRate2000: null },
    ];
  }

  const plans = await (prisma as any).ratePlan.findMany({
    where,
    orderBy: { id: "asc" },
    take: args.limit,
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

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  let lastId: string | null = null;

  for (const p of plans as any[]) {
    lastId = String(p.id);
    if (Date.now() - startMs > args.timeBudgetMs) break;

    processed++;

    if (
      !args.overwrite &&
      typeof p.modeledRate500 === "number" &&
      typeof p.modeledRate1000 === "number" &&
      typeof p.modeledRate2000 === "number" &&
      p.modeledEflAvgPriceValidation != null
    ) {
      skipped++;
      continue;
    }

    const eflUrl =
      String(p.eflUrl ?? "").trim() || String(p.eflSourceUrl ?? "").trim() || "";
    if (!eflUrl) {
      skipped++;
      continue;
    }

    try {
      const fetched = await fetchEflPdfFromUrl(eflUrl);
      if (!fetched.ok) {
        skipped++;
        continue;
      }

      const pipeline = await runEflPipelineNoStore({
        pdfBytes: fetched.pdfBytes,
        source: "manual",
        // Local-script override: allow running without the droplet pdftotext service.
        extractPdfText: async (pdfBytes) => {
          const mod: any = await import("pdf-parse");
          const fn: any = mod?.pdf;
          if (typeof fn !== "function") throw new Error("pdf-parse pdf export not found");
          const r = await fn(Buffer.from(pdfBytes as any));
          return String((r as any)?.text ?? "");
        },
        offerMeta: null,
      });

      const finalValidation = pipeline.finalValidation ?? null;
      const finalStatus = finalValidation?.status ?? null;
      const passStrength = (pipeline as any)?.passStrength ?? null;

      if (args.onlyStrong && !(finalStatus === "PASS" && passStrength === "STRONG")) {
        skipped++;
        continue;
      }

      const points = Array.isArray(finalValidation?.points) ? finalValidation.points : [];
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
                source: "scripts_admin_backfill",
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
          rateStructure: nextRateStructure as any,
        },
      });

      updated++;
    } catch (e) {
      errors++;
      // eslint-disable-next-line no-console
      console.error(
        `[EFL_BACKFILL_MODELED_PROOF] error ratePlanId=${p.id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        processed,
        updated,
        skipped,
        errors,
        lastId,
        truncated: Boolean(lastId && plans.length === args.limit && Date.now() - startMs > args.timeBudgetMs),
        nextCursorId: Boolean(lastId && plans.length === args.limit && Date.now() - startMs > args.timeBudgetMs) ? lastId : null,
        ms: Date.now() - startMs,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


