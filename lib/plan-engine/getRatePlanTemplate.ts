import { prisma } from "@/lib/db";

export type RatePlanTemplate = {
  id: string;
  repPuctCertificate?: string | null;
  planName?: string | null;
  eflVersionCode?: string | null;
  rateStructure: unknown;
  planRules: unknown;
};

export type RatePlanTemplateProbeResult = {
  template: RatePlanTemplate | null;
  didThrow: boolean;
};

export async function getRatePlanTemplateProbe(args: {
  ratePlanId: string;
}): Promise<RatePlanTemplateProbeResult> {
  try {
    const rp = await prisma.ratePlan.findUnique({
      where: { id: args.ratePlanId },
      select: {
        id: true,
        repPuctCertificate: true,
        planName: true,
        eflVersionCode: true,
        rateStructure: true,
      },
    });
    if (!rp) return { template: null, didThrow: false };
    return {
      template: {
        id: rp.id,
        repPuctCertificate: rp.repPuctCertificate ?? null,
        planName: rp.planName ?? null,
        eflVersionCode: rp.eflVersionCode ?? null,
        rateStructure: rp.rateStructure ?? null,
        // Schema currently persists RateStructure (not PlanRules) for templates.
        // Keep the field present for forward-compat; wired later if PlanRules is stored separately.
        planRules: null,
      },
      didThrow: false,
    };
  } catch {
    return { template: null, didThrow: true };
  }
}

export async function getRatePlanTemplate(args: {
  ratePlanId: string;
}): Promise<RatePlanTemplate | null> {
  const probed = await getRatePlanTemplateProbe(args);
  return probed.template;
}


