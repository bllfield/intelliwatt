import { prisma } from "@/lib/db";

export type RatePlanTemplate = {
  id: string;
  repPuctCertificate?: string | null;
  planName?: string | null;
  eflVersionCode?: string | null;
  rateStructure: unknown;
  planRules: unknown;
};

export async function getRatePlanTemplate(args: {
  ratePlanId: string;
}): Promise<RatePlanTemplate | null> {
  try {
    const rp = await (prisma as any).ratePlan.findUnique({
      where: { id: args.ratePlanId },
      select: {
        id: true,
        repPuctCertificate: true,
        planName: true,
        eflVersionCode: true,
        rateStructure: true,
        planRules: true,
      },
    });
    return (rp ?? null) as RatePlanTemplate | null;
  } catch {
    return null;
  }
}


