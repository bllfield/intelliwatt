import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";

function upperKey(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

type AutoResolveCurrentPlanQueueArgs = {
  sourceMode?: "efl_only" | "all_current_plan";
  eflPdfSha256?: string | null;
  repPuctCertificate?: string | null;
  eflVersionCode?: string | null;
  providerName?: string | null;
  planName?: string | null;
  termMonths?: number | null;
  userEmail?: string | null;
  resolvedBy: string;
  resolutionNotes: string;
};

export async function autoResolveCurrentPlanQueue(
  args: AutoResolveCurrentPlanQueueArgs,
): Promise<{ count: number; matchedIds: string[] }> {
  const sourceMode = args.sourceMode ?? "efl_only";
  const sha = String(args.eflPdfSha256 ?? "").trim();
  const rep = String(args.repPuctCertificate ?? "").trim();
  const ver = String(args.eflVersionCode ?? "").trim();
  const providerKey = upperKey(args.providerName);
  const planKey = upperKey(args.planName);
  const userEmail = normalizeEmail(args.userEmail ?? "");
  const termMonths =
    typeof args.termMonths === "number" && Number.isFinite(args.termMonths)
      ? Math.round(args.termMonths)
      : null;

  const openRows = await (prisma as any).eflParseReviewQueue.findMany({
    where: {
      resolvedAt: null,
      kind: "EFL_PARSE",
      ...(sourceMode === "all_current_plan"
        ? { source: { startsWith: "current_plan" } }
        : { source: "current_plan_efl" }),
    },
    select: {
      id: true,
      eflPdfSha256: true,
      repPuctCertificate: true,
      eflVersionCode: true,
      supplier: true,
      planName: true,
      termMonths: true,
      derivedForValidation: true,
    },
  });

  const matchedIds = (Array.isArray(openRows) ? openRows : [])
    .filter((row: any) => {
      const rowSha = String(row?.eflPdfSha256 ?? "").trim();
      const rowRep = String(row?.repPuctCertificate ?? "").trim();
      const rowVer = String(row?.eflVersionCode ?? "").trim();
      const rowProviderKey = upperKey(row?.supplier);
      const rowPlanKey = upperKey(row?.planName);
      const rowTermMonths =
        typeof row?.termMonths === "number" && Number.isFinite(row.termMonths)
          ? Math.round(row.termMonths)
          : null;
      const rowUserEmail = normalizeEmail(
        (row?.derivedForValidation as any)?.userEmail ?? "",
      );

      const identityMatch =
        (sha && rowSha === sha) ||
        (rep && ver && rowRep === rep && rowVer === ver);

      const planMatch =
        providerKey &&
        planKey &&
        rowProviderKey === providerKey &&
        rowPlanKey === planKey;

      const termCompatible =
        termMonths == null || rowTermMonths == null || rowTermMonths === termMonths;

      const userCompatible =
        !userEmail || !rowUserEmail || rowUserEmail === userEmail;

      return Boolean(identityMatch || (planMatch && termCompatible && userCompatible));
    })
    .map((row: any) => String(row?.id ?? "").trim())
    .filter(Boolean);

  if (!matchedIds.length) return { count: 0, matchedIds: [] };

  const updated = await (prisma as any).eflParseReviewQueue.updateMany({
    where: { id: { in: matchedIds } },
    data: {
      resolvedAt: new Date(),
      resolvedBy: args.resolvedBy,
      resolutionNotes: args.resolutionNotes,
    },
  });

  return {
    count: Number(updated?.count ?? 0) || 0,
    matchedIds,
  };
}
