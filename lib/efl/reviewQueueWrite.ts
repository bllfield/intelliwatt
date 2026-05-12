function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function upsertReviewQueueRowRespectingOpenUrl(args: {
  prismaClient: any;
  where: any;
  create: Record<string, any>;
  update: Record<string, any>;
}) {
  const { prismaClient, where, create, update } = args;
  const eflUrl = trimOrNull(update?.eflUrl ?? create?.eflUrl);

  if (eflUrl) {
    const kind = trimOrNull(update?.kind ?? create?.kind);
    const dedupeKey = trimOrNull(update?.dedupeKey ?? create?.dedupeKey);
    const offerId = trimOrNull(update?.offerId ?? create?.offerId);
    const eflPdfSha256 = trimOrNull(update?.eflPdfSha256 ?? create?.eflPdfSha256);
    const repPuctCertificate = trimOrNull(
      update?.repPuctCertificate ?? create?.repPuctCertificate,
    );
    const eflVersionCode = trimOrNull(update?.eflVersionCode ?? create?.eflVersionCode);

    const matchers = [
      { eflUrl },
      offerId ? { offerId } : undefined,
      kind && dedupeKey ? { kind, dedupeKey } : undefined,
      eflPdfSha256 ? { eflPdfSha256 } : undefined,
      repPuctCertificate && eflVersionCode
        ? { repPuctCertificate, eflVersionCode }
        : undefined,
    ].filter(Boolean);

    if (matchers.length) {
      const existingOpen = await prismaClient.eflParseReviewQueue.findFirst({
        where: {
          resolvedAt: null,
          OR: matchers,
        },
        select: { id: true },
      });

      if (existingOpen?.id) {
        return prismaClient.eflParseReviewQueue.update({
          where: { id: existingOpen.id },
          data: {
            ...create,
            ...update,
            eflUrl,
          },
        });
      }
    }
  }

  return prismaClient.eflParseReviewQueue.upsert({
    where,
    create,
    update,
  });
}
